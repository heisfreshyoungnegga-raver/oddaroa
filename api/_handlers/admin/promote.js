// POST /api/admin/promote {user_id, role} — SUPER ADMIN ONLY.
// Mirrors PrimeStake: role changes (user/admin/super_admin) live only
// in the super-admin portal, enforced here server-side.
const { sql, readBody, send, requireSuperAdmin, guard } = require('../../_lib');

module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireSuperAdmin(req, res); if (!auth) return;
  const b = await readBody(req);
  if (!['user', 'admin', 'super_admin'].includes(b.role)) return send(res, 400, { error: 'invalid_role' });
  if (String(b.user_id) === auth.uid) return send(res, 400, { error: 'cannot_change_own_role' });
  const rows = await sql('select id from users where id = $1', [String(b.user_id || '')]);
  if (!rows.length) return send(res, 404, { error: 'user_not_found' });
  await sql('update users set role = $1 where id = $2', [b.role, rows[0].id]);
  return send(res, 200, { ok: true });
});
