const { sql, send, guard, isCustomMatch, customMatchState, fillOdds } = require('./_lib');
const { maybeRefreshLive } = require('./_espn');
const { afEnabled, maybeRefreshAf } = require('./_apifootball');

// Cross-feed duplicate detection. The two feeds spell team names
// differently (Stade Rennais vs Rennes, Olympiacos vs Olympiakos),
// so names are normalised hard (accents, punctuation and club
// filler words removed) and compared by equality, containment, or a
// small edit distance for spelling variants.
function normTeam(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(fc|afc|cf|sc|fk|ac|as|club|de|the)\b/g, ' ')
    .replace(/\s+/g, '');
}
function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
function teamSimilar(a, b) {
  const x = normTeam(a), y = normTeam(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return Math.abs(x.length - y.length) <= 2 && lev(x, y) <= 2;
}
function sameMatch(p, e) {
  const dt = Math.abs(new Date(p.starts_at) - new Date(e.starts_at));
  if (!(dt <= 45 * 60000)) return false;
  return teamSimilar(p.home_team, e.home_team) && teamSimilar(p.away_team, e.away_team);
}

// Public match list: live matches first, then upcoming by start time.
// Super-admin "featured" matches (external_ref custom:...) carry a goal
// schedule instead of a feed: their clock, score and status are derived
// from kickoff time on every read, so they play like real matches with
// no one touching them. A featured match that has run its 95 minutes
// stays visible as a result for 3 hours, then drops off.
module.exports = guard(async (req, res) => {
  // Live matches keep themselves current: the first list request after
  // a quiet couple of minutes refreshes statuses, scores and minutes
  // before answering. Both feeds run (Prince, 2026-11-04): API-Football
  // is the primary source and its matches list first; ESPN stays on as
  // the secondary source and its matches follow below. The merge is
  // seamless — nothing in the response names a provider, and when
  // both feeds carry the same real match only the API-Football copy
  // shows. A feed failure must never break the list, so errors are
  // swallowed. While no API-Football key is configured the list is
  // simply the ESPN block, exactly as before.
  const af = afEnabled();
  if (af) await maybeRefreshAf().catch(() => {});
  await maybeRefreshLive().catch(() => {});
  const rows = await sql(
    `select id, league, home_team, away_team, starts_at, status, minute,
            score_home, score_away, odds, home_logo, away_logo, external_ref, goal_events
     from matches
     where status in ('live', 'upcoming')
     order by (status = 'live') desc, starts_at asc
     limit 300`
  );
  const now = new Date();
  // Group 0 is the primary block (API-Football rows, admin manual
  // matches and the featured matches); group 1 is the ESPN block.
  const entries = [];
  for (const m of rows) {
    const grp = m.external_ref && m.external_ref.startsWith('espn:') ? 1 : 0;
    if (isCustomMatch(m)) {
      const st = customMatchState(m, now);
      if (st.status === 'finished' && now - new Date(m.starts_at) > (95 + 180) * 60000) continue;
      entries.push({ grp, row: { ...m, odds: fillOdds(m.odds), status: st.status, minute: st.minute, score_home: st.score_home, score_away: st.score_away, goal_events: undefined } });
    } else {
      entries.push({ grp, row: { ...m, odds: fillOdds(m.odds), goal_events: undefined } });
    }
  }
  // De-duplicate across feeds: an ESPN row that is the same real
  // match as a primary row (kickoff within 45 minutes and both team
  // names alike) drops out, so no match ever appears twice.
  const primaries = entries.filter(e => e.grp === 0).map(e => e.row);
  const visible = entries.filter(e => {
    if (e.grp === 0) return true;
    return !primaries.some(p => sameMatch(p, e.row));
  });
  visible.sort((a, b) => {
    const rank = (x) => x.status === 'live' ? 0 : x.status === 'upcoming' ? 1 : 2;
    return a.grp - b.grp
      || rank(a.row) - rank(b.row)
      || new Date(a.row.starts_at) - new Date(b.row.starts_at);
  });
  send(res, 200, { matches: visible.map(e => e.row) });
});
