const { sql, send, guard, requireAuth, getSettings, cashoutQuoteFor, isCustomMatch, customMatchState } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const rows = await sql(
    `select b.id, b.code, b.booking_code, b.stake_ghs, b.total_odds, b.potential_ghs, b.status, b.placed_at, b.settled_at, b.kind, b.bonus_pct, b.system_label,
            coalesce(json_agg(json_build_object(
              'match_id', s.match_id, 'market', s.market, 'pick', s.pick,
              'odds', s.odds, 'result', s.result,
              'home_team', m.home_team, 'away_team', m.away_team, 'league', m.league
            ) order by s.id) filter (where s.id is not null), '[]') as selections
     from bets b
     left join bet_selections s on s.bet_id = b.id
     left join matches m on m.id = s.match_id
     where b.user_id = $1
     group by b.id
     order by b.placed_at desc
     limit 100`,
    [auth.uid]
  );
  // Attach a live cashout quote to each open ticket (null when no
  // cashout is offered — e.g. a leg is live — and the client then
  // shows no button and no message, Prince's rule, 2026-11-05).
  const openIds = rows.filter(b => b.status === 'open').map(b => b.id);
  if (openIds.length) {
    const legs = await sql(
      `select s.bet_id, s.market, s.pick, s.result, to_jsonb(m) as match
       from bet_selections s join matches m on m.id = s.match_id
       where s.bet_id = any($1::uuid[])`,
      [openIds]
    );
    const settings = await getSettings(['cashout_margin_pct']);
    const byBet = new Map();
    for (const l of legs) {
      if (!byBet.has(l.bet_id)) byBet.set(l.bet_id, []);
      byBet.get(l.bet_id).push(l);
    }
    const matchById = new Map();
    for (const l of legs) if (l.match && l.match.id) matchById.set(l.match.id, l.match);
    for (const b of rows) {
      if (b.status !== 'open') continue;
      b.cashout_ghs = cashoutQuoteFor(b, byBet.get(b.id) || [], settings.cashout_margin_pct);
      // Live state per leg (Prince's ask 2026-11-05, same as
      // PrimeStake): the Bets view shows a leg's match as LIVE with
      // its current score and clock instead of a bare "pending".
      // Custom matches derive state from their real football clock
      // (minute_label carries 45+2′ / HT / 90+3′); feed matches use
      // their stored status and score.
      for (const s of (b.selections || [])) {
        const m = matchById.get(s.match_id);
        if (!m) continue;
        if (isCustomMatch(m)) {
          const st = customMatchState(m);
          s.match_status = st.status;
          s.live_home = st.score_home;
          s.live_away = st.score_away;
          s.live_minute = st.minute;
          s.live_label = st.minute_label || null;
        } else {
          s.match_status = m.status;
          s.live_home = m.score_home;
          s.live_away = m.score_away;
          s.live_minute = null;
          s.live_label = null;
        }
      }
    }
  }
  // Honest win percentile for the celebration popup: among all
  // betslips that WON in the last 30 days, the share that paid less
  // than this ticket. Needs a real sample (>= 5 wins) or it stays
  // null and the client hides the panel.
  const wonMine = rows.filter(b => b.status === 'won');
  if (wonMine.length) {
    const stats = await sql(
      `select potential_ghs from bets where status = 'won' and settled_at > now() - interval '30 days'`
    );
    if (stats.length >= 5) {
      const pots = stats.map(r => Number(r.potential_ghs));
      for (const b of wonMine) {
        const below = pots.filter(p => p < Number(b.potential_ghs)).length;
        b.win_pct = Math.round(100 * below / pots.length);
      }
    }
  }
  send(res, 200, { bets: rows });
});
