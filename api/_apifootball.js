const { sql } = require('./_lib');

// API-Football (API-Sports) fixture + odds sync — the site's primary
// data source once API_FOOTBALL_KEY is set in the environment
// (Prince's subscription, 2026-11-04). While the key is absent the
// site keeps running on the ESPN feed untouched; the moment the key
// appears, /api/matches flips to this module: same matches table,
// same odds keys, same read-time market fill — only the source
// changes. Team crests are API-Football's media URLs, the same ones
// GoalsVault serves.
//
// Quota care: fixtures come one call per day (all leagues in a
// single response) — 3 calls per gated refresh for yesterday /
// today / tomorrow. Odds are fetched per fixture only while a shown
// match still lacks a 1X2 line, capped per refresh, live matches
// first. A full day of constant traffic stays far under the Pro
// plan's 7,500 requests/day.
const BASE = 'https://v3.football.api-sports.io';

function afEnabled() {
  return !!process.env.API_FOOTBALL_KEY;
}

async function afFetch(path) {
  const r = await fetch(BASE + path, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('af_' + r.status);
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error('af_api_' + Object.values(j.errors)[0]);
  return j.response || [];
}

// API-Football league ids -> the labels the site already uses.
const LEAGUES = {
  39: 'England Premier League',
  140: 'Spain LaLiga',
  135: 'Italy Serie A',
  78: 'Germany Bundesliga',
  61: 'France Ligue 1',
  94: 'Portugal Primeira Liga',
  88: 'Netherlands Eredivisie',
  2: 'UEFA Champions League',
  3: 'UEFA Europa League',
  253: 'MLS',
  570: 'Ghana Premier League',
};
function leagueLabel(lg) {
  if (!lg) return null;
  if (LEAGUES[lg.id]) return LEAGUES[lg.id];
  // Ghana's top flight has carried more than one id over seasons;
  // recognise it by country + name so it never silently drops out.
  if (lg.country === 'Ghana' && /premier/i.test(lg.name || '')) return 'Ghana Premier League';
  return null;
}

const LIVE_CODES = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP'];
const DONE_CODES = ['FT', 'AET', 'PEN'];
const SKIP_CODES = ['PST', 'CANC', 'ABD', 'AWD', 'WO'];

function mapFixture(fx) {
  const label = leagueLabel(fx.league);
  if (!label) return null;
  const st = fx.fixture && fx.fixture.status && fx.fixture.status.short;
  if (SKIP_CODES.includes(st)) return null;
  const status = DONE_CODES.includes(st) ? 'finished'
    : LIVE_CODES.includes(st) ? 'live' : 'upcoming';
  return {
    external_ref: 'af:' + fx.fixture.id,
    league: label,
    home_team: fx.teams.home.name,
    away_team: fx.teams.away.name,
    home_logo: fx.teams.home.logo || null,
    away_logo: fx.teams.away.logo || null,
    starts_at: fx.fixture.date,
    status,
    minute: status === 'live' ? (fx.fixture.status.elapsed || null) : null,
    score_home: fx.goals.home || 0,
    score_away: fx.goals.away || 0,
    odds: {},
  };
}

async function upsertMatch(m) {
  await sql(
    `insert into matches (league, home_team, away_team, starts_at, status, minute, score_home, score_away, odds, external_ref, home_logo, away_logo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     on conflict (external_ref) where external_ref is not null
     do update set league = excluded.league, home_team = excluded.home_team, away_team = excluded.away_team,
       starts_at = excluded.starts_at, status = excluded.status, minute = excluded.minute,
       score_home = excluded.score_home, score_away = excluded.score_away,
       home_logo = excluded.home_logo, away_logo = excluded.away_logo,
       odds = case when excluded.odds::text = '{}' then matches.odds else excluded.odds end`,
    [m.league, m.home_team, m.away_team, m.starts_at, m.status, m.minute, m.score_home, m.score_away,
     JSON.stringify(m.odds), m.external_ref, m.home_logo, m.away_logo]
  );
}

// Bookmaker odds -> the site's odds keys. Prefer Bet365 (bookmaker
// id 8, per the docs' bookmaker list); otherwise the first
// bookmaker that prices the match winner. Markets are matched by
// their DOCUMENTED bet ids — 1 Match Winner, 5 Goals Over/Under,
// 12 Double Chance, 8 Both Teams Score — because the names are not
// stable: the official spec's own odds example spells bet 8
// "Both Teams Score", not "Both Teams To Score". Names stay as a
// fallback for feeds that omit ids.
const BET = { WINNER: 1, OU: 5, BTTS: 8, DC: 12 };
function oddsFromAf(bookmakers) {
  if (!Array.isArray(bookmakers) || !bookmakers.length) return {};
  const usable = bookmakers.filter(b => (b.bets || []).some(x => x.id === BET.WINNER || x.name === 'Match Winner'));
  if (!usable.length) return {};
  const bm = usable.find(b => b.id === 8) || usable[0];
  const odds = {};
  const put = (key, raw) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 1) odds[key] = Math.round(n * 100) / 100;
  };
  for (const bet of bm.bets || []) {
    const v = {};
    for (const val of bet.values || []) v[val.value] = val.odd;
    if (bet.id === BET.WINNER || bet.name === 'Match Winner') {
      put('o1', v.Home); put('ox', v.Draw); put('o2', v.Away);
    } else if (bet.id === BET.OU || bet.name === 'Goals Over/Under') {
      for (const line of ['0.5', '1.5', '2.5', '3.5', '4.5']) {
        const suffix = line.replace('.', '');
        put('over' + suffix, v['Over ' + line]);
        put('under' + suffix, v['Under ' + line]);
      }
    } else if (bet.id === BET.DC || bet.name === 'Double Chance') {
      put('dc1x', v['Home/Draw']); put('dc12', v['Home/Away']); put('dcx2', v['Draw/Away']);
    } else if (bet.id === BET.BTTS || /^both teams( to)? score$/i.test(bet.name || '')) {
      put('gg', v.Yes); put('ng', v.No);
    }
  }
  return odds;
}

