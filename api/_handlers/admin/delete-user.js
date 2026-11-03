// POST /api/admin/delete-user {user_id} — SUPER ADMIN ONLY.
// Cannot delete a super admin or yourself.
const { sql, readBody, send, requireSuperAdmin, guard } = require('../../_lib');

module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireSuperAdmin(req, res); if (!auth) return;
  const b = await readBody(req);
  if (String(b.user_id) === auth.uid) return send(res, 400, { error: 'cannot_delete_self' });
  const rows = await sql('select * from users where id = $1', [String(b.user_id || '')]);
  if (!rows.length) return send(res, 404, { error: 'user_not_found' });
  if (rows[0].role === 'super_admin') return send(res, 403, { error: 'cannot_delete_super_admin' });
  await sql('delete from users where id = $1', [rows[0].id]);
  return send(res, 200, { ok: true });
});
