const { sql, send, guard, requireAdmin } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  // Withdrawals are super-admin only (Prince, 2026-11-05): a regular
  // admin's queue shows deposits — their job to confirm — and never
  // a withdrawal row. The filter is here, server-side, so the data
  // itself never reaches an admin's browser.
  const rows = await sql(
    auth.role === 'super_admin'
      ? 'select * from admin_pending_queue'
      : "select * from admin_pending_queue where kind <> 'withdrawal'"
  );
  send(res, 200, { queue: rows.map(r => ({ ...r, amount_ghs: Number(r.amount_ghs) })) });
});
