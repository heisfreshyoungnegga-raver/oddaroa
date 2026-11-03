// POST /api/auth/register {phone, password, display_name?, inviteToken?}
// With a valid one-time invite token, the new account gets the invite's
// role (admin / super_admin) and the invite is burned. Without one the
// account is a plain user. This is the only public way accounts appear.
const crypto = require('crypto');
const { sql, hashPassword, issueToken, readBody, send, guard, publicUser } = require('../../_lib');

module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = await readBody(req);
  const phone = String(body.phone || '').replace(/\s+/g, '');
  const password = String(body.password || '');
  if (!/^\+?\d{9,15}$/.test(phone)) return send(res, 400, { error: 'invalid_phone' });
  if (password.length < 6) return send(res, 400, { error: 'password_too_short' });

  const existing = await sql('select id from users where phone = $1', [phone]);
  if (existing.length) return send(res, 409, { error: 'phone_already_registered' });

  let role = 'user';
  let invite = null;
  if (body.inviteToken) {
    const tokenHash = crypto.createHash('sha256').update(String(body.inviteToken)).digest('hex');
    const rows = await sql('select * from invites where token_hash = $1 and used_at is null and expires_at > now()', [tokenHash]);
    if (!rows.length) return send(res, 400, { error: 'invite_invalid_or_expired' });
    invite = rows[0];
    role = invite.role;
  }

  const created = await sql(
    'insert into users (phone, password_hash, display_name, role) values ($1, $2, $3, $4) returning *',
    [phone, hashPassword(password), String(body.display_name || '').slice(0, 60) || null, role]
  );
  const user = created[0];
  if (invite) await sql('update invites set used_at = now(), used_by = $1 where id = $2', [user.id, invite.id]);
  return send(res, 201, { token: issueToken(user), user: publicUser(user) });
});
