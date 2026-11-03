// POST /api/auth/login {phone, password} -> {token, user}
const { sql, verifyPassword, issueToken, readBody, send, guard, publicUser } = require('../../_lib');

module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = await readBody(req);
  const phone = String(body.phone || '').replace(/\s+/g, '');
  const rows = await sql('select * from users where phone = $1', [phone]);
  const user = rows[0];
  if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) {
    return send(res, 401, { error: 'invalid_credentials' });
  }
  if (user.status === 'blocked') return send(res, 403, { error: 'account_blocked' });
  return send(res, 200, { token: issueToken(user), user: publicUser(user) });
});
