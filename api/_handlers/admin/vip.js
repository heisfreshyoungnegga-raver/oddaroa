// POST /api/admin/vip {user_id, days} — grant VIP (admin level).
// days <= 0 revokes. This is how WhatsApp-paid VIP is switched on.
const { sql, readBody, send, requireAdmin, guard } = require('../../_lib');

module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAdmin(req, res); if (!auth) return;
  const b = await readBody(req);
  const days = Number(b.days);
  const rows = await sql('select * from users where id = $1', [String(b.user_id || '')]);
  if (!rows.length) return send(res, 404, { error: 'user_not_found' });
  if (days <= 0) {
    await sql('update users set vip_until = null where id = $1', [rows[0].id]);
  } else {
    // Extend from the later of now / current expiry, so renewals stack.
    await sql(
      'update users set vip_until = greatest(coalesce(vip_until, now()), now()) + ($1 || \' days\')::interval where id = $2',
      [String(Math.floor(days)), rows[0].id]
    );
  }
  const updated = await sql('select vip_until from users where id = $1', [rows[0].id]);
  return send(res, 200, { ok: true, vip_until: updated[0].vip_until });
});
