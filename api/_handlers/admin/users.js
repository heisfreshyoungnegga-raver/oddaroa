// GET /api/admin/users — user list for the portals (no password hashes).
const { sql, send, requireAdmin, guard, publicUser } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAdmin(req, res); if (!auth) return;
  const rows = await sql('select * from users order by created_at desc limit 500');
  return send(res, 200, { users: rows.map(publicUser) });
});
