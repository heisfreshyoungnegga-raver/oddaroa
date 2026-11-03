// POST /api/admin/block {user_id, blocked:true|false} — admin level.
// Admins cannot block other admins; only a super admin can (via promote
// rules) — and nobody can block a super admin from these portals.
const { sql, readBody, send, requireAdmin, guard } = require('../../_lib');

module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAdmin(req, res); if (!auth) return;
  const b = await readBody(req);
  const rows = await sql('select * from users where id = $1', [String(b.user_id || '')]);
  if (!rows.length) return send(res, 404, { error: 'user_not_found' });
  const target = rows[0];
  if (target.role === 'super_admin') return send(res, 403, { error: 'cannot_block_super_admin' });
  if (target.role === 'admin' && auth.role !== 'super_admin') return send(res, 403, { error: 'admin_cannot_block_admin' });
  await sql('update users set status = $1 where id = $2', [b.blocked ? 'blocked' : 'active', target.id]);
  return send(res, 200, { ok: true });
});
