// GET /api/admin/stats — headline counts for the admin portals.
const { sql, send, requireAdmin, guard } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAdmin(req, res); if (!auth) return;
  const [users, admins, vip, tipsToday, pending] = await Promise.all([
    sql('select count(*)::int as n from users'),
    sql("select count(*)::int as n from users where role in ('admin','super_admin')"),
    sql('select count(*)::int as n from users where vip_until > now()'),
    sql('select count(*)::int as n from tips where play_date = current_date'),
    sql("select count(*)::int as n from tips where result = 'pending'")
  ]);
  return send(res, 200, {
    users: users[0].n, admins: admins[0].n, vip_active: vip[0].n,
    tips_today: tipsToday[0].n, tips_pending: pending[0].n
  });
});
