const { sql, send, guard, requireAuth, currencyOfPhone, moneyRules, depositFloorFor, getSettings } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const [userRows, countRows, settingRows, txns] = await Promise.all([
    sql('select balance_ghs, bonus_ghs, phone, role from users where id = $1', [auth.uid]),
    sql('select completed_deposit_count($1) as n', [auth.uid]),
    sql("select value from operator_settings where key = 'withdraw_deposits_required'"),
    sql('select id, kind, method, amount_ghs, status, external_ref, created_at from wallet_transactions where user_id = $1 order by created_at desc limit 50', [auth.uid])
  ]);
  const settingsRows = await sql("select key, value from operator_settings where key in ('manual_deposit_network', 'manual_deposit_number', 'manual_deposit_name')");
  const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const urow = userRows.length ? userRows[0] : {};
  const ucur = currencyOfPhone(urow.phone || '');
  const minSettings = await getSettings(['deposit_min_ghs', 'deposit_min_ngn']);
  const depMin = depositFloorFor(urow, ucur, minSettings);
  const depMax = moneyRules(ucur).maxDeposit;
  const required = settingRows.length ? Number(settingRows[0].value) : 6;
  const completed = countRows.length ? Number(countRows[0].n) : 0;
  send(res, 200, {
    balance_ghs: userRows.length ? Number(userRows[0].balance_ghs) : 0,
    bonus_ghs: userRows.length ? Number(userRows[0].bonus_ghs || 0) : 0,
    deposits_completed: completed,
    deposits_required: required,
    withdrawals_unlocked: completed >= required,
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
