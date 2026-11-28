const { sql, readBody, send, guard, requireAuth, ensureAdminTables, ensurePaymentTables, getSettings, currencyOfPhone, moneyRules, withdrawFloorFor, maintenanceBlocked } = require('../../_lib');

// Withdrawal request: the balance is held immediately. Withdrawals
// need only the minimum + balance (Prince, 2026-11-28 — all 3 stages
// removed, so there is no deposit gate, no verification fee and no NTT
// fee). Admin rejection refunds the hold automatically.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  await ensureAdminTables();
  const maint = await maintenanceBlocked(auth);
  if (maint) return send(res, 503, { error: 'maintenance_mode', detail: maint });
  const settings = await getSettings(['payouts_frozen', 'withdraw_min_ghs', 'withdraw_min_ngn']);
  if (settings.payouts_frozen === '1') {
    return send(res, 403, { error: 'payouts_frozen', detail: 'Withdrawals are temporarily paused by the operator. Please check back shortly.' });
  }
  const body = await readBody(req);
  const { amount_ghs, method } = body;
  const amount = Number(amount_ghs);
  if (!(amount > 0)) return send(res, 400, { error: 'invalid_amount' });
  // Nigerian accounts are paid by bank transfer through Flutterwave
  // (Prince, 2026-11-07): the bank details ride on the transaction row
  // so the super admin's confirm can fire the transfer. Ghana accounts
  // keep paying out to MoMo exactly as before.
  await ensurePaymentTables();
  const urows = await sql('select phone from users where id = $1', [auth.uid]);
  const isNgn = urows.length && currencyOfPhone(urows[0].phone) === 'NGN';
  // Minimum withdrawal (Prince, 2026-11-25): GHS 2,000 / NGN 232,000
  // by default. The super admin can change both amounts in Platform
  // Control (withdraw_min_ghs / withdraw_min_ngn); the defaults above
  // apply until a value is saved.
  const wdRules = moneyRules(currencyOfPhone(urows.length ? urows[0].phone : ''));
  const wdMin = withdrawFloorFor(currencyOfPhone(urows.length ? urows[0].phone : ''), settings);
  if (amount < wdMin) return send(res, 400, { error: 'withdrawal_below_minimum', detail: 'Minimum withdrawal is ' + wdRules.symbol + wdMin.toLocaleString('en-GB') + '.' });
  let payoutMeta = null;
  let methodLabel = method ? String(method).slice(0, 40) : 'MTN MoMo';
  if (isNgn) {
    const bankCode = String(body.bank_code || '').trim();
    const bankName = String(body.bank_name || '').trim().slice(0, 80);
    const acctNum = String(body.account_number || '').replace(/\D/g, '');
    const acctName = String(body.account_name || '').trim().slice(0, 80);
    if (!bankCode || !bankName || acctNum.length !== 10 || !acctName) {
      return send(res, 400, { error: 'bank_details_required', detail: 'Pick your bank and enter the 10-digit account number so we can pay you.' });
    }
    payoutMeta = { currency: 'NGN', bank_code: bankCode, bank_name: bankName, account_number: acctNum, account_name: acctName };
    methodLabel = 'Bank transfer';
  }
  // Bonus money is stake-only (Prince, 2026-11-09): the withdrawable
  // ceiling is balance minus the bonus bucket.
  const urow = await sql('select balance_ghs, bonus_ghs from users where id = $1', [auth.uid]);
  const bonusHeld = urow.length ? Number(urow[0].bonus_ghs || 0) : 0;
  if (bonusHeld > 0) {
    const realBal = Math.round(((urow.length ? Number(urow[0].balance_ghs || 0) : 0) - bonusHeld) * 100) / 100;
    if (amount > realBal) {
      return send(res, 400, { error: 'bonus_not_withdrawable', detail: 'Bonus money can be staked but not withdrawn. Your withdrawable balance is ' + realBal.toFixed(2) + '.' });
    }
  }
  const rows = await sql(
      `with bal as (
         update users set balance_ghs = balance_ghs - $2
         where id = $1 and balance_ghs >= $2
         returning id
       )
       insert into wallet_transactions (user_id, kind, method, amount_ghs, status, payout_meta)
       select $1, 'withdrawal', $3, -$2, 'pending', $4::jsonb from bal
       returning id, status, created_at`,
      [auth.uid, amount, methodLabel, payoutMeta ? JSON.stringify(payoutMeta) : null]
    );

  if (!rows.length) return send(res, 400, { error: 'insufficient_balance' });

  send(res, 201, { transaction: rows[0] });
});
