const { sql, readBody, send, guard, requireAdmin, ensureMatchColumns, isCustomMatch, customMatchState } = require('../../_lib');

// Admin match manager: list all matches, create new ones, and update
// live state (status, minute, score). Custom (featured) matches carry
// no stored live state — theirs is derived from the clock, so the
// list enriches them with the derived status, score and label.
module.exports = guard(async (req, res) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  if (req.method === 'GET') {
    await ensureMatchColumns().catch(() => {});
    // ?created=1 returns ONLY the games the admin side created
    // (featured + manual). The general list is capped at 200 by
    // kickoff, and feed sweeps run five days ahead — created games
    // would fall off the end and vanish from their own section.
    const onlyCreated = req.query && String(req.query.created || '') === '1';
    const rows = onlyCreated
      ? await sql("select * from matches where external_ref like 'custom:%' or external_ref is null order by starts_at desc limit 200")
      : await sql('select * from matches order by starts_at desc limit 200');
    const now = new Date();
    const out = rows.map(m => {
      if (!isCustomMatch(m)) return m;
      const st = customMatchState(m, now);
      return { ...m, status: st.status, minute: st.minute, minute_label: st.minute_label, phase: st.phase, score_home: st.score_home, score_away: st.score_away };
    });
    return send(res, 200, { matches: out });
  }
  const body = await readBody(req);
  if (req.method === 'POST') {
    const { league, home_team, away_team, starts_at, odds } = body;
    if (!league || !home_team || !away_team || !starts_at) return send(res, 400, { error: 'league_home_away_time_required' });
    const rows = await sql(
      'insert into matches (league, home_team, away_team, starts_at, odds) values ($1, $2, $3, $4, $5::jsonb) returning *',
      [league, home_team, away_team, starts_at, JSON.stringify(odds || {})]
    );
    return send(res, 201, { match: rows[0] });
  }
  if (req.method === 'PATCH') {
    const { id, status, minute, score_home, score_away, odds } = body;
    const rows = await sql(
      `update matches set
         status = coalesce($2, status),
         minute = coalesce($3, minute),
         score_home = coalesce($4, score_home),
         score_away = coalesce($5, score_away),
         odds = coalesce($6::jsonb, odds)
       where id = $1 returning *`,
      [id, status || null, minute ?? null, score_home ?? null, score_away ?? null, odds ? JSON.stringify(odds) : null]
    );
    if (!rows.length) return send(res, 404, { error: 'match_not_found' });
    return send(res, 200, { match: rows[0] });
  }
  send(res, 405, { error: 'method_not_allowed' });
});
