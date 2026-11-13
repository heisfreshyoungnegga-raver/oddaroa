const { sql, readBody, send, guard, requireAuth, ensureAdminTables, ensurePaymentTables, getSettings, currencyOfPhone, maintenanceBlocked } = require('../../_lib');

// Withdrawal request: the balance is held immediately, and the database
// trigger refuses the insert until the user reaches the required number
// of completed deposits. Admin rejection refunds the hold automatically.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  await ensureAdminTables();
  const maint = await maintenanceBlocked(auth);
  if (maint) return send(res, 503, { error: 'maintenance_mode', detail: maint });
  const settings = await getSettings(['payouts_frozen']);
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
  let rows;
  try {
    rows = await sql(
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
  } catch (e) {
    if (String(e.dbMessage || '').includes('withdrawal locked')) {
      // The trigger reports one of three stages (Prince, 2026-11-11):
      // Stage 1 "GHS X of GHS Y deposited", Stage 2a "verification
      // fee not paid", Stage 2b "account not verified". The client
      // now SHOWS the GHS 600 progress on the Withdraw page (his
      // order, superseding the 2026-11-04 conceal-the-total rule).
      const msg = String(e.dbMessage || '');
      const cm = /GHS ([\d.]+) of GHS ([\d.]+) deposited/.exec(msg);
      if (msg.includes('verification fee not paid')) {
        return send(res, 403, { error: 'withdrawal_locked', reason: 'kyc_fee' });
      }
      if (msg.includes('account not verified')) {
        return send(res, 403, { error: 'withdrawal_locked', reason: 'kyc_verify' });
      }
      return send(res, 403, {
        error: 'withdrawal_locked',
        reason: 'min_deposit',
        lifetime_deposited: cm ? Number(cm[1]) : 0,
        min_required: cm ? Number(cm[2]) : 600,
      });
    }
    throw e;
  }
  if (!rows.length) return send(res, 400, { error: 'insufficient_balance' });
  // Stage 3 (NTT) pre-paid binding (Prince, 2026-11-11 — ported from
  // ApexBet, where the activate page did this): a fee the player paid
  // in advance (reference-less, approved) is spent on the first
  // withdrawal that is requested, so one fee covers exactly one
  // payout and the payout-confirm gate sees it bound.
  await sql(
    `update adapter_manual_fees set reference = $2
     where id = (select id from adapter_manual_fees
                 where user_id = $1 and kind = 'activation' and status = 'paid' and reference is null
                 order by created_at asc limit 1)`,
    [auth.uid, rows[0].id]
  ).catch(() => {});
  send(res, 201, { transaction: rows[0] });
});
