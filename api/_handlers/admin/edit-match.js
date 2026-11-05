const { sql, readBody, send, guard, requireSuperAdmin, ensureMatchColumns, isCustomMatch, customMatchState, expandOdds, cleanGoalSchedule, cleanCrestUrl } = require('../../_lib');

// Super admin only: edit a game HE created (a featured/custom match
// or a manual one) — Prince, 2026-11-05. Names, league, crests and
// stoppages can change any time before the game finishes; kickoff,
// the 1X2 odds and the goal schedule lock at kickoff, because bets
// are placed against them.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireSuperAdmin(req, res);
  if (!auth) return;
  await ensureMatchColumns();
  const body = await readBody(req);
  const id = String(body.id || '');
  if (!id) return send(res, 400, { error: 'match_required' });
  const rows = await sql('select * from matches where id = $1', [id]);
  if (!rows.length) return send(res, 404, { error: 'match_not_found' });
  const m = rows[0];
  const custom = isCustomMatch(m);
  if (!custom && m.external_ref) {
    return send(res, 400, { error: 'not_a_created_match', detail: 'Only games you created can be edited — this one came from a feed.' });
  }
  let kickedOff, finished;
  if (custom) {
    const st = customMatchState(m);
    finished = st.status === 'finished';
    kickedOff = st.status !== 'upcoming';
  } else {
    finished = m.status === 'finished';
    kickedOff = m.status !== 'upcoming';
  }
  if (finished) return send(res, 409, { error: 'match_finished', detail: 'This game has finished and can no longer be edited.' });
  if (kickedOff && (body.starts_at !== undefined || body.goals !== undefined || body.o1 !== undefined || body.ox !== undefined || body.o2 !== undefined)) {
    return send(res, 409, { error: 'match_already_live', detail: 'Kickoff, odds and the goal schedule lock once the game has kicked off. Names, crests and stoppages can still be edited.' });
  }

  const sets = [], vals = [];
  const put = (col, v, cast) => { vals.push(v); sets.push(col + ' = $' + vals.length + (cast ? '::' + cast : '')); };
  const name = (v, cur) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, 80) : cur; };
  const clampStop = v => Math.min(15, Math.max(0, Math.round(Number(v) || 0)));

  if (body.league !== undefined) put('league', name(body.league, m.league));
  if (body.home_team !== undefined) put('home_team', name(body.home_team, m.home_team));
  if (body.away_team !== undefined) put('away_team', name(body.away_team, m.away_team));
  if (body.home_logo !== undefined) put('home_logo', cleanCrestUrl(body.home_logo));
  if (body.away_logo !== undefined) put('away_logo', cleanCrestUrl(body.away_logo));
  if (custom && body.ht_stoppage !== undefined) put('ht_stoppage', clampStop(body.ht_stoppage));
  if (custom && body.ft_stoppage !== undefined) put('ft_stoppage', clampStop(body.ft_stoppage));

  if (!kickedOff) {
    if (body.starts_at) {
      const d = new Date(body.starts_at);
      if (Number.isNaN(d.getTime())) return send(res, 400, { error: 'invalid_start_time' });
      put('starts_at', d.toISOString());
    }
    if (custom && Array.isArray(body.goals)) put('goal_events', JSON.stringify(cleanGoalSchedule(body.goals)), 'jsonb');
    const { o1, ox, o2 } = body;
    if (Number(o1) > 1 && Number(ox) > 1 && Number(o2) > 1) {
      if (custom) {
        put('odds', JSON.stringify(expandOdds(Number(o1), Number(ox), Number(o2))), 'jsonb');
      } else {
        const cur = m.odds && typeof m.odds === 'object' ? m.odds : {};
        put('odds', JSON.stringify({ ...cur, o1: Number(o1), ox: Number(ox), o2: Number(o2) }), 'jsonb');
      }
    }
  }
  if (!sets.length) return send(res, 400, { error: 'nothing_to_update' });
  vals.push(id);
  const upd = await sql('update matches set ' + sets.join(', ') + ' where id = $' + vals.length + ' returning *', vals);
  send(res, 200, { match: upd[0] });
});
