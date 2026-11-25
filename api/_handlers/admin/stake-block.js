const { sql, msql, readBody, send, guard, requireSuperAdmin, ensureAdminTables } = require('../../_lib');

// Super admin only: the User Stakes tab (Prince, 2026-11-25).
// The free-code loop: the super admin hands players winning booking
// codes as compensation for losses, and some players stop depositing
// altogether — they just wait for the next free code. This tab lets the
// super admin deny a player's stakes while the player can still log
// in, deposit and withdraw.
//   (a) Whole-player block (push 144): stake_blocked on users — no
//       staking at all (betslip AND casino games), with a custom
//       message or the default "This game is currently unavailable."
//   (b) One-game block (push 145, Prince's correction: "not block
//       stake just block that staked game like that slip"): a row in
//       user_game_blocks denies ONE player ONE match — any slip
//       containing that game is refused in place.js with the block's
//       message (or the default). Their other games stay open.
//   GET  ?q=<phone or name> — search players (10 max).
//   GET  ?mq=<team name> — search upcoming/live matches (10 max).
//   GET  (no q) — { blocked: [...], loop: [...], game_blocks: [...] };
//     loop = players who placed bets in the last 7 days but made no
//     completed deposit in that time, most bets first (20 max).
//   POST { id, action: 'block'|'unblock', message? } — whole-player.
//   POST { id, action: 'block_game'|'unblock_game', match_id, message? }
//     — one-game block (upsert on re-block, so the message can change).
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
    const mq = String((req.query && req.query.mq) || '').trim();
    if (mq) {
      const like = '%' + mq.replace(/[%_\\]/g, '\\$&') + '%';
      const matches = await msql(
        `select id, league, home_team, away_team, starts_at, status from matches
         where status in ('upcoming', 'live') and (home_team ilike $1 or away_team ilike $1)
         order by starts_at asc limit 10`,
        [like]);
      return send(res, 200, { matches: matches.map(m => ({
        id: m.id, league: m.league, home_team: m.home_team, away_team: m.away_team,
        starts_at: m.starts_at, status: m.status,
      })) });
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
    const gameBlocks = await sql(
      `select b.user_id, b.match_id, b.message, b.created_at,
         u.display_name, u.phone, m.home_team, m.away_team, m.league, m.starts_at, m.status
       from user_game_blocks b
       join users u on u.id = b.user_id
       left join matches m on m.id = b.match_id
       order by b.created_at desc`);
    return send(res, 200, {
      blocked: blocked.map(row),
      loop: loop.map(row),
      game_blocks: gameBlocks.map(g => ({
        user_id: g.user_id, match_id: g.match_id, message: g.message || null,
        display_name: g.display_name, phone: g.phone,
        home_team: g.home_team, away_team: g.away_team, league: g.league,
        starts_at: g.starts_at, status: g.status,
      })),
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const { id, action, message, match_id } = await readBody(req);
  if (!id || !['block', 'unblock', 'block_game', 'unblock_game'].includes(action)) return send(res, 400, { error: 'invalid_request' });
  if (id === auth.uid) return send(res, 400, { error: 'cannot_block_self' });
  const target = await sql('select id, role, display_name, phone from users where id = $1', [id]);
  if (!target.length) return send(res, 404, { error: 'user_not_found' });
  if (target[0].role !== 'player') return send(res, 403, { error: 'players_only', detail: 'Only player accounts can be stake-blocked.' });
  if (action === 'block_game' || action === 'unblock_game') {
    if (!match_id) return send(res, 400, { error: 'invalid_request', detail: 'A game is required.' });
    const m = await msql('select id from matches where id = $1', [match_id]);
    if (!m.length) return send(res, 404, { error: 'match_not_found' });
    if (action === 'block_game') {
      const msg = String(message || '').trim().slice(0, 200) || null;
      await sql(
        `insert into user_game_blocks (user_id, match_id, message, created_by) values ($1, $2, $3, $4)
         on conflict (user_id, match_id) do update set message = excluded.message, created_at = now()`,
        [id, match_id, msg, auth.uid]);
      return send(res, 200, { ok: true, default_message: DEFAULT_MSG });
    }
    const gone = await sql('delete from user_game_blocks where user_id = $1 and match_id = $2 returning id', [id, match_id]);
    if (!gone.length) return send(res, 404, { error: 'no_block', detail: 'That game is not blocked for this player.' });
    return send(res, 200, { ok: true });
  }
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
