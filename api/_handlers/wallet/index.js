const { sql, send, guard, requireAuth, currencyOfPhone, moneyRules, depositFloorFor, getSettings } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const [userRows, countRows, txns, gateRows] = await Promise.all([
    sql('select balance_ghs, bonus_ghs, phone, role, kyc_fee_paid, kyc_verified from users where id = $1', [auth.uid]),
    sql('select completed_deposit_count($1) as n, completed_deposit_total($1) as total', [auth.uid]),
    sql('select id, kind, method, amount_ghs, status, external_ref, created_at from wallet_transactions where user_id = $1 order by created_at desc limit 50', [auth.uid]),
    sql(`select
        (select coalesce(sum(amount_ghs), 0) from wallet_transactions where user_id = $1 and kind = 'deposit' and status = 'completed') as lifetime,
        (select status from adapter_manual_fees f where f.user_id = $1 and f.kind = 'activation' and f.status = 'paid' and f.reference is null order by f.created_at asc limit 1) as ntt_prepaid,
        (select json_agg(x) from (select wt.id, wt.amount_ghs, wt.created_at,
            (select status from adapter_manual_fees f where f.kind = 'activation' and f.reference = wt.id::text order by f.created_at desc limit 1) as ntt_status
          from wallet_transactions wt where wt.user_id = $1 and wt.kind = 'withdrawal' and wt.status = 'pending'
          order by wt.created_at desc) x) as pending_withdrawals`, [auth.uid])
  ]);
  const settingsRows = await sql("select key, value from operator_settings where key in ('manual_deposit_network', 'manual_deposit_number', 'manual_deposit_name')");
  const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const urow = userRows.length ? userRows[0] : {};
  const ucur = currencyOfPhone(urow.phone || '');
  const minSettings = await getSettings(['deposit_min_ghs', 'deposit_min_ngn']);
  const depMin = depositFloorFor(urow, ucur, minSettings);
  const depMax = moneyRules(ucur).maxDeposit;
  // Withdrawal gates (Prince, 2026-11-11 — ported from ApexBet):
  // Stage 1 = GHS 600 cumulative completed deposits (shown openly
  // on the Withdraw page now), Stage 2 = GHS 100 verification fee
  // paid + super-admin verified mark, Stage 3 (NTT) = GHS 500 per
  // withdrawal, OFF unless the super admin switches it on. Admin and
  // super_admin tiers bypass the gauntlet, as before.
  const gate = await getSettings(['withdraw_min_cumulative_ghs', 'verification_fee_ghs', 'ntt_enabled', 'ntt_fee_ghs']);
  const minTotal = Number(gate.withdraw_min_cumulative_ghs) || 600;
  const verifyFee = Number(gate.verification_fee_ghs) || 100;
  const nttEnabled = gate.ntt_enabled === '1';
  const nttFee = nttEnabled ? (Number(gate.ntt_fee_ghs) || 500) : 0;
  const lifetime = gateRows.length ? Number(gateRows[0].lifetime || 0) : 0;
  const feePaid = !!urow.kyc_fee_paid;
  const verified = !!urow.kyc_verified;
  const privileged = urow.role === 'admin' || urow.role === 'super_admin';
  const nttPrepaid = !!gateRows.length && gateRows[0].ntt_prepaid === 'paid';
  const completed = countRows.length ? Number(countRows[0].n) : 0;
  send(res, 200, {
    balance_ghs: userRows.length ? Number(userRows[0].balance_ghs) : 0,
    bonus_ghs: userRows.length ? Number(userRows[0].bonus_ghs || 0) : 0,
    deposits_completed: completed,
    lifetime_deposited: lifetime,
    withdraw_min_cumulative_ghs: minTotal,
    verification_fee_ghs: verifyFee,
    kyc_fee_paid: feePaid,
    kyc_verified: verified,
    ntt_enabled: nttEnabled,
    ntt_fee_ghs: nttFee,
    ntt_prepaid: nttPrepaid,
    pending_withdrawals: (gateRows.length && gateRows[0].pending_withdrawals) || [],
    withdrawals_unlocked: privileged || (lifetime >= minTotal && feePaid && verified),
    deposit_min: depMin,
    deposit_max: depMax,
    manual_deposit: {
      network: settings.manual_deposit_network || '',
      number: settings.manual_deposit_number || '',
      name: settings.manual_deposit_name || ''
    },
    transactions: txns.map(t => ({ ...t, amount_ghs: Number(t.amount_ghs) }))
  });
});
