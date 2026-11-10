const { msql, readBody, send, guard, requireSuperAdmin, ensureTeamBadges, bustTeamBadges, cleanCrestUrl } = require('../../_lib');

// Team badges (Prince, 2026-11-10): the feed has no real logo for
// some teams (missing, dead link, or a generic placeholder graphic).
// Those teams show NO badge on the player site; the super admin adds
// real badges here instead, per team, and the override wins over the
// feed logo on every match that team plays — current and future.
module.exports = guard(async (req, res) => {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;
  await ensureTeamBadges().catch(() => {});
  if (req.method === 'GET') {
    const rows = await msql(
      `select home_team, away_team, home_logo, away_logo from matches
       where status = 'live' or (status = 'upcoming' and starts_at > now() - interval '3 hours')`
    );
    const teams = new Map();
    const add = (name, logo) => {
      if (!name) return;
      const key = String(name).trim().toLowerCase();
      const t = teams.get(key) || { team: name, logo: null, matches: 0 };
      if (logo && !t.logo) t.logo = logo;
      t.matches++;
      teams.set(key, t);
    };
    for (const m of rows) { add(m.home_team, m.home_logo); add(m.away_team, m.away_logo); }
    const saved = await msql('select team_key, logo from team_badges').catch(() => []);
    const overrides = new Map(saved.map(r => [r.team_key, r.logo]));
    const list = [...teams.entries()].map(([key, t]) => ({ team: t.team, logo: t.logo, matches: t.matches, override: overrides.get(key) || null }));
    const rank = t => t.override ? 1 : (t.logo ? 2 : 0);
    list.sort((a, b) => rank(a) - rank(b) || a.team.localeCompare(b.team));
    return send(res, 200, { teams: list });
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    const team = String(body.team || '').trim();
    if (!team) return send(res, 400, { error: 'team_required' });
    const key = team.toLowerCase();
    const logo = String(body.logo || '').trim();
    if (!logo) {
      await msql('delete from team_badges where team_key = $1', [key]);
      bustTeamBadges();
      return send(res, 200, { ok: true, cleared: true });
    }
    const clean = cleanCrestUrl(logo);
    if (!clean) return send(res, 400, { error: 'crest_invalid', detail: 'That image could not be accepted — use an image URL or a smaller image file.' });
    await msql(
      `insert into team_badges (team_key, team_name, logo, updated_at) values ($1, $2, $3, now())
       on conflict (team_key) do update set team_name = excluded.team_name, logo = excluded.logo, updated_at = now()`,
      [key, team, clean]
    );
    bustTeamBadges();
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method_not_allowed' });
});
