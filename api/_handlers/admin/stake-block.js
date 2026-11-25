const { sql, readBody, send, guard, requireSuperAdmin, ensureAdminTables } = require('../../_lib');

// Super admin only: the User Stakes tab (Prince, 2026-11-25).
// The free-code loop: the super admin hands players winning booking
// codes as compensation for losses, and some players stop depositing
// altogether — they just wait for the next free code. This tab lets the
// super admin deny a player's stakes (betslip AND casino games) while
// the player can still log in, deposit and withdraw. When a blocked
// player tries to stake, place.js / games/start.js answer 403
// stake_blocked with the custom message, or the default
// "This game is currently unavailable." when no message was set.
//   GET  ?q=<phone or name> — search players (10 max).
//   GET  (no q) — { blocked: [...], loop: [...] }; loop = players who
//     placed bets in the last 7 days but made no completed deposit in
//     that time, most bets first (20 max). Those are the free-code
//     riders the tab exists to catch.
//   POST { id, action: 'block'|'unblock', message? } — block stores
//     the message (trimmed, 200 chars max; blank = default message);
//     unblock clears both the flag and the message.
const DEFAULT_MSG = 'This game is currently unavailable.';

function row(u) {
  return {
    id: u.id,
    phone: u.phone,
    display_name: u.display_name,
    balance_ghs: Number(u.balance_ghs || 0),
    stake_blocked: !!u.stake_blocked,
    stake_block_message: u.stake_block_message || null,
    lifetime_deposited: Number(u.lifetime_deposited || 0),
    bets_7d: u.bets_7d != null ? Number(u.bets_7d) : undefined,
  };
}

module.exports = guard(async (req, res) => {
  const auth = requireSuperAdmin(req, res);
  if (!auth) return;
  await ensureAdminTables();
  if (req.method === 'GET') {
    const q = String((req.query && req.query.q) || '').trim();
    if (q) {
      const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';
      const rows = await sql(
        `select u.id, u.phone, u.display_name, u.balance_ghs, u.stake_blocked, u.stake_block_message,
           coalesce((select sum(amount_ghs) from wallet_transactions where user_id = u.id and kind = 'deposit' and status = 'completed'), 0) as lifetime_deposited
         from users u
         where u.role = 'player' and (u.phone ilike $1 or coalesce(u.display_name, '') ilike $1)
         order by u.created_at desc limit 10`,
        [like]);
      return send(res, 200, { users: rows.map(row) });
    }
    const blocked = await sql(
      `select u.id, u.phone, u.display_name, u.balance_ghs, u.stake_blocked, u.stake_block_message,
         coalesce((select sum(amount_ghs) from wallet_transactions where user_id = u.id and kind = 'deposit' and status = 'completed'), 0) as lifetime_deposited
       from users u where u.role = 'player' and u.stake_blocked
       order by u.display_name nulls last, u.phone`);
    const loop = await sql(
      `select u.id, u.phone, u.display_name, u.balance_ghs, u.stake_blocked, u.stake_block_message,
         count(b.id) as bets_7d,
         coalesce((select sum(amount_ghs) from wallet_transactions where user_id = u.id and kind = 'deposit' and status = 'completed'), 0) as lifetime_deposited
       from users u join bets b on b.user_id = u.id and b.placed_at > now() - interval '7 days'
       where u.role = 'player'
         and not exists (select 1 from wallet_transactions where user_id = u.id and kind = 'deposit' and status = 'completed' and created_at > now() - interval '7 days')
       group by u.id order by bets_7d desc limit 20`);
    return send(res, 200, { blocked: blocked.map(row), loop: loop.map(row) });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const { id, action, message } = await readBody(req);
  if (!id || !['block', 'unblock'].includes(action)) return send(res, 400, { error: 'invalid_request' });
  if (id === auth.uid) return send(res, 400, { error: 'cannot_block_self' });
  const target = await sql('select id, role, display_name, phone from users where id = $1', [id]);
  if (!target.length) return send(res, 404, { error: 'user_not_found' });
  if (target[0].role !== 'player') return send(res, 403, { error: 'players_only', detail: 'Only player accounts can be stake-blocked.' });
  if (action === 'block') {
    const msg = String(message || '').trim().slice(0, 200) || null;
    const rows = await sql(
      `update users set stake_blocked = true, stake_block_message = $2 where id = $1
       returning id, phone, display_name, balance_ghs, stake_blocked, stake_block_message,
       coalesce((select sum(amount_ghs) from wallet_transactions where user_id = $1 and kind = 'deposit' and status = 'completed'), 0) as lifetime_deposited`,
      [id, msg]);
    return send(res, 200, { ok: true, user: row(rows[0]), default_message: DEFAULT_MSG });
  }
  const rows = await sql(
    `update users set stake_blocked = false, stake_block_message = null where id = $1
     returning id, phone, display_name, balance_ghs, stake_blocked, stake_block_message,
     coalesce((select sum(amount_ghs) from wallet_transactions where user_id = $1 and kind = 'deposit' and status = 'completed'), 0) as lifetime_deposited`,
    [id]);
  return send(res, 200, { ok: true, user: row(rows[0]) });
});