function ymdOf(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

const ODDS_CAP_PER_REFRESH = 25;

async function refreshAf() {
  let imported = 0;
  for (const offset of [-1, 0, 1]) {
    let fixtures = [];
    try { fixtures = await afFetch('/fixtures?date=' + ymdOf(offset)); } catch (e) { continue; }
    for (const fx of fixtures) {
      const m = mapFixture(fx);
      if (!m) continue;
      await upsertMatch(m);
      imported++;
    }
  }
  // Odds pass: shown matches (live, or kicking off within 24h) that
  // still have no 1X2 line get one odds call each, live first.
  const needy = await sql(
    `select id, external_ref, odds from matches
     where external_ref like 'af:%' and status in ('live', 'upcoming')
       and starts_at < now() + interval '24 hours'
       and not (odds ? 'o1')
     order by (status = 'live') desc, starts_at asc
     limit $1`,
    [ODDS_CAP_PER_REFRESH]
  );
  let priced = 0;
  for (const row of needy) {
    const fixtureId = row.external_ref.slice(3);
    let resp = [];
    try { resp = await afFetch('/odds?fixture=' + fixtureId); } catch (e) { continue; }
    const fresh = oddsFromAf(resp[0] && resp[0].bookmakers);
    if (!fresh.o1) continue;
    const merged = { ...(row.odds || {}), ...fresh };
    await sql('update matches set odds = $1::jsonb where id = $2', [JSON.stringify(merged), row.id]);
    priced++;
  }
  return { imported, priced };
}

// Same anti-stampede gate as the ESPN refresh, separate clock.
const REFRESH_MS = 120000;
async function maybeRefreshAf() {
  const now = Date.now();
  const claimed = await sql(
    `insert into operator_settings (key, value) values ('af_refresh_at', $1)
     on conflict (key) do update set value = excluded.value
       where operator_settings.value ~ '^[0-9]+$' and operator_settings.value::bigint <= $2
     returning key`,
    [String(now), String(now - REFRESH_MS)]
  );
  if (!claimed.length) return false;
  await refreshAf();
  return true;
}

module.exports = { afEnabled, maybeRefreshAf, refreshAf, mapFixture, oddsFromAf, LEAGUES };
