// /api/admin/invite — SUPER ADMIN ONLY (PrimeStake model).
// POST {role: 'admin'|'super_admin'} -> {invite_url, expires_at}: creates
// a one-time link, valid 48h, shown once (only its hash is stored).
// GET -> recent invites with status.
const crypto = require('crypto');
const { sql, readBody, send, requireSuperAdmin, guard } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireSuperAdmin(req, res); if (!auth) return;
  if (req.method === 'GET') {
    const rows = await sql(
      `select id, role, expires_at, used_at, created_at,
        case when used_at is not null then 'used' when expires_at < now() then 'expired' else 'pending' end as status
       from invites order by created_at desc limit 50`
    );
    return send(res, 200, { invites: rows });
  }
  if (req.method === 'POST') {
    const b = await readBody(req);
    if (!['admin', 'super_admin'].includes(b.role)) return send(res, 400, { error: 'invalid_role' });
    const token = crypto.randomBytes(24).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const rows = await sql(
      "insert into invites (token_hash, role, created_by, expires_at) values ($1, $2, $3, now() + interval '48 hours') returning expires_at",
      [tokenHash, b.role, auth.uid]
    );
    const host = req.headers.host || 'oddaroa.vercel.app';
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    return send(res, 201, {
      invite_url: `${proto}://${host}/invite.html?token=${token}`,
      role: b.role, expires_at: rows[0].expires_at
    });
  }
  return send(res, 405, { error: 'method_not_allowed' });
});
