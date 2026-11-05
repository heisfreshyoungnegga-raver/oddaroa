// Oddaroa front end. All account, match, bet and wallet data comes
// from the Oddaroa API (/api). Nothing is faked locally: when the
// backend is not configured yet, pages say so instead of showing
// sample data.

const state = {
  view: 'home',
  league: 'All',
  market: '1X2',
  date: 'All',
  pop: '',
  lastSync: null,
  joinCountry: '+233',
  joinPhone: '',
  sport: 'Soccer',
  query: '',
  filtersOpen: false,
  matchId: null, prevView: 'home', game: null,
  fullBooks: {}, // matchId -> the match's full market book (fetched on demand)
  slip: new Map(), // key -> {matchId, matchLabel, league, market, pick, odd}
  user: null,
  token: localStorage.getItem('od_token') || '',
  heroIdx: 0,
  matches: [],
  matchesLoaded: false,
  offline: false,
  myBets: [],
  wallet: null,
  walletTab: 'instant',
  walletSection: 'deposit',
  referrals: null,
  momo: null,
  momoOff: false,
  verifyResult: '',
  slipCode: '',
  supportMsgs: [],
};

const $ = (s, r = document) => r.querySelector(s);
const root = $('#viewRoot');

const MARKET_LIST = ['1X2', 'Double Chance', 'Over/Under 0.5', 'Over/Under 1.5', 'Over/Under 2.5', 'Over/Under 3.5', 'Over/Under 4.5', 'Both Teams To Score'];
const MARKET_KEYS = {
  '1X2': [['1', 'o1'], ['X', 'ox'], ['2', 'o2']],
  'Double Chance': [['1X', 'dc1x'], ['12', 'dc12'], ['X2', 'dcx2']],
  'Both Teams To Score': [['Yes', 'gg'], ['No', 'ng']],
};
// Every half-goal total line gets its market entry: keys over05..under45.
['0.5', '1.5', '2.5', '3.5', '4.5'].forEach(line => {
  const s = line.replace('.', '');
  MARKET_KEYS['Over/Under ' + line] = [['Over ' + line, 'over' + s], ['Under ' + line, 'under' + s]];
});
const DATES = ['All', 'Today', 'Live', 'Tomorrow'];

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3600);
}
function esc(s) { return String(s == null ? '' : s).replace(/</g, '&lt;'); }
// A drawn padlock (vector), not the emoji — same icon everywhere a
// price is locked, styled by .lock-symbol in styles.css.
const LOCK_ICON = '<span class="lock-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><rect x="5" y="10.5" width="14" height="9" rx="2" fill="currentColor"/><circle cx="12" cy="15" r="1.7" fill="#000" opacity="0.45"/></svg></span>';
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function money(n) { return 'GHS ' + Number(n || 0).toFixed(2); }

/* ---------- API client ---------- */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let res;
  try {
    res = await fetch('/api' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    const err = new Error('network_error'); err.code = 'network_error'; throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && data.error === 'backend_not_configured') {
    state.offline = true;
    const err = new Error('backend_not_configured'); err.code = data.error; throw err;
  }
  if (!res.ok) {
    const err = new Error(data.error || 'request_failed');
    err.code = data.error || 'request_failed';
    err.detail = data.detail || '';
    err.data = data;
    throw err;
  }
  return data;
}
function errToast(e, fallback) {
  const map = {
    backend_not_configured: 'Service is being set up — the backend is not live yet. Please check back shortly.',
    network_error: 'Network problem — check your connection and try again.',
    insufficient_balance: 'Insufficient balance for that stake.',
    wrong_phone_or_password: 'Wrong phone number or password.',
    phone_already_registered: 'That phone number is already registered — log in instead.',
    password_too_short: 'Password must be at least 6 characters.',
    invalid_phone: 'Enter a valid phone number.',
    email_required: 'An email address is required to create an account.',
    invalid_email: 'Enter a valid email address.',
    email_already_registered: 'That email is already registered — log in instead.',
    account_blocked: 'This account has been blocked. Contact support.',
    withdrawal_locked: 'Withdrawals are not available on your account yet — please contact support.',
    match_finished: 'One of those matches has already finished.',
    match_live_locked: 'Live matches are locked — betting closes at kickoff.',
    one_selection_per_match: 'Only one selection per match on a slip.',
    market_unavailable: 'One of those markets is not available right now.',
    ticket_not_found: 'No ticket found with that code.',
    transaction_id_required: 'Enter the MoMo transaction ID from your confirmation.',
  };
  toast(map[e.code] || fallback || ('Something went wrong: ' + (e.detail || e.code || 'error')));
}

/* ---------- matches ---------- */
function normMatch(m) {
  return {
    id: m.id, league: m.league, home: m.home_team, away: m.away_team,
    status: m.status, minute: m.minute, sh: m.score_home, sa: m.score_away,
    starts_at: m.starts_at, odds: m.odds || {}, has_full: !!m.has_full,
    home_logo: m.home_logo || '', away_logo: m.away_logo || '',
  };
}
// Signature of everything the match views actually paint. The old
// loader re-rendered the whole page on every poll whether or not
// anything had changed, which read as the site auto-refreshing under
// the user (Prince's report, 2026-11-05): flicker, lost scroll, and
// taps swallowed mid-rebuild. Now a poll that changes nothing paints
// nothing, and a poll that does change something keeps the reader's
// scroll position.
let lastMatchSig = null;
function matchSig(list) {
  const rows = state.view === 'match' ? list.filter(m => m.id === state.matchId) : list;
  return rows.map(m => [m.id, m.status, m.minute, m.sh, m.sa, JSON.stringify(m.odds)].join(':')).join('|');
}
async function loadMatches() {
  let changed = true;
  try {
    const data = await api('/matches');
    const fresh = data.matches.map(normMatch);
    const sig = matchSig(fresh);
    changed = sig !== lastMatchSig;
    lastMatchSig = sig;
    state.matches = fresh;
    state.matchesLoaded = true;
    state.offline = false;
  } catch (e) {
    state.matches = [];
    state.matchesLoaded = true;
    lastMatchSig = null;
    if (e.code !== 'backend_not_configured') console.warn('matches load failed', e.code);
  }
  state.lastSync = new Date();
  if (changed && ['home', 'live', 'sports', 'virtual', 'match'].includes(state.view)) {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }
}
// The full market book for one match is too heavy for the list
// payload, so the details page pulls it on open (matches whose row
// carries has_full). Cached per match for the session.
async function loadMatchFull(id) {
  if (!id || state.fullBooks[id]) return;
  const m = state.matches.find(x => x.id === id);
  if (m && !m.has_full) return;
  try {
    const data = await api('/match?id=' + encodeURIComponent(id));
    if (data.match && Array.isArray(data.match.odds_full)) {
      state.fullBooks[id] = data.match.odds_full;
      if (state.view === 'match' && state.matchId === id) render();
    }
  } catch (e) { /* the classic markets still render without the book */ }
}
function leagues() {
  return ['All', ...new Set(state.matches.map(m => m.league))];
}
function marketsFor(m) { return marketsForMarket(m, state.market); }
function marketsForMarket(m, market) {
  return (MARKET_KEYS[market] || [])
    .map(([label, key]) => ({ label, odd: Number(m.odds[key]) }))
    .filter(o => o.odd > 1);
}
// Price lookup for a clicked odds button. The classic markets resolve
// through marketsForMarket, but the full book (Exact Score, HT/FT and
// the rest of odds_full) and the Handicap section are rendered from
// other sources — a click that only checked marketsForMarket found no
// price and silently did nothing, which is why those odds looked
// present but were not clickable (Prince's report, 2026-11-05). The
// server accepts these picks under the market's real stored name.
function priceForPick(m, market, pick) {
  const classic = marketsForMarket(m, market).find(x => x.label === pick);
  if (classic) return classic;
  const book = state.fullBooks[m.id];
  if (Array.isArray(book)) {
    const b = book.find(x => x.name === market);
    const v = b && b.values.find(x => String(x.value) === pick);
    if (v && Number(v.odd) > 1) return { label: pick, odd: Number(v.odd) };
  }
  if (m.odds && market.indexOf('Handicap ') === 0 && Number(m.odds.sph) > 1 && Number(m.odds.spa) > 1 && m.odds.sp_line != null) {
    const L = Number(m.odds.sp_line);
    const fmt = (x) => (x > 0 ? '+' : '') + x.toFixed(1);
    return [
      { label: 'Home ' + fmt(L), odd: Number(m.odds.sph) },
      { label: 'Away ' + fmt(-L), odd: Number(m.odds.spa) },
    ].find(x => x.label === pick) || null;
  }
  return null;
}
function slipKey(matchId, market, pick) { return matchId + '|' + market + '|' + pick; }

function matchVisible(m) {
  if (state.view === 'live' && m.status !== 'live') return false;
  if (state.view === 'sports' && m.status !== 'upcoming') return false;
  if (state.view === 'virtual' && !/virtual/i.test(m.league)) return false;
  if (['home', 'live', 'sports'].includes(state.view) && state.league !== 'All' && m.league !== state.league) return false;
  const start = new Date(m.starts_at);
  const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (state.date === 'Live' && m.status !== 'live') return false;
  if (state.date === 'Today' && m.status !== 'live' && !sameDay(start, now)) return false;
  if (state.date === 'Tomorrow') {
    const t = new Date(now); t.setDate(t.getDate() + 1);
    if (!sameDay(start, t)) return false;
  }
  if (state.pop === 'next3h' && m.status !== 'live') {
    const diff = start - now;
    if (!(diff >= 0 && diff <= 3 * 60 * 60 * 1000)) return false;
  }
  if (state.query) {
    const hay = (m.home + ' ' + m.away + ' ' + m.league).toLowerCase();
    if (!hay.includes(state.query.toLowerCase())) return false;
  }
  return true;
}
function oddsHTML(m) {
  const opts = marketsFor(m);
  if (!opts.length) return '<span class="more">Odds soon</span>';
  const locked = m.status === 'live'; // live matches are locked (betting closes at kickoff)
  return '<span class="mkt">' + state.market + '</span>' + opts.map(o => {
    const sel = state.slip.has(slipKey(m.id, state.market, o.label)) ? ' sel' : '';
    return '<button class="odd' + sel + (locked ? ' locked' : '') + '" data-odd="' + m.id + '" data-pick="' + esc(o.label) + '"' + (locked ? ' disabled' : '') + '>' +
      '<small>' + esc(o.label) + '</small>' + (locked ? '' + LOCK_ICON + '' : o.odd.toFixed(2)) + '</button>';
  }).join('');
}
function rowHTML(m) {
  let time;
  if (m.status === 'live') {
    time = '<span class="live-min">' + (m.minute != null ? m.minute + '&prime;' : 'LIVE') + '</span>';
  } else {
    time = '<span>' + fmtDate(m.starts_at) + '</span>';
  }
  // Live scores sit beside each team name (Prince's ask, 2026-11-03)
  // and update with the automatic ESPN refresh like the rest of the
  // row — no separate score column.
  const teamLine = (name, logo, score) =>
    '<div class="team">' + (logo ? '<img class="tlogo" src="' + esc(logo) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
    '<span class="tname">' + esc(name) + '</span>' +
    (score != null ? '<span class="tscore">' + score + '</span>' : '') + '</div>';
  return '<div class="mrow" data-match="' + m.id + '">' +
    '<div class="mtime">' + time + '</div>' +
    '<div class="mteams"><div class="league">' + esc(m.league) + '</div>' +
    teamLine(m.home, m.home_logo, m.status === 'live' ? m.sh : null) +
    teamLine(m.away, m.away_logo, m.status === 'live' ? m.sa : null) + '</div>' +
    '<div class="odds">' + oddsHTML(m) + '</div></div>';
}
function groupHTML(title, list, live) {
  if (!list.length) return '';
  return '<section class="group' + (live ? ' live-group' : '') + '"><div class="group-head' + (live ? ' live' : '') + '">' +
    '<span>' + title + '</span><span class="cnt">' + list.length + ' events</span></div>' +
    list.map(rowHTML).join('') + '</section>';
}
function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'TODAY';
  const t = new Date(now); t.setDate(t.getDate() + 1);
  if (sameDay(d, t)) return 'TOMORROW';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short' }).toUpperCase();
}
// Match details (Prince's ask, 2026-11-03): tapping a match card
// opens this page with EVERY market the system holds for the game —
// 1X2, Double Chance, every Over/Under line and BTTS — priced from
// the same ESPN-fed odds book the list uses. Selections add to the
// slip exactly like list odds (one selection per match).
function matchDetailsHTML() {
  const m = state.matches.find(x => x.id === state.matchId);
  const back = '<button class="btn ghost" data-back style="margin:10px 0">‹ Back</button>';
  if (!m) return back + '<div class="card"><h3>Match not available</h3><p class="muted">It may have finished or been removed.</p></div>';
  const when = m.status === 'live'
    ? '<span class="live-min">' + (m.minute != null ? m.minute + '&prime;' : 'LIVE') + '</span>'
    : esc(fmtDate(m.starts_at));
  const team = (name, logo, score) => '<div class="team">' + (logo ? '<img class="tlogo" src="' + esc(logo) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '<span class="tname">' + esc(name) + '</span>' + (score != null ? '<span class="tscore">' + score + '</span>' : '') + '</div>';
  let html = back + '<div class="card"><div class="league">' + esc(m.league) + '</div>' +
    '<div class="md-when">' + when + '</div>' +
    '<div class="md-teams">' + team(m.home, m.home_logo, m.status === 'live' ? m.sh : null) + team(m.away, m.away_logo, m.status === 'live' ? m.sa : null) + '</div></div>';
  // Live matches are locked: a lock symbol replaces each price and
  // nothing can be added to the slip once a match has kicked off.
  const locked = m.status === 'live';
  const lkCls = locked ? ' locked' : '';
  const lkDis = locked ? ' disabled' : '';
  if (locked) html += '<div class="md-lock">' + LOCK_ICON + ' Live betting is locked on this match</div>';
  const lkPrice = (odd) => locked ? '' + LOCK_ICON + '' : Number(odd).toFixed(2);
  for (const market of MARKET_LIST) {
    const opts = marketsForMarket(m, market);
    if (!opts.length) continue;
    html += '<div class="card md-sec"><h3>' + esc(market) + '</h3><div class="md-odds">' + opts.map(o => {
      const sel = state.slip.has(slipKey(m.id, market, o.label)) ? ' sel' : '';
      return '<button class="odd' + sel + lkCls + '" data-odd="' + m.id + '" data-market="' + esc(market) + '" data-pick="' + esc(o.label) + '"' + lkDis + '><small>' + esc(o.label) + '</small>' + lkPrice(o.odd) + '</button>';
    }).join('') + '</div></div>';
  }
  // Handicap (spread): ESPN publishes one line per game, so it is
  // not in MARKET_LIST (the line differs by match). The line in the
  // market name is the home team's; picks mirror it.
  if (m.odds && Number(m.odds.sph) > 1 && Number(m.odds.spa) > 1 && m.odds.sp_line != null) {
    const L = Number(m.odds.sp_line);
    const fmt = (x) => (x > 0 ? '+' : '') + x.toFixed(1);
    const market = 'Handicap ' + fmt(L);
    const opts = [
      { label: 'Home ' + fmt(L), odd: Number(m.odds.sph) },
      { label: 'Away ' + fmt(-L), odd: Number(m.odds.spa) },
    ];
    html += '<div class="card md-sec"><h3>' + esc(market) + '</h3><div class="md-odds">' + opts.map(o => {
      const sel = state.slip.has(slipKey(m.id, market, o.label)) ? ' sel' : '';
      return '<button class="odd' + sel + lkCls + '" data-odd="' + m.id + '" data-market="' + esc(market) + '" data-pick="' + esc(o.label) + '"' + lkDis + '><small>' + esc(o.label) + '</small>' + lkPrice(o.odd) + '</button>';
    }).join('') + '</div></div>';
  }
  // Full market book: every remaining market the bookmaker offers
  // for this match, in the same section style. The book arrives
  // on demand via loadMatchFull; until then the classic sections
  // above stand on their own.
  const book = state.fullBooks[m.id];
  if (Array.isArray(book)) {
    for (const b of book) {
      if (!b.values || !b.values.length) continue;
      // Display name only: the market's stored name stays 'Exact Score'
      // everywhere it is a key (buttons, slip, server settlement) —
      // Prince calls this market Correct Score, so the heading does too.
      const bTitle = b.name === 'Exact Score' ? 'Correct Score' : b.name;
      html += '<div class="card md-sec"><h3>' + esc(bTitle) + '</h3><div class="md-odds">' + b.values.map(v => {
        const label = String(v.value);
        const sel = state.slip.has(slipKey(m.id, b.name, label)) ? ' sel' : '';
        return '<button class="odd' + sel + lkCls + '" data-odd="' + m.id + '" data-market="' + esc(b.name) + '" data-pick="' + esc(label) + '"' + lkDis + '><small>' + esc(label) + '</small>' + lkPrice(v.odd) + '</button>';
      }).join('') + '</div></div>';
    }
  }
  if (!html.includes('md-sec')) {
    // No published prices yet: keep the familiar market layout on
    // screen, with a lock symbol in every odds cell (the GoalsVault
    // treatment Prince asked for) instead of a bare match page.
    html += '<div class="md-lock">' + LOCK_ICON + ' Odds locked until prices are published</div>';
    for (const market of MARKET_LIST) {
      const labels = (MARKET_KEYS[market] || []).map(([label]) => label);
      if (!labels.length) continue;
      html += '<div class="card md-sec"><h3>' + esc(market) + '</h3><div class="md-odds">' + labels.map(label =>
        '<button class="odd locked" disabled aria-label="' + esc(market + ' ' + label) + ' locked"><small>' + esc(label) + '</small>' + LOCK_ICON + '</button>'
      ).join('') + '</div></div>';
    }
  }
  return html;
}
function matchListHTML() {
  if (state.offline) {
    return '<div class="card"><h3>Matches are on their way</h3><p class="muted">The Oddaroa service is being set up right now. Fixtures and odds will appear here as soon as the backend goes live.</p></div>';
  }
  if (!state.matchesLoaded) return '<div class="skel"><i></i><i></i><i></i><i></i></div>';
  if (state.sport === 'Basketball') {
    return '<div class="card"><h3>Basketball is coming soon</h3>' +
      '<p class="muted">Basketball markets are not live yet. Soccer is open now with full markets on every match.</p>' +
      '<button class="btn gold" data-quick="Soccer">See soccer matches</button></div>';
  }
  const all = state.matches.filter(matchVisible);
  // No "EVENTS & MARKETS — N Matches Found" header (Prince removed it
  // 2026-11-03): the groups speak for themselves and the line ate space.
  let html = '';
  html += groupHTML('LIVE MATCHES', all.filter(m => m.status === 'live'), true);
  const byDay = {};
  all.filter(m => m.status === 'upcoming').forEach(m => {
    const k = dayLabel(m.starts_at);
    (byDay[k] = byDay[k] || []).push(m);
  });
  Object.keys(byDay).forEach(d => { html += groupHTML(d, byDay[d], false); });
  if (!all.length) html += '<p class="empty">No matches fit these filters right now.</p>';
  return html;
}
// The repo stores the hero photos as base64 text (the git connector
// cannot carry binary files), so decode them client-side into usable
// URLs. If a host ever serves real JPEG bytes, a blob URL is used
// instead — both worlds work.
const heroUrls = {};
// A fetched asset becomes an image URL only if it really is one:
// JPEG bytes get a blob URL, clean base64 text gets a data URL, and
// anything else (a 404 body, an HTML fallback page during a deploy)
// yields null so the caller keeps its plain-path/SVG fallback. One
// bad response used to poison a tile for the whole session — the
// broken quick tiles Prince reported on 2026-11-04.
function sniffImageUrl(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
  const text = new TextDecoder().decode(buf).replace(/\s+/g, '');
  return text.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(text) ? 'data:image/jpeg;base64,' + text : null;
}
function loadHeroImages() {
  HERO_SLIDES.forEach(s => {
    if (!s.img || heroUrls[s.img]) return;
    heroUrls[s.img] = s.img;
    fetch(s.img).then(r => (r.ok ? r.arrayBuffer() : null)).then(buf => {
      if (!buf) return;
      const u = sniffImageUrl(buf);
      if (u) { heroUrls[s.img] = u; if (state.view === 'home') render(); }
    }).catch(() => {});
  });
}
function heroHTML() {
  const s = HERO_SLIDES[state.heroIdx];
  return '<section class="hero"><img class="bg" src="' + (heroUrls[s.img] || s.img || 'assets/hero-stadium.jpg') + '" alt="">' +
    '<div class="hero-in"><p class="kicker">' + s.kicker + '</p><h1>' + s.title + '</h1>' +
    '<p>' + s.sub + '</p><button class="btn gold" data-hero-cta>' + s.cta + '</button></div>' +
    '<span class="hero-count">' + (state.heroIdx + 1) + ' of ' + HERO_SLIDES.length + '</span>' +
    '<div class="hero-dots">' + HERO_SLIDES.map((_, i) => '<i class="' + (i === state.heroIdx ? 'on' : '') + '"></i>').join('') + '</div></section>';
}
function filtersHTML() {
  const chips = (list, kind, cur) => list
    .map(x => '<button class="chip' + (x === cur ? ' on' : '') + '" data-chip="' + kind + '" data-val="' + esc(x) + '">' + esc(x) + '</button>')
    .join('');
  const row = (label, kind, list, cur) =>
    '<div class="frow2"><span class="flabel">' + label + '</span><div class="fchips">' + chips(list, kind, cur) + '</div></div>';
  // The League/Market/When rows hide behind the Filters button
  // (Prince's UX call, 2026-11-03): the open panel pushed the matches
  // far down the page. Search stays visible at all times.
  const sliders = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h9M19 7h1M4 17h3M13 17h7"/><circle cx="16" cy="7" r="2.3"/><circle cx="10" cy="17" r="2.3"/></svg>';
  return popularHTML() + '<section class="filtercard">' +
    '<div class="fbar"><div class="searchbar"><span class="sicon">⌕</span><input id="searchBox" type="search" placeholder="Search teams or leagues..." value="' + esc(state.query) + '"></div>' +
    '<button class="filterbtn' + (state.filtersOpen ? ' on' : '') + '" id="filterToggle" aria-expanded="' + !!state.filtersOpen + '">' + sliders + 'Filters<span class="fchev">' + (state.filtersOpen ? '▴' : '▾') + '</span></button></div>' +
    '<div class="frows' + (state.filtersOpen ? '' : ' closed') + '">' +
    row('League', 'league', leagues(), state.league) +
    row('Market', 'market', MARKET_LIST, state.market) +
    row('When', 'date', DATES, state.date) +
    '</div></section>';
}
// Popular one-tap filters (idea borrowed from GoalsVault, 2026-11-04):
// the shortcuts regulars actually want — next 3 hours, today's games,
// and the busiest leagues in the current feed — one tap, no menus.
function popularHTML() {
  const counts = {};
  state.matches.forEach(m => { counts[m.league] = (counts[m.league] || 0) + 1; });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 4);
  const leagueChips = top.map(l =>
    '<button class="chip' + (state.league === l && !state.pop ? ' on' : '') + '" data-chip="league" data-val="' + esc(l) + '">' + esc(l) + '</button>').join('');
  return '<div class="poprow"><span class="pop-label">Popular</span>' +
    '<button class="chip' + (state.pop === 'next3h' ? ' on' : '') + '" data-pop="next3h">Next 3 Hours</button>' +
    '<button class="chip' + (state.date === 'Today' && !state.pop ? ' on' : '') + '" data-chip="date" data-val="Today">Today\'s Football</button>' +
    leagueChips + '</div>';
}
// Instant join (idea borrowed from GoalsVault): a phone number is
// all it takes to start — the register form opens with the number
// already filled in. The dial code is TAPPABLE (Prince, 2026-11-04):
// tapping it opens the country picker, and the chosen country
// carries into the sign-up form. Signed-out visitors on Home only.
function joinHTML() {
  if (state.user) return '';
  return '<section class="join-card"><h3>Instant Registration</h3>' +
    '<form id="joinForm" class="join-flex"><span class="phoneflex join-phone">' +
    '<span class="prefix prefix-picker"><span id="joinPrefixLabel">' + state.joinCountry + '</span><span class="pp-caret">\u25BE</span>' +
    '<select id="joinCountry" aria-label="Country">' +
    ['+233 Ghana', '+234 Nigeria', '+254 Kenya', '+256 Uganda', '+255 Tanzania'].map(c => {
      const [code, name] = c.split(' ');
      return '<option value="' + code + '"' + (state.joinCountry === code ? ' selected' : '') + '>' + name + ' \u00B7 ' + code + '</option>';
    }).join('') +
    '</select></span>' +
    '<input type="tel" id="joinPhone" placeholder="Mobile number" autocomplete="tel" value="' + esc(state.joinPhone) + '"></span>' +
    '<button class="btn gold" type="submit">Join Now</button></form>' +
    '<p class="muted">Make a deposit and start betting!</p></section>';
}
// Home quick-access tiles (the icon row under the hero): each tile is a
// shortcut into a real view or filter. Icons are small inline SVGs drawn
// for Oddaroa; the Aviator tile carries the same HOT tag as Games.
const QICONS = {
  'Soccer': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7l3 2.2-1.1 3.6h-3.8L9 9.2 12 7z" fill="#141414" stroke="none"/><path d="M12 3v4M18.6 6.4L15 9.2M20.1 14.6l-4.7-1.3M15.4 20.2l-1.5-4.4M8.6 20.2l1.5-4.4M3.9 14.6l4.7-1.3M5.4 6.4L9 9.2"/></svg>',
  'Today': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15.5" r="1.4" fill="#141414" stroke="none"/></svg>',
  'Live': '<svg viewBox="0 0 24 24" fill="none" stroke="#d8232a" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="2.2" fill="#d8232a" stroke="none"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.8 5.8a9 9 0 0 0 0 12.4M18.2 5.8a9 9 0 0 1 0 12.4"/></svg>',
  'Aviator': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7" stroke-linejoin="round"><path d="M21 3L10.6 13.4M21 3l-6.6 18-3.8-7.6L3 9.6 21 3z"/></svg>',
  'Basketball': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3.2 12h17.6M12 3.2v17.6M5.6 5.6c3.4 3.6 3.4 9.2 0 12.8M18.4 5.6c-3.4 3.6-3.4 9.2 0 12.8"/></svg>',
  'Verify Bet': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 2.5V11c0 4.6-3 7.7-7 9.5C8 18.7 5 15.6 5 11V5.5L12 3z"/><path d="M9 11.6l2.2 2.2 4.3-4.3"/></svg>',
  'Booking Code': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5V10a2.5 2.5 0 0 0 0 5v1.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V15a2.5 2.5 0 0 0 0-5V8.5z"/><path d="M13.5 8v1.6M13.5 11.2v1.6M13.5 14.4V16"/></svg>',
};
// Custom tile artwork (generated for Oddaroa, black-and-gold set).
// Like the hero photos, the files in assets/ hold base64 text, so they
// are decoded client-side; until a decode lands, the inline SVG shows.
const TILE_IMGS = {
  'Soccer': 'assets/icon-soccer.jpg?v=2',
  'Today': 'assets/icon-today.jpg?v=2',
  'Live': 'assets/icon-live.jpg?v=2',
  'Aviator': 'assets/icon-aviator.jpg?v=2',
  'Basketball': 'assets/icon-basketball.jpg?v=2',
  'Verify Bet': 'assets/icon-verify.jpg?v=2',
  'Booking Code': 'assets/icon-booking.jpg?v=2',
};
const tileUrls = {};
function loadTileImages() {
  Object.keys(TILE_IMGS).forEach(label => {
    const path = TILE_IMGS[label];
    if (tileUrls[label]) return;
    tileUrls[label] = path;
    fetch(path).then(r => (r.ok ? r.arrayBuffer() : null)).then(buf => {
      if (!buf) return;
      const u = sniffImageUrl(buf);
      if (u) { tileUrls[label] = u; if (state.view === 'home') render(); }
    }).catch(() => {});
  });
}
// Game card covers (original art made for Oddaroa, 2026-11-04).
// Same base64-in-repo arrangement as the hero photos and tile icons:
// decoded client-side, plain colour tile shows until a cover lands.
const GAME_IMGS = {
  'Aviator': 'assets/game-aviator.jpg',
  'Plinko X': 'assets/game-plinko.jpg',
  'Lucky Dice': 'assets/game-dice.jpg',
  'Penalty Shootout': 'assets/game-penalty.jpg',
  'Coin Flip': 'assets/game-coin.jpg',
  'Football Penalty': 'assets/game-footpen.jpg',
};
const gameUrls = {};
function loadGameImages() {
  Object.keys(GAME_IMGS).forEach(name => {
    const path = GAME_IMGS[name];
    if (gameUrls[name]) return;
    gameUrls[name] = path;
    fetch(path).then(r => (r.ok ? r.arrayBuffer() : null)).then(buf => {
      if (!buf) return;
      const u = sniffImageUrl(buf);
      if (u) { gameUrls[name] = u; if (state.view === 'games') render(); }
    }).catch(() => {});
  });
}
function quickHTML() {
  const tiles = [
    ['Soccer', ''],
    ['Today', ''],
    ['Live', ''],
    ['Aviator', 'hot'],
    ['Basketball', ''],
    ['Verify Bet', ''],
    ['Booking Code', ''],
  ];
  return '<div class="quickrow">' + tiles.map(([label, cls]) => {
    const u = tileUrls[label];
    const art = (u && (u.startsWith('data:') || u.startsWith('blob:')))
      ? '<img class="qimg" src="' + u + '" alt="">'
      : QICONS[label];
    return '<button class="qtile' + (cls ? ' ' + cls : '') + '" data-quick="' + label + '">' +
      (cls === 'hot' ? '<span class="qhot">HOT</span>' : '') +
      '<span class="qicon">' + art + '</span><span>' + label + '</span></button>';
  }).join('') + '</div>';
}
// Mid-page visual banners: big tappable hero-style cards under the
// match list, reusing the hero photos (decoded URLs when available).
function bannerBandHTML() {
  const bg = p => heroUrls[p] || p;
  return '<div class="bannerband">' +
    '<button class="bbanner" data-nav="games"><img src="' + bg('assets/hero-plane.jpg') + '" alt=""><span class="bb-in">' +
    '<p class="bb-k">AVIATOR — HOT</p><h3>Fly high, cash out in time</h3>' +
    '<p class="bb-sub">The crash game everyone is playing.</p><span class="bb-cta">Play in Games</span></span></button>' +
    '<button class="bbanner" data-nav="promos"><img src="' + bg('assets/hero-keeper.jpg') + '" alt=""><span class="bb-in">' +
    '<p class="bb-k">PROMOTIONS</p><h3>Bonuses, cashback &amp; more</h3>' +
    '<p class="bb-sub">See what is running on Oddaroa today.</p><span class="bb-cta">View Promos</span></span></button>' +
    '</div>';
}
function promoStripHTML() {
  const p = PROMOS[0];
  return '<button class="promostrip" data-nav="promos"><span class="gtag">' + p.tag + '</span>' +
    '<span><b>' + p.title + '</b> — see what is on offer</span><span class="ps-arrow">›</span></button>';
}
function trustStripHTML() {
  // Winners ticker (Prince's ask, 2026-11-03): the sliding line under
  // the promo banner shows recent winners with their phone numbers
  // partly masked — a fresh random set is generated on every render.
  // Five winner countries (Prince, 2026-11-04): Ghana, Nigeria,
  // Uganda, Kenya and Tanzania — picked at random for every slot,
  // each with their own names, number prefixes and currency.
  const COUNTRIES = [
    { names: ['Kwame', 'Ama', 'Yaw', 'Akosua', 'Kojo', 'Efua', 'Kwabena', 'Abena', 'Kofi', 'Adjoa',
        'Kwaku', 'Esi', 'Fiifi', 'Araba', 'Nana', 'Maame', 'Paa', 'Ekua', 'Selasie', 'Edem',
        'Afi', 'Mawuli', 'Senyo', 'Dzifa', 'Elikem', 'Sitsofe', 'Abdul', 'Fuseina', 'Ibrahim', 'Aisha'],
      prefix: ['024', '025', '027', '053', '054', '055', '057', '059', '020', '050'],
      cur: 'GHS', min: 150, max: 6500, step: 5, weight: 1 },
    { names: ['Chidi', 'Ngozi', 'Emeka', 'Tunde', 'Funke', 'Olufemi', 'Blessing', 'Segun', 'Yetunde', 'Uche',
        'Ifeanyi', 'Kemi', 'Adebayo', 'Chiamaka', 'Yusuf', 'Halima', 'Obinna', 'Titilayo', 'Musa', 'Folake'],
      prefix: ['0803', '0806', '0703', '0706', '0810', '0813', '0814', '0816', '0805', '0807',
        '0705', '0811', '0815', '0802', '0808', '0708', '0812', '0809', '0817', '0818'],
      cur: '₦', min: 15000, max: 950000, step: 500, weight: 1 },
    { names: ['Kato', 'Nakato', 'Mugisha', 'Birungi', 'Ssemakula', 'Nalwoga', 'Okello', 'Achen', 'Tumwine', 'Kyomuhendo',
        'Namono', 'Aine', 'Byaruhanga', 'Namara', 'Muwanga', 'Nansubuga', 'Opio', 'Among', 'Kirabo', 'Namutebi'],
      prefix: ['0772', '0773', '0775', '0782', '0701', '0702', '0704', '0750', '0752', '0740'],
      cur: 'UGX', min: 50000, max: 3500000, step: 5000, weight: 1 },
    { names: ['Wanjiru', 'Kamau', 'Otieno', 'Achieng', 'Mwangi', 'Njeri', 'Kiprop', 'Chebet', 'Maina', 'Nyambura',
        'Ochieng', 'Wambui', 'Korir', 'Mutiso', 'Auma', 'Karanja', 'Waithera', 'Barasa', 'Nekesa', 'Omondi'],
      prefix: ['0712', '0722', '0725', '0701', '0702', '0740', '0741', '0790', '0791', '0110'],
      cur: 'KSh', min: 2000, max: 120000, step: 100, weight: 1 },
    { names: ['Juma', 'Fatuma', 'Neema', 'Baraka', 'Zawadi', 'Mwanaidi', 'Emmanuel', 'Grace', 'Hassan', 'Amina',
        'Peter', 'Anna', 'Joseph', 'Rehema', 'Said', 'Hadija', 'Kelvin', 'Lightness', 'Ombeni', 'Subira'],
      prefix: ['0713', '0715', '0655', '0677', '0744', '0754', '0766', '0684', '0699', '0622'],
      cur: 'TSh', min: 20000, max: 2500000, step: 5000, weight: 1 },
  ];
  const bag = COUNTRIES.flatMap(c => Array(c.weight).fill(c));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const items = [];
  for (let i = 0; i < 10; i++) {
    const c = pick(bag);
    const num = pick(c.prefix) + '•••' + String(Math.floor(100 + Math.random() * 900));
    const amt = Math.round((c.min + Math.random() * (c.max - c.min)) / c.step) * c.step;
    items.push('<span class="titem">🏆 <b>' + pick(c.names) + ' · ' + num + '</b> won <span class="win-amt">' + c.cur + ' ' +
      amt.toLocaleString('en-GB') + '</span></span>');
  }
  // One sliding line (duplicated half for a seamless loop); duration
  // scales with the number of winners so the speed stays constant.
  const half = items.join('<span class="tdot">•</span>') + '<span class="tdot">•</span>';
  return '<div class="trustslide"><div class="trust-track" style="animation-duration:' + (items.length * 4.5) + 's">' + half + half + '</div></div>';
}

/* ---------- account pages ---------- */
function gateHTML(title) {
  return '<div class="profile"><h2>' + title + '</h2>' +
    '<p class="modal-sub">Log in to see this page.</p>' +
    '<button class="btn gold big" data-open-auth>Login</button></div>';
}
function statusChip(s) {
  const cls = s === 'completed' || s === 'won' ? 'completed' : s === 'rejected' || s === 'lost' ? 'rejected' : 'pending';
  return '<span class="st st-' + cls + '">' + String(s).toUpperCase() + '</span>';
}
function profileHTML() {
  if (!state.user) {
    return '<div class="profile"><h2>Me</h2>' +
      '<p class="modal-sub">Log in to see your account, bets and balance.</p>' +
      '<button class="btn gold big" data-open-auth>Login</button></div>';
  }
  return '<div class="profile"><h2>' + esc(state.user.phone || state.user.email || '') + '</h2>' +
    '<div>Balance</div><div class="bal">' + money(state.user.balance_ghs) + '</div>' +
    '<button class="prow" data-nav="bets">Bets <span>›</span></button>' +
    '<button class="prow" data-nav="wallet">Wallet &amp; Transactions <span>›</span></button>' +
    '<button class="prow" data-nav="verify">Verify Bet <span>›</span></button>' +
    '<button class="prow" data-nav="booking">Booking Codes <span>›</span></button>' +
    '<button class="prow" data-nav="promos">Promotions <span>›</span></button>' +
    '<button class="prow" data-nav="support">Support <span>›</span></button>' +
    '<button class="prow" data-nav="settings">Settings <span>›</span></button>' +
    '<button class="btn ghost" id="logoutBtn" style="color:var(--live);border-color:var(--live)">Logout</button></div>';
}
// Referral links are an admin-tier tool only (Prince's rule,
// 2026-11-03): players no longer see a Refer & Earn block — the
// link, the referred list and the earnings live in the admin and
// super admin portals (My Earnings) for admin accounts only.
// Shrink a picked screenshot to a modest JPEG data URL so it can
// ride along with the manual-deposit confirmation (stored on the
// transaction row; the reviewing admin opens it from the queue).
function shrinkImage(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1280 / Math.max(img.width || 1, img.height || 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
function betCardHTML(b) {
  const legs = (b.selections || []).map(l =>
    '<div class="leg"><span>' + esc(l.home_team || '') + ' vs ' + esc(l.away_team || '') + '</span>' +
    '<span>' + esc(l.pick) + ' · ' + esc(l.market) + ' · <b>' + Number(l.odds).toFixed(2) + '</b></span>' +
    '<span class="legres">' + esc(l.result || '') + '</span></div>').join('');
  return '<div class="card"><div class="card-head"><b>' + esc(b.code) + '</b>' + statusChip(b.status) + '</div>' +
    '<p class="muted">' + fmtDate(b.placed_at) + '</p>' + legs +
    '<div class="card-row"><span>Stake</span><b>' + money(b.stake_ghs) + '</b></div>' +
    '<div class="card-row"><span>Type</span><b>' + esc(b.kind === 'system' ? 'System ' + (b.system_label || '') : b.kind === 'single' ? 'Single' : 'Multiple') + '</b></div>' +
    (Number(b.bonus_pct) > 0 ? '<div class="card-row"><span>Winnings bonus</span><b>+' + Number(b.bonus_pct) + '%</b></div>' : '') +
    '<div class="card-row"><span>Total odds</span><b>' + Number(b.total_odds).toFixed(2) + '</b></div>' +
    '<div class="card-row"><span>Potential win</span><b>' + money(b.potential_ghs) + '</b></div></div>';
}
function betsHTML() {
  if (!state.user) return gateHTML('Bets');
  return '<h2>Bets</h2>' +
    (state.myBets.length ? state.myBets.map(betCardHTML).join('') : '<p class="empty">No bets yet — add odds to your slip and place your first bet.</p>');
}
async function loadBets() {
  try {
    const data = await api('/bets/mine');
    state.myBets = data.bets;
  } catch (e) { state.myBets = []; }
  if (state.view === 'bets') render();
}
function withdrawCardHTML(w) {
  // The deposit-count withdrawal rule stays enforced server-side, but
  // players never see the counter or the requirement (Prince's call,
  // 2026-11-03): the card is a plain withdraw form, and a not-yet-eligible
  // request comes back with the generic toast so support handles it.
  return '<div class="card"><h3>Withdraw</h3>' +
    '<form id="withdrawForm" class="stack">' +
    '<label>Amount (GHS) <input type="number" id="wdAmt" min="1" value="50" required></label>' +
    '<label>Pay to <select id="wdMethod"><option>MTN MoMo</option><option>Telecel Cash</option><option>AT Money</option></select></label>' +
    '<button class="btn gold big" type="submit">Request Withdrawal</button></form>' +
    '<p class="muted">The amount is held from your balance when you request; it is paid out after review. A rejected request refunds the hold.</p></div>';
}
// Second-verification prompt (Prince's design, 2026-11-04, from his
// reference screenshot): a player who has completed at least one
// deposit but is still short of the withdrawal unlock sees this when
// a withdrawal is refused — a GHC300 verification deposit ask plus a
// progress bar that fills a step with every completed deposit. The
// required total is never shown anywhere in the UI.
const VERIFY_DEPOSITS_REQUIRED = 6;
function showVerifyModal(info) {
  closeVerifyModal();
  const done = Number(info && info.deposits_done) || 0;
  const pct = Math.min(100, Math.round((done / VERIFY_DEPOSITS_REQUIRED) * 100));
  const el = document.createElement('div');
  el.className = 'modalwrap open';
  el.id = 'verifyWrap';
  el.innerHTML = '<div class="modal">' +
    '<button class="iconbtn modal-x" data-close-verify aria-label="Close">&times;</button>' +
    '<p class="modal-sub">Second verification</p>' +
    '<h2>Complete your verification</h2>' +
    '<p>Make a <b>GHC300.00</b> deposit to unlock withdrawals on your Oddaroa account.</p>' +
    '<div class="vbar"><i style="width:' + pct + '%"></i></div>' +
    '<button class="btn gold big" data-goto-deposit>Deposit GHC300.00 to verify</button>' +
    '<button class="btn ghost big" data-done-verify>I\'ve completed a deposit</button>' +
    '<p class="muted">Deposits go to your own betting wallet. The money stays yours to bet with \u2014 it is not a fee, and nothing is taken from your balance to release a withdrawal.</p>' +
    '</div>';
  document.body.appendChild(el);
}
function closeVerifyModal() {
  const el = $('#verifyWrap');
  if (el) el.remove();
}
/* ----- Instant MoMo deposit (ShinobiPay direct push) ----- */
function detectNetworkJS(raw) {
  const digits = String(raw || '').replace(/[\s+]/g, '');
  const local = digits.startsWith('233') ? '0' + digits.slice(3) : digits;
  const p = local.slice(0, 3);
  if (['024', '025', '053', '054', '055', '059'].includes(p)) return 'MTN';
  if (['020', '050'].includes(p)) return 'TELECEL';
  if (['026', '027', '056', '057'].includes(p)) return 'AIRTELTIGO';
  return null;
}
function syncMomoFee() {
  const line = $('#mmFeeLine');
  if (!line) return;
  const amt = parseFloat(($('#mmAmt') || {}).value) || 0;
  line.textContent = amt > 0
    ? 'Your phone will ask you to approve GHS ' + (amt * 1.025).toFixed(2) + ' (includes the 2.5% processing fee). Your wallet is credited exactly GHS ' + amt.toFixed(2) + '.'
    : '';
}
let momoTimer = null;
function stopMomoPoll() { if (momoTimer) { clearInterval(momoTimer); momoTimer = null; } }
function startMomoPoll() {
  stopMomoPoll();
  let tries = 0;
  momoTimer = setInterval(async () => {
    tries++;
    if (!state.momo || state.momo.phase !== 'wait' || state.view !== 'wallet' || tries > 45) { stopMomoPoll(); return; }
    try {
      const d = await api('/wallet/deposit-status?reference=' + encodeURIComponent(state.momo.reference));
      if (d.status === 'succeeded') {
        stopMomoPoll();
        state.momo = null;
        toast('Deposit confirmed — your wallet has been credited.');
        loadWallet();
      } else if (d.status === 'failed') {
        stopMomoPoll();
        state.momo = { phase: 'failed', message: 'The payment did not go through. Nothing was charged.' };
        render();
      }
    } catch (e) { /* keep waiting — the webhook is the real signal */ }
  }, 4000);
}
function momoPanelHTML() {
  const m = state.momo;
  if (state.momoOff) {
    return '<div class="card"><h3>Mobile Money</h3>' +
      '<p class="muted">Instant mobile money deposits are being switched on. Please check back shortly.</p></div>';
  }
  if (m && m.phase === 'wait') {
    return '<div class="card"><h3>Check your phone</h3>' +
      '<p>We sent a payment prompt to <b>' + esc(m.phone) + '</b>. Approve it with your MoMo PIN to deposit <b>' + money(m.amount) + '</b>.</p>' +
      (m.ussd ? '<p class="muted">No prompt? Dial <b>' + esc(m.ussd) + '</b> and approve the pending transaction from your MoMo menu.</p>' : '') +
      '<p class="muted">Waiting for confirmation… your balance updates automatically once the payment lands. Do not pay twice.</p>' +
      '<button class="btn" data-momo-cancel>Cancel</button></div>';
  }
  if (m && m.phase === 'otp') {
    return '<div class="card"><h3>Enter the code</h3>' +
      '<p class="muted">Your network sent a one-time code for the deposit of <b>' + money(m.amount) + '</b>. Enter it to finish.</p>' +
      '<form id="momoOtpForm" class="stack"><label>One-time code <input type="text" id="mmOtp" inputmode="numeric" autocomplete="one-time-code" required></label>' +
      '<button class="btn gold big" type="submit">Confirm Code</button></form>' +
      '<button class="btn" data-momo-cancel>Cancel</button></div>';
  }
  if (m && m.phase === 'failed') {
    return '<div class="card"><h3>Payment not completed</h3>' +
      '<p class="lock-note">' + esc(m.message || 'The payment did not go through. Nothing was charged.') + '</p>' +
      '<button class="btn gold" data-momo-reset>Try Again</button></div>';
  }
  const phone = state.user ? state.user.phone : '';
  // Gateway deposits use Prince's preset amounts (2026-11-03): the chips
  // fill the amount box; a custom amount can still be typed.
  const presets = [300, 500, 1000, 1500, 2000];
  return '<div class="card"><h3>Mobile Money</h3>' +
    '<form id="momoForm" class="stack">' +
    '<div class="amtrow">' + presets.map(a =>
      '<button type="button" class="amtchip' + (a === 300 ? ' on' : '') + '" data-amt="' + a + '">GHS ' + a.toLocaleString('en-GB') + '</button>').join('') + '</div>' +
    '<label>Amount (GHS) <input type="number" id="mmAmt" min="1" max="5000" step="0.01" value="300" required></label>' +
    '<label>MoMo number <input type="tel" id="mmPhone" value="' + esc(phone) + '" required></label>' +
    '<label>Network <select id="mmNet"><option value="MTN">MTN Mobile Money</option><option value="TELECEL">Telecel Cash</option><option value="AIRTELTIGO">AT Money</option></select></label>' +
    '<p class="muted" id="mmFeeLine"></p>' +
    '<button class="btn gold big" type="submit">Send Payment Prompt</button></form>' +
    '<p class="muted">A prompt is sent to your phone — approve it with your PIN and your wallet is credited automatically.</p></div>';
}

function walletHTML() {
  if (!state.user) return gateHTML('Wallet');
  const w = state.wallet;
  if (!w) return '<h2>Wallet</h2><div class="skel"><i></i><i></i><i></i></div>';
  const tx = w.transactions.map(t =>
    '<div class="txrow"><div><b>' + esc(t.kind.replace('_', ' ')) + '</b><div class="muted">' + fmtDate(t.created_at) + ' · ' + esc(t.method || '') + '</div></div>' +
    '<div class="' + (t.amount_ghs >= 0 ? 'amt pos' : 'amt') + '">' + (t.amount_ghs >= 0 ? '+' : '−') + 'GHS ' + Math.abs(t.amount_ghs).toFixed(2) + '</div>' +
    statusChip(t.status) + '</div>').join('');
  const depositPanel = momoPanelHTML();
  // Deposit, Withdraw and History are separate views inside the wallet.
  const sec = state.walletSection;
  const sectionTabs = '<div class="wtabs">' +
    [['deposit', 'Deposit'], ['withdraw', 'Withdraw'], ['history', 'History']].map(([k, label]) =>
      '<button class="' + (sec === k ? 'on' : '') + '" data-wsec="' + k + '">' + label + '</button>').join('') + '</div>';
  let sectionBody = '';
  if (sec === 'deposit') {
    sectionBody = depositPanel;
  } else if (sec === 'withdraw') {
    sectionBody = withdrawCardHTML(w);
  } else {
    sectionBody = '<div class="card"><h3>Transactions</h3>' + (tx || '<p class="empty">No transactions yet.</p>') + '</div>';
  }
  return '<h2>Wallet</h2>' +
    '<div class="card"><div class="muted">Balance</div><div class="bal">' + money(w.balance_ghs) + '</div></div>' +
    sectionTabs + sectionBody;
}
async function loadWallet() {
  try {
    state.wallet = await api('/wallet');
  } catch (e) { state.wallet = null; }
  if (state.view === 'wallet') render();
  if (state.wallet && state.user) { state.user.balance_ghs = state.wallet.balance_ghs; syncHeader(); }
}
function verifyHTML() {
  return '<h2>Verify Bet</h2><p class="muted">Enter a bet code to see its selections and status.</p>' +
    '<form id="verifyForm" class="stack card"><label>Bet code <input type="text" id="verifyCode" placeholder="PB-XXXXXX" required></label>' +
    '<button class="btn gold big" type="submit">Verify</button></form>' +
    '<div id="verifyOut">' + state.verifyResult + '</div>';
}
function bookingHTML() {
  return '<h2>Booking Codes</h2>' +
    '<div class="card"><h3>Generate from your betslip</h3>' +
    '<p class="muted">A slip code packs your current selections into one code that recreates them on any device. ' +
    (state.slip.size ? state.slip.size + ' selection(s) on your slip.' : 'Your slip is empty — add odds first.') + '</p>' +
    '<button class="btn gold big" data-gen-code>Generate Slip Code</button>' +
    (state.slipCode ? '<p class="bigcode">' + esc(state.slipCode) + '</p>' : '') + '</div>' +
    '<div class="card"><h3>Load a code</h3><form id="bookingLoadForm" class="stack">' +
    '<label>Slip code <input type="text" id="loadCode" placeholder="Paste a slip code" required></label>' +
    '<button class="btn gold big" type="submit">Load Code</button></form></div>';
}
function promosHTML() {
  return '<h2>Promotions</h2><div class="promos">' + PROMOS.map(p =>
    '<div class="card"><span class="gtag">' + p.tag + '</span><h3>' + p.title + '</h3><p>' + p.body + '</p></div>').join('') +
    '</div><p class="muted">All promotions are subject to terms and account verification. 18+ only.</p>';
}
function supportHTML() {
  const faq = FAQS.map(f => '<details class="faq"><summary>' + f.q + '</summary><p>' + f.a + '</p></details>').join('');
  const msgs = state.supportMsgs.map(m =>
    '<div class="leg"><span>' + esc(m.subject) + '</span><span class="legres">' + esc(m.status) + '</span></div>').join('');
  return '<h2>Support</h2><div class="card"><h3>FAQs</h3>' + faq + '</div>' +
    '<div class="card"><h3>Message support</h3>' + msgs +
    (state.user
      ? '<form id="supportForm" class="stack"><label>Subject <input type="text" id="supportSubject" placeholder="What is it about?" required></label>' +
        '<label>Your message <input type="text" id="supportText" placeholder="How can we help?" required></label>' +
        '<button class="btn gold big" type="submit">Send Message</button></form>'
      : '<p class="muted">Log in to message the support team. Guests can browse the FAQs without an account.</p>') + '</div>';
}
async function loadSupport() {
  if (!state.user) return;
  try {
    const data = await api('/support');
    state.supportMsgs = data.messages;
  } catch (e) { /* keep current */ }
  if (state.view === 'support') render();
}
function settingsHTML() {
  if (!state.user) return gateHTML('Settings');
  return '<h2>Settings</h2><div class="card stack">' +
    '<div class="card-row"><span>Phone / email</span><b>' + esc(state.user.phone || state.user.email || '') + '</b></div>' +
    '<div class="card-row"><span>Region / currency</span><b>Ghana · GHS</b></div>' +
    '<h3>Change password</h3><form id="passwordForm" class="stack">' +
    '<label>Current password <input type="password" id="pwCurrent" required></label>' +
    '<label>New password <input type="password" id="pwNew" required></label>' +
    '<button class="btn gold big" type="submit">Update Password</button></form></div>';
}
function gamesHTML() {
  loadGameImages();
  const tiles = GAMES.map(g => {
    const cover = gameUrls[g.name];
    return '<button class="gtile ' + g.cls + (cover ? ' has-cover' : '') + '" data-game="' + esc(g.name) + '">' +
    (cover ? '<img class="gcover" src="' + cover + '" alt="">' : '') +
    (g.tag ? '<span class="gtag">' + g.tag + '</span>' : '') +
    '<span class="gname">' + esc(g.name) + '</span><span class="gnote">' + esc(g.note) + ' · Play now</span></button>';
  }).join('');
  return '<h2>Games</h2><div class="gamesgrid">' + tiles + '</div>' +
    '<div class="howto"><h3>Real rounds, fair rolls</h3><p>Every game is rolled on the server and settled to your wallet instantly. Aviator flights are fixed before takeoff — the seed is revealed after each flight so the crash point can be verified.</p></div>' +
    '<div class="ghist card"><h3>Latest results across Oddaroa</h3><div id="gamesRecent"><p class="empty">' +
    (state.user ? 'Loading…' : 'Log in to play and see the latest results.') + '</p></div></div>';
}

function viewHTML() {
  switch (state.view) {
    case 'games': return gamesHTML();
    case 'game': return window.OddaroaGames ? OddaroaGames.screenHTML(state.game) : gamesHTML();
    case 'profile': return profileHTML();
    case 'bets': return betsHTML();
    case 'wallet': return walletHTML();
    case 'verify': return verifyHTML();
    case 'booking': return bookingHTML();
    case 'promos': return promosHTML();
    case 'support': return supportHTML();
    case 'settings': return settingsHTML();
    case 'match': return matchDetailsHTML();
    case 'live':
    case 'sports':
    case 'virtual':
      return filtersHTML() + matchListHTML();
    default:
      return heroHTML() + joinHTML() + quickHTML() + promoStripHTML() + trustStripHTML() + filtersHTML() + matchListHTML() + bannerBandHTML();
  }
}
function render() {
  // A background re-render (the 60s match refresh, a country sync)
  // must not blow away a game in progress: the game screens own
  // their DOM and their server rounds. Only a real view change
  // rebuilds.
  if (state.view === 'game' && root.dataset.view === 'game' && root.dataset.game === state.game) return;
  if (window.OddaroaGames) OddaroaGames.destroy();
  root.dataset.view = state.view;
  // NEVER write data-game="" — an empty attribute still matches the
  // [data-game] selector, so every click inside #root would take the
  // game-card branch and bounce the user to the games lobby. That
  // one line broke every wallet tab, field and button on 2026-11-04
  // (the forwarded "deposit takes you to the games" report). Remove
  // the attribute outright when no game screen is showing.
  if (state.view === 'game') root.dataset.game = state.game;
  else root.removeAttribute('data-game');
  root.innerHTML = viewHTML();
  document.querySelectorAll('.navlink').forEach(b =>
    b.classList.toggle('active', b.dataset.nav === state.view));
  document.querySelectorAll('.bn-item').forEach(b =>
    b.classList.toggle('on', b.dataset.nav === state.view));
  if ($('#mmFeeLine')) syncMomoFee();
  syncSiteCountry();
  if (window.OddaroaGames) OddaroaGames.afterRender();
}

/* ---------- betslip ---------- */
/* ---------- betslip types (Single / Multiple / System) ---------- */
// Prince, 2026-11-05, from the GoalsVault slip he shared. Multiples
// and system tickets earn the winnings bonus — the ladder mirrors
// WIN_BONUS in api/_lib.js (authoritative there); this copy only
// drives the slip's display math.
let slipType = 'multiple';
let sysK = 2;
const singleStakes = {};
const SLIP_BONUS = [[3, 5], [4, 10], [5, 15], [6, 20], [7, 25], [8, 30], [9, 40], [10, 50], [11, 60], [12, 70], [13, 80], [14, 90], [15, 100], [16, 110], [17, 120], [18, 130], [19, 140], [20, 150]];
function slipBonusPct(legs) { let p = 0; for (const [n, v] of SLIP_BONUS) if (legs >= n) p = v; return p; }
function comboCount(n, k) { if (k < 1 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); }
function comboOddsSum(sels, k) {
  if (k < 1 || k > sels.length) return 0;
  let sum = 0;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    sum += idx.reduce((a, i) => a * sels[i].odd, 1);
    let i = k - 1;
    while (i >= 0 && idx[i] === sels.length - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return sum;
}
function genSlipCode() {
  const payload = [...state.slip.values()].map(s => ({ m: s.matchId, k: s.market, p: s.pick }));
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// Load a slip code into the slip at CURRENT prices. Full-book picks
// resolve through priceForPick once the match's book is loaded — the
// old loader only knew the classic markets and silently dropped the
// rest of the slip.
async function applySlipCode(raw) {
  const payload = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/')))));
  await Promise.all([...new Set(payload.map(i => i.m))].map(id => loadMatchFull(id)));
  let added = 0;
  state.slip.clear();
  payload.forEach(item => {
    const m = state.matches.find(x => x.id === item.m);
    if (!m) return;
    const o = priceForPick(m, item.k, item.p);
    if (!o) return;
    state.slip.set(slipKey(m.id, item.k, item.p), {
      matchId: m.id, matchLabel: m.home + ' vs ' + m.away,
      league: m.league, market: item.k, pick: item.p, odd: o.odd,
    });
    added++;
  });
  return added;
}
function renderSlip() {
  $('#slipCount').textContent = state.slip.size;
  const bnCount = $('#bnSlipCount');
  if (bnCount) bnCount.textContent = state.slip.size;
  const body = $('#slipBody');
  const foot = $('#slipFoot');
  if (!state.slip.size) {
    body.innerHTML = '<p class="empty">Your betslip is empty.<br>Tap any odd to add a selection.</p>';
    // The booking-code loader stays available on an empty slip too
    // (the GoalsVault slip keeps it visible at all times).
    foot.innerHTML = '<div class="slip-load"><input type="text" id="slipLoadIn" placeholder="Load booking code"><button class="btn ghost" id="slipLoadBtn">Load</button></div>';
    bindSlip();
    return;
  }
  const entries = [...state.slip.entries()];
  const n = entries.length;
  if (sysK > n - 1) sysK = Math.max(2, n - 1);
  if (sysK < 2) sysK = 2;
  const tabs = '<div class="slip-tabs">' + ['single', 'multiple', 'system'].map(t =>
    '<button class="slip-tab' + (slipType === t ? ' on' : '') + '" data-stype="' + t + '"' +
    (t === 'system' && n < 3 ? ' disabled title="System needs at least 3 selections"' : '') + '>' +
    t[0].toUpperCase() + t.slice(1) + '</button>').join('') + '</div>';
  body.innerHTML = tabs + entries.map(([key, s]) =>
    '<div class="sel"><div class="s-top"><span class="s-match">' + esc(s.matchLabel) + '</span>' +
    '<button class="rm" data-rm="' + esc(key) + '">Remove</button></div>' +
    '<span class="s-pick">' + esc(s.league) + ' \u00B7 ' + esc(s.market) + ' \u00B7 ' + esc(s.pick) + '</span>' +
    '<span class="s-odd">' + s.odd.toFixed(2) + '</span>' +
    (slipType === 'single'
      ? '<span class="s-stake">Stake (GHS) <input type="number" class="sstake" data-sstake="' + esc(key) + '" min="1" value="' + (singleStakes[key] || 10) + '"></span>'
      : '') +
    '</div>'
  ).join('');
  foot.innerHTML = slipFootHTML();
  bindSlip();
}
function slipFootHTML() {
  const sels = [...state.slip.values()];
  const n = sels.length;
  let rows = '';
  if (slipType === 'single') {
    rows = '<div class="row"><span>Total stake</span><b id="totStake">\u2014</b></div>' +
      '<div class="row"><span>Potential win</span><b id="potWin">\u2014</b></div>';
  } else if (slipType === 'system') {
    const combos = comboCount(n, sysK);
    const pct = slipBonusPct(sysK);
    const opts = [];
    for (let k = 2; k <= n - 1; k++) opts.push('<option value="' + k + '"' + (k === sysK ? ' selected' : '') + '>' + k + ' of ' + n + ' \u2014 ' + comboCount(n, k) + ' bets</option>');
    rows = '<div class="row"><span>System</span><select id="sysSel">' + opts.join('') + '</select></div>' +
      '<div class="row"><span>Stake per bet (GHS)</span><input type="number" id="stakeIn" min="1" value="2"></div>' +
      '<div class="row"><span>Combinations</span><b>' + combos + '</b></div>' +
      '<div class="row"><span>Total stake</span><b id="totStake">\u2014</b></div>' +
      (pct ? '<div class="row"><span>Winnings bonus (' + sysK + ' legs)</span><b>+' + pct + '%</b></div>' : '') +
      '<div class="row"><span>Potential win</span><b id="potWin">\u2014</b></div>';
  } else {
    const total = sels.reduce((a, s) => a * s.odd, 1);
    const pct = slipBonusPct(n);
    rows = '<div class="row"><span>Stake (GHS)</span><input type="number" id="stakeIn" min="1" value="10"></div>' +
      '<div class="row"><span>Total odds</span><b>' + total.toFixed(2) + '</b></div>' +
      (pct ? '<div class="row"><span>Winnings bonus (' + n + ' legs)</span><b>+' + pct + '%</b></div>' : '') +
      '<div class="row"><span>Potential win</span><b id="potWin">\u2014</b></div>';
  }
  return rows +
    '<button class="btn gold big" id="placeBet">Place Bet' + (slipType === 'single' && n > 1 ? 's (' + n + ')' : '') + '</button>' +
    '<div class="slip-code"><button class="btn ghost" id="slipBookBtn">Book code</button>' +
    (state.slipCode ? '<span class="bigcode sm">' + esc(state.slipCode) + '</span>' : '') + '</div>' +
    '<div class="slip-load"><input type="text" id="slipLoadIn" placeholder="Load booking code"><button class="btn ghost" id="slipLoadBtn">Load</button></div>';
}
function refreshSlipTotals() {
  const sels = [...state.slip.values()];
  const stake = parseFloat(($('#stakeIn') || {}).value) || 0;
  if (slipType === 'single') {
    let ts = 0, pot = 0;
    for (const s of sels) {
      const v = Number(singleStakes[slipKey(s.matchId, s.market, s.pick)]) || 10;
      ts += v; pot += v * s.odd;
    }
    if ($('#totStake')) $('#totStake').textContent = money(ts);
    if ($('#potWin')) $('#potWin').textContent = money(pot);
  } else if (slipType === 'system') {
    const pct = slipBonusPct(sysK);
    if ($('#totStake')) $('#totStake').textContent = money(stake * comboCount(sels.length, sysK));
    if ($('#potWin')) $('#potWin').textContent = money(stake * comboOddsSum(sels, sysK) * (1 + pct / 100));
  } else {
    const total = sels.reduce((a, s) => a * s.odd, 1);
    const pct = slipBonusPct(sels.length);
    if ($('#potWin')) $('#potWin').textContent = money(stake * total * (1 + pct / 100));
  }
}
function bindSlip() {
  document.querySelectorAll('[data-stype]').forEach(b => b.addEventListener('click', () => { slipType = b.dataset.stype; renderSlip(); }));
  document.querySelectorAll('[data-sstake]').forEach(inp => inp.addEventListener('input', e => {
    singleStakes[e.target.dataset.sstake] = parseFloat(e.target.value) || 0;
    refreshSlipTotals();
  }));
  const stakeIn = $('#stakeIn');
  if (stakeIn) stakeIn.addEventListener('input', refreshSlipTotals);
  const sysSel = $('#sysSel');
  if (sysSel) sysSel.addEventListener('change', e => { sysK = Number(e.target.value); renderSlip(); });
  const pb = $('#placeBet');
  if (pb) pb.addEventListener('click', placeBet);
  const bb = $('#slipBookBtn');
  if (bb) bb.addEventListener('click', () => {
    state.slipCode = genSlipCode();
    renderSlip();
    toast('Slip code generated \u2014 share it to recreate this slip anywhere');
  });
  const lb = $('#slipLoadBtn');
  if (lb) lb.addEventListener('click', async () => {
    const raw = (($('#slipLoadIn') || {}).value || '').trim();
    if (!raw) { toast('Paste a slip code first'); return; }
    try {
      const added = await applySlipCode(raw);
      renderSlip();
      toast(added ? 'Slip loaded \u2014 ' + added + ' selection(s) at current odds' : 'That code has no selections for matches currently listed.');
    } catch (e) { toast('That slip code could not be read.'); }
  });
  refreshSlipTotals();
}
async function placeBet() {
  if (!state.user) { closeSlip(); openAuth('login'); toast('Log in to place a bet'); return; }
  const entries = [...state.slip.entries()];
  let body;
  if (slipType === 'single') {
    if (entries.some(([key]) => !((Number(singleStakes[key]) || 10) > 0))) { toast('Enter a stake for every selection'); return; }
    body = { mode: 'single', selections: entries.map(([key, s]) => ({ match_id: s.matchId, market: s.market, pick: s.pick, stake_ghs: Number(singleStakes[key]) || 10 })) };
  } else if (slipType === 'system') {
    const per = parseFloat(($('#stakeIn') || {}).value) || 0;
    if (!(per > 0)) { toast('Enter a stake per bet'); return; }
    body = { mode: 'system', system_k: sysK, stake_ghs: per, selections: entries.map(([, s]) => ({ match_id: s.matchId, market: s.market, pick: s.pick })) };
  } else {
    const stake = parseFloat(($('#stakeIn') || {}).value) || 0;
    if (!(stake > 0)) { toast('Enter a stake amount'); return; }
    body = { mode: 'multiple', stake_ghs: stake, selections: entries.map(([, s]) => ({ match_id: s.matchId, market: s.market, pick: s.pick })) };
  }
  const btn = $('#placeBet');
  btn.disabled = true; btn.textContent = 'Placing\u2026';
  try {
    const data = await api('/bets/place', { method: 'POST', body });
    state.slip.clear();
    Object.keys(singleStakes).forEach(k => delete singleStakes[k]);
    state.slipCode = '';
    renderSlip();
    closeSlip();
    toast(data.count > 1 ? data.count + ' bets placed \u2014 first code ' + data.code : 'Bet placed \u2014 your ticket code is ' + data.code);
    await refreshUser();
    state.view = 'bets';
    render();
    loadBets();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Place Bet';
    errToast(e, 'Bet could not be placed.');
  }
}
function openSlip() { $('#slipDrawer').classList.add('open'); $('#scrim').classList.add('on'); }
function closeSlip() { $('#slipDrawer').classList.remove('open'); $('#scrim').classList.remove('on'); }

/* ---------- auth ---------- */
let authMode = 'login';
function openAuth(mode) {
  authMode = mode || 'login';
  detectCountry();
  syncAuth();
  $('#authWrap').classList.add('open');
}
// Country detector (Prince's ask, 2026-11-04): preselect the country
// on the auth forms from the visitor's own device — timezone first
// (Africa/Accra, Africa/Lagos, Africa/Nairobi), then browser locale
// (en-GH, en-NG, en-KE). It only ever sets the DEFAULT: the moment the
// user changes the country themselves, their choice is never
// overridden again.
let countryTouched = false;
function applyCountry(code) {
  const sel = $('#authCountry');
  if (sel) sel.value = code;
  $('#authPrefix').textContent = code;
  if (authMode === 'register') $('#authPhone').placeholder = COUNTRY_HINT[code] || '24 123 4567';
}
function detectCountry() {
  if (countryTouched) return;
  // A country picked in the header selector is the user's standing
  // preference — it beats timezone detection every time.
  const stored = localStorage.getItem('od_country');
  if (stored) { applyCountry(stored); return; }
  // Ghana +233 is the site's default country code on both forms
  // (Prince, 2026-11-04). Detection may move it only on an exact
  // timezone match — the browser-language guess was dropped after
  // it put a Kenya prefix on a phone in Ghana.
  let code = null;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    code = { 'Africa/Accra': '+233', 'Africa/Lagos': '+234', 'Africa/Nairobi': '+254', 'Africa/Kampala': '+256', 'Africa/Dar_es_Salaam': '+255' }[tz] || null;
  } catch (e) { /* detection is best-effort; Ghana stays the default */ }
  if (code) applyCountry(code);
}
function closeAuth() { $('#authWrap').classList.remove('open'); }
function syncAuth() {
  // Form layout follows Prince's reference designs (2026-11-04):
  // Register = full name, country, mobile (with dial-prefix box),
  // email, password, referral code. Login = mobile number (same
  // prefix box) + password with a show/hide eye. No tabs — the
  // bottom link switches modes.
  const login = authMode === 'login';
  $('#authTitle').textContent = login ? 'Welcome back' : 'Create your account';
  $('#authSubmit').textContent = login ? 'Login' : 'Register';
  const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? '' : 'none'; };
  // The login form carries a welcome message under its title
  // (Prince's ask, 2026-11-04); the register form does not.
  show('#authSub', login);
  show('#authNameRow', !login);
  // The country selector shows on BOTH forms (Prince, 2026-11-04):
  // every user signs up AND logs in under their own country.
  show('#authCountryRow', true);
  show('#authEmailRow', !login);
  show('#authRefRow', !login);
  show('#forgotLink', login);
  const phoneLabel = $('#authPhoneLabel');
  if (phoneLabel) phoneLabel.textContent = 'Mobile number';
  const phoneInput = $('#authPhone');
  if (phoneInput) phoneInput.placeholder = COUNTRY_HINT[$('#authPrefix').textContent.trim()] || '24 123 4567';
  syncLoginPrefix();
  $('#authAlt').innerHTML = login
    ? 'Need an account? <a href="#" id="authAltLink">Register</a>'
    : 'Already registered? <a href="#" id="authAltLink">Login</a>';
  $('#authAltLink').addEventListener('click', e => {
    e.preventDefault();
    authMode = login ? 'register' : 'login';
    syncAuth();
  });
}
const COUNTRY_HINT = { '+233': '24 123 4567', '+234': '803 123 4567', '+254': '712 345 678', '+256': '772 123 456', '+255': '713 123 456' };
// The identifier field is a mobile number on both forms (Prince,
// 2026-11-04: phones show a numbers-only keyboard there, so an email
// can never be typed into it) — the dial-prefix box always shows.
function syncLoginPrefix() {
  const prefix = $('#authPrefix');
  if (prefix) prefix.style.display = '';
}
$('#authPhone').addEventListener('input', syncLoginPrefix);
document.addEventListener('change', e => {
  if (e.target.id === 'joinCountry') {
    state.joinCountry = e.target.value;
    const label = $('#joinPrefixLabel');
    if (label) label.textContent = e.target.value;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'joinPhone') state.joinPhone = e.target.value;
});
function openMenu() { $('#drawerWrap').hidden = false; }
function closeMenu() { const w = $('#drawerWrap'); if (w) w.hidden = true; }
function syncHeader() {
  const ha = $('#headActions');
  if (state.user) {
    // Header shows the account balance plus a Deposit shortcut (Prince's
    // layout, 2026-11-03 — he first asked for the number here, then chose
    // the balance instead; the number lives in Me). The button's
    // own listener primes the wallet on the deposit section before the
    // shared nav handler switches the view.
    ha.innerHTML = '<span class="userchip">' + money(state.user.balance_ghs) + '</span>' +
      '<button class="btn gold" id="headDeposit" data-nav="wallet">Deposit</button>';
    $('#headDeposit').addEventListener('click', () => {
      state.walletSection = 'deposit';
      state.walletTab = 'instant';
    });
  } else {
    ha.innerHTML = '<button class="btn ghost" id="loginBtn">Login</button>' +
      '<button class="btn gold" id="registerBtn">Register</button>';
    $('#loginBtn').addEventListener('click', () => openAuth('login'));
    $('#registerBtn').addEventListener('click', () => openAuth('register'));
  }
}
async function refreshUser() {
  if (!state.token) return;
  try {
    const data = await api('/auth/me');
    state.user = data.user;
  } catch (e) {
    if (e.code === 'not_logged_in') { state.user = null; state.token = ''; localStorage.removeItem('od_token'); }
  }
  syncHeader();
}

/* ---------- global events ---------- */
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { closeMenu();
    e.preventDefault();
    state.view = nav.dataset.nav;
    // Top-nav sections always open on the default soccer book; the
    // Basketball tile is the only way into the basketball placeholder.
    if (['home', 'live', 'sports', 'virtual'].includes(state.view)) state.sport = 'Soccer';
    render();
    if (state.view === 'bets') loadBets();
    if (state.view === 'wallet') loadWallet();
    if (state.view === 'support') loadSupport();
    return;
  }
  if (e.target.closest('#filterToggle')) {
    // Flip the rows in place (no re-render, so search text/focus and
    // scroll stay put); state.filtersOpen keeps later renders in sync.
    state.filtersOpen = !state.filtersOpen;
    const rows = $('.frows');
    if (rows) rows.classList.toggle('closed', !state.filtersOpen);
    const fb = $('#filterToggle');
    fb.classList.toggle('on', state.filtersOpen);
    fb.setAttribute('aria-expanded', String(state.filtersOpen));
    const ch = fb.querySelector('.fchev');
    if (ch) ch.textContent = state.filtersOpen ? '▴' : '▾';
    return;
  }

  const pop = e.target.closest('[data-pop]');
  if (pop) {
    state.pop = state.pop === pop.dataset.pop ? '' : pop.dataset.pop;
    if (state.pop) state.date = 'All';
    render();
    return;
  }
  const chip = e.target.closest('[data-chip]');
  if (chip) {
    state[chip.dataset.chip] = chip.dataset.val;
    state.pop = '';
    render();
    const sb = $('#searchBox');
    if (sb) sb.focus();
    return;
  }
  const odd = e.target.closest('[data-odd]');
  if (odd) {
    const m = state.matches.find(x => x.id === odd.dataset.odd);
    if (!m) return;
    const pick = odd.dataset.pick;
    // Details-page buttons carry their own market; list buttons use
    // the market chosen in the filter chips.
    const market = odd.dataset.market || state.market;
    const key = slipKey(m.id, market, pick);
    if (state.slip.has(key)) {
      state.slip.delete(key);
    } else {
      [...state.slip.keys()].forEach(k => {
        if (k.startsWith(m.id + '|')) state.slip.delete(k);
      });
      const o = priceForPick(m, market, pick);
      if (!o) return;
      state.slip.set(key, {
        matchId: m.id,
        matchLabel: m.home + ' vs ' + m.away,
        league: m.league, market, pick, odd: o.odd,
      });
    }
    renderSlip();
    render();
    return;
  }
  if (e.target.closest('[data-back]')) {
    state.view = state.prevView || 'home';
    state.matchId = null;
    render();
    return;
  }
  if (e.target.id === 'verifyWrap' || e.target.closest('[data-close-verify]')) {
    closeVerifyModal();
    return;
  }
  if (e.target.closest('[data-done-verify]')) {
    closeVerifyModal();
    loadWallet();
    return;
  }
  if (e.target.closest('[data-goto-deposit]')) {
    closeVerifyModal();
    // The prompt appears over the Withdraw section, where the
    // deposit form is not rendered — switch the wallet to Deposit
    // first, or the button visibly does nothing.
    state.view = 'wallet';
    state.walletSection = 'deposit';
    render();
    const amt = $('#mmAmt');
    if (amt) amt.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const mrow = e.target.closest('[data-match]');
  if (mrow && !e.target.closest('button, a, input, select, textarea')) {
    state.prevView = ['home', 'live', 'sports', 'virtual'].includes(state.view) ? state.view : 'home';
    state.matchId = mrow.dataset.match;
    state.view = 'match';
    loadMatchFull(state.matchId);
    render();
    window.scrollTo(0, 0);
    return;
  }
  const rm = e.target.closest('[data-rm]');
  if (rm) { state.slip.delete(rm.dataset.rm); delete singleStakes[rm.dataset.rm]; renderSlip(); render(); return; }
  const amtChip = e.target.closest('[data-amt]');
  if (amtChip) {
    const inp = $('#mmAmt');
    if (inp) { inp.value = amtChip.dataset.amt; syncMomoFee(); }
    document.querySelectorAll('.amtchip').forEach(c => c.classList.toggle('on', c === amtChip));
    return;
  }
  const quick = e.target.closest('[data-quick]');
  if (quick) {
    const q = quick.dataset.quick;
    if (q === 'Soccer') { state.sport = 'Soccer'; state.view = 'sports'; render(); }
    else if (q === 'Today') { state.sport = 'Soccer'; state.view = 'home'; state.date = 'Today'; render(); }
    else if (q === 'Live') { state.sport = 'Soccer'; state.view = 'live'; render(); }
    else if (q === 'Aviator') {
      // The tile is named Aviator, so it opens Aviator itself — sending it
      // to the games lobby read exactly like the old click bug to users.
      if (!state.user) { openAuth('login'); toast('Log in to play Aviator'); }
      else { state.game = 'Aviator'; state.view = 'game'; render(); window.scrollTo(0, 0); }
    }
    else if (q === 'Basketball') { state.sport = 'Basketball'; state.view = 'sports'; render(); }
    else if (q === 'Verify Bet') { state.view = 'verify'; render(); }
    else if (q === 'Booking Code') { state.view = 'booking'; render(); }
    return;
  }
  const game = e.target.closest('[data-game]');
  if (game && game.dataset.game) {
    if (!state.user) { openAuth('login'); toast('Log in to play ' + game.dataset.game); return; }
    state.game = game.dataset.game;
    state.view = 'game';
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (e.target.closest('[data-hero-cta]')) {
    const cta = HERO_SLIDES[state.heroIdx].cta;
    if (cta === 'See Games') { state.view = 'games'; render(); }
    else { state.view = 'live'; render(); }
    return;
  }
  if (e.target.closest('[data-open-auth]')) { openAuth('login'); return; }
  if (e.target.closest('[data-gen-code]')) {
    if (!state.slip.size) { toast('Add at least one odd to your slip first'); return; }
    state.slipCode = genSlipCode();
    render();
    toast('Slip code generated — share it to recreate this slip anywhere');
    return;
  }
  const wsec = e.target.closest('[data-wsec]');
  if (wsec) { state.walletSection = wsec.dataset.wsec; render(); return; }
  if (e.target.closest('[data-momo-cancel]') || e.target.closest('[data-momo-reset]')) {
    stopMomoPoll(); state.momo = null; render(); return;
  }
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    if (navigator.clipboard) navigator.clipboard.writeText(cp.dataset.copy).catch(() => {});
    toast('MoMo number copied: ' + cp.dataset.copy);
    return;
  }
  if (e.target.id === 'logoutBtn') {
    state.user = null;
    state.token = '';
    localStorage.removeItem('od_token');
    state.wallet = null;
    state.myBets = [];
    syncHeader();
    render();
    toast('Logged out');
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'mmAmt') {
    syncMomoFee();
    document.querySelectorAll('.amtchip').forEach(c =>
      c.classList.toggle('on', Number(c.dataset.amt) === Number(e.target.value)));
  }
  if (e.target.id === 'mmPhone') {
    const n = detectNetworkJS(e.target.value);
    const sel = $('#mmNet');
    if (n && sel) sel.value = n;
  }
});

document.addEventListener('submit', async e => {
  const id = e.target.id;
  if (id === 'momoForm') {
    e.preventDefault();
    const amt = parseFloat($('#mmAmt').value) || 0;
    const phone = $('#mmPhone').value.trim();
    try {
      const d = await api('/wallet/deposit-momo', {
        method: 'POST',
        body: { amount_ghs: amt, phone, network: $('#mmNet').value }
      });
      if (d.next_action && d.next_action.type === 'submit_otp') {
        state.momo = { phase: 'otp', reference: d.reference, phone, amount: amt };
      } else if (d.status === 'unknown') {
        state.momo = { phase: 'failed', message: d.detail || 'We could not confirm the payment request. If a prompt arrives, approve it once — do not pay twice.' };
      } else {
        state.momo = { phase: 'wait', reference: d.reference, phone, amount: amt, ussd: d.next_action && d.next_action.ussd_fallback };
        startMomoPoll();
      }
      render();
    } catch (err) {
      if (err.code === 'provider_not_configured' || err.code === 'gateway_disabled') {
        state.momoOff = true;
        render();
        toast('Instant deposits are switched off right now — please try again shortly.');
      } else {
        state.momo = { phase: 'failed', message: err.detail || 'The payment could not be started. Nothing was charged.' };
        render();
      }
    }
  } else if (id === 'momoOtpForm') {
    e.preventDefault();
    try {
      await api('/wallet/deposit-otp', {
        method: 'POST',
        body: { reference: state.momo.reference, otp: $('#mmOtp').value.trim() }
      });
      state.momo.phase = 'wait';
      startMomoPoll();
      render();
    } catch (err) { toast(err.detail || 'That code was not accepted — check it and try again.'); }
  } else if (id === 'joinForm') {
    e.preventDefault();
    const num = ($('#joinPhone').value || '').trim();
    const country = ($('#joinCountry') || {}).value || '+233';
    openAuth('register');
    applyCountry(country);
    if (num) $('#authPhone').value = num;
  } else if (id === 'withdrawForm') {
    e.preventDefault();
    try {
      await api('/wallet/withdraw', {
        method: 'POST',
        body: { amount_ghs: parseFloat($('#wdAmt').value) || 0, method: $('#wdMethod').value }
      });
      toast('Withdrawal requested — the amount is held and paid out after review.');
      loadWallet();
    } catch (err) {
      if (err.code === 'withdrawal_locked') {
        const done = Number(err.data && err.data.deposits_done) || 0;
        // The verification prompt only appears once the player has
        // completed a first deposit (Prince, 2026-11-04); before
        // that the plain support message below stands.
        if (done >= 1) { showVerifyModal(err.data); return; }
      }
      errToast(err, 'Withdrawal request failed.');
    }
  } else if (id === 'verifyForm') {
    e.preventDefault();
    const code = $('#verifyCode').value.trim().toUpperCase();
    try {
      const data = await api('/bets/verify?code=' + encodeURIComponent(code));
      const t = data.ticket;
      state.verifyResult = betCardHTML({
        code: t.code, status: t.status, placed_at: t.placed_at,
        stake_ghs: t.stake_ghs, total_odds: t.total_odds, potential_ghs: t.potential_ghs,
        selections: t.selections,
      });
    } catch (err) {
      state.verifyResult = '<div class="card"><b>Ticket not found</b><p class="muted">No bet carries the code ' + esc(code) + '.</p></div>';
    }
    render();
  } else if (id === 'bookingLoadForm') {
    e.preventDefault();
    const raw = $('#loadCode').value.trim();
    try {
      const added = await applySlipCode(raw);
      renderSlip();
      if (added) { toast('Slip loaded — ' + added + ' selection(s) at current odds'); openSlip(); }
      else toast('That code has no selections for matches currently listed.');
    } catch (err) {
      toast('That slip code could not be read.');
    }
  } else if (id === 'supportForm') {
    e.preventDefault();
    try {
      await api('/support', {
        method: 'POST',
        body: { subject: $('#supportSubject').value.trim(), body: $('#supportText').value.trim() }
      });
      toast('Message sent — support will reply here.');
      loadSupport();
    } catch (err) { errToast(err, 'Message could not be sent.'); }
  } else if (id === 'passwordForm') {
    e.preventDefault();
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { current_password: $('#pwCurrent').value, new_password: $('#pwNew').value }
      });
      toast('Password updated.');
      e.target.reset();
    } catch (err) { errToast(err, 'Password change failed.'); }
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'searchBox') {
    state.query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const sb = $('#searchBox');
    if (sb) { sb.focus(); sb.setSelectionRange(pos, pos); }
  }
});

$('#slipFab').addEventListener('click', openSlip);
$('#bnSlip').addEventListener('click', openSlip);
$('#slipClose').addEventListener('click', closeSlip);
$('#scrim').addEventListener('click', closeSlip);
$('#loginBtn').addEventListener('click', () => openAuth('login'));
$('#registerBtn').addEventListener('click', () => openAuth('register'));
$('#authClose').addEventListener('click', closeAuth);
// Password visibility eye (Prince, 2026-11-04): tap to see what you
// are typing, tap again to hide it.
const EYE_OPEN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_SHUT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.6 10.6 0 0 1 12 19c-6.5 0-10-7-10-7a17.6 17.6 0 0 1 4.06-4.94M9.9 4.24A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.16 3.19M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
$('#passEye').addEventListener('click', () => {
  const input = $('#authPass'), btn = $('#passEye');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show ? EYE_SHUT : EYE_OPEN;
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});
$('#authCountry').addEventListener('change', e => {
  countryTouched = true;
  applyCountry(e.target.value);
});
$('#forgotLink').addEventListener('click', e => {
  e.preventDefault();
  toast('Password help: message Support with your phone number and we will help you back in.');
});
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const rawPhone = $('#authPhone').value.trim();
  const password = $('#authPass').value;
  const email = $('#authEmail').value.trim();
  // The phone field carries a dial-prefix box (country select): the
  // submitted number is prefix + national digits, leading zero dropped
  // (024 123 4567 in Ghana becomes +233241234567). On the login form
  // the same field accepts an email instead — anything with an @ is
  // sent as-is. Registration always requires an email (compulsory);
  // players also need a phone, while an admin invite may register
  // with email alone.
  const prefix = $('#authPrefix').textContent.trim();
  const national = rawPhone.replace(/\D/g, '').replace(/^0+/, '');
  // A number typed in full international form (+234..., +254...)
  // is used exactly as typed — the prefix box is never stacked on
  // top of it (Prince, 2026-11-04: login per country).
  const composedPhone = rawPhone.trim().startsWith('+')
    ? '+' + rawPhone.replace(/\D/g, '')
    : (national ? prefix + national : '');
  const inviteRegister = authMode === 'register' && !!localStorage.getItem('od_admin_invite');
  if (!password) return;
  if (authMode === 'register') {
    if (!email) { toast('An email address is required to create an account.'); return; }
    if (!composedPhone && !inviteRegister) { toast('Enter your mobile number.'); return; }
  } else if (!rawPhone) return;
  const btn = $('#authSubmit');
  btn.disabled = true;
  try {
    const path = authMode === 'login' ? '/auth/login' : '/auth/register';
    const body = authMode === 'login'
      ? { identifier: rawPhone.includes('@') ? rawPhone.replace(/\s+/g, '') : composedPhone, password }
      : { phone: composedPhone, password };
    if (authMode === 'register') {
      body.email = email;
      const nameEl = $('#authName');
      if (nameEl && nameEl.value.trim()) body.display_name = nameEl.value.trim();
      const refField = $('#authRef').value.trim().toUpperCase();
      const ref = refField || localStorage.getItem('od_ref');
      const inv = localStorage.getItem('od_admin_invite');
      if (ref) body.ref = ref;
      if (inv) body.admin_invite = inv;
    }
    const data = await api(path, { method: 'POST', body });
    if (data.pending) {
      localStorage.removeItem('od_admin_invite');
      closeAuth();
      toast('Admin account created — it is pending verification by the super admin. You can log in once it is verified.');
      return;
    }
    if (authMode === 'register') {
      localStorage.removeItem('od_admin_invite');
      localStorage.removeItem('od_ref');
    }
    state.token = data.token;
    localStorage.setItem('od_token', data.token);
    state.user = data.user;
    syncHeader();
    closeAuth();
    toast(authMode === 'login' ? 'Welcome back' : 'Account created — welcome to Oddaroa');
    render();
    if (state.view === 'wallet') loadWallet();
    if (state.view === 'bets') loadBets();
  } catch (err) {
    errToast(err, 'Something went wrong.');
  } finally {
    btn.disabled = false;
  }
});

// Header country selector (borrowed from GoalsVault's header — but
// theirs is decorative; this one WORKS): the choice is stored and
// becomes the country the sign-up/login forms and the instant-join
// block preselect, ahead of timezone detection. Ghana by default.
function initSiteCountry() {
  const sel = $('#siteCountry');
  if (!sel) return;
  sel.addEventListener('change', () => {
    localStorage.setItem('od_country', sel.value);
    tickClock();
    countryTouched = true;
    applyCountry(sel.value);
    state.joinCountry = sel.value;
    syncSiteCountry();
  });
  syncSiteCountry();
}
initSiteCountry();
// Header clock: GoalsVault shows a static "GMT+00:00" label at the
// end of its nav row; ours is a real ticking clock that follows the
// country selected in the header (Prince, 2026-11-04) — each of the
// five countries keeps its own offset, none of them observe DST:
// Ghana GMT+0, Nigeria GMT+1, Kenya/Uganda/Tanzania GMT+3.
const COUNTRY_TZ = {
  '+233': { name: 'Ghana', tz: 'Africa/Accra', gmt: 'GMT+00:00' },
  '+234': { name: 'Nigeria', tz: 'Africa/Lagos', gmt: 'GMT+01:00' },
  '+254': { name: 'Kenya', tz: 'Africa/Nairobi', gmt: 'GMT+03:00' },
  '+256': { name: 'Uganda', tz: 'Africa/Kampala', gmt: 'GMT+03:00' },
  '+255': { name: 'Tanzania', tz: 'Africa/Dar_es_Salaam', gmt: 'GMT+03:00' },
};
// The country the site is currently "in": a signed-in user's
// account country (from their phone's dial code) beats everything;
// otherwise the stored header choice; otherwise Ghana.
function effectiveCountryCode() {
  if (state.user && state.user.phone) {
    const hit = Object.keys(COUNTRY_TZ).find(c => state.user.phone.startsWith(c));
    if (hit) return hit;
  }
  return localStorage.getItem('od_country') || '+233';
}
// Header country display rules (Prince, 2026-11-04): signed-out
// visitors can see and change the selector, and until they choose
// it reads "Country" (not a country name). Once signed in, the
// header shows the ACCOUNT's country and it cannot be changed.
function syncSiteCountry() {
  const sel = $('#siteCountry');
  const label = $('#countryLabel');
  if (!sel || !label) return;
  if (state.user) {
    sel.disabled = true;
    label.textContent = COUNTRY_TZ[effectiveCountryCode()].name;
  } else {
    sel.disabled = false;
    const stored = localStorage.getItem('od_country');
    if (stored) {
      sel.value = stored;
      label.textContent = COUNTRY_TZ[stored] ? COUNTRY_TZ[stored].name : 'Country';
    } else {
      label.textContent = 'Country';
    }
  }
}
function tickClock() {
  const el = $('#tzClock');
  if (!el) return;
  const info = COUNTRY_TZ[effectiveCountryCode()] || COUNTRY_TZ['+233'];
  el.textContent = info.gmt + ' \u00B7 ' + new Date().toLocaleTimeString('en-GB', { timeZone: info.tz });
}
tickClock();
setInterval(tickClock, 1000);
// hero auto-advance: rotate ONLY the hero element in place. This
// used to call render(), rebuilding the entire home page — matches
// included — every 6 seconds, the biggest half of the "site keeps
// auto-refreshing" report (2026-11-05).
setInterval(() => {
  if (state.view !== 'home' || document.hidden) return;
  const cur = $('.hero');
  if (!cur) return;
  state.heroIdx = (state.heroIdx + 1) % HERO_SLIDES.length;
  const tmp = document.createElement('div');
  tmp.innerHTML = heroHTML();
  if (tmp.firstElementChild) cur.replaceWith(tmp.firstElementChild);
}, 6000);

// Live scores keep moving while a match view is open: re-pull the feed
// about once a minute (the API refreshes from ESPN itself when stale,
// and loadMatches re-renders the match views).
setInterval(() => {
  if (document.hidden) return;
  if (['home', 'live', 'sports', 'virtual', 'match'].includes(state.view)) loadMatches();
}, 60000);

// Invite links land here first: remember the attribution / invite
// token, then let registration pick it up.
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('ref')) localStorage.setItem('od_ref', urlParams.get('ref'));
if (urlParams.get('admin_invite')) localStorage.setItem('od_admin_invite', urlParams.get('admin_invite'));
loadHeroImages();
loadTileImages();
if (urlParams.get('admin_invite')) openAuth('register');
// A referral link is for a NEW account (Prince hit this himself on
// 2026-11-03: opening his own link while signed in just showed him
// his logged-in site and looked broken). So: signed-out visitors go
// straight to the register form, and signed-in users get told why
// the link cannot attach to the account they are already in.
if (urlParams.get('ref')) {
  if (state.token) {
    setTimeout(() => toast('You are already signed in — referral links are for new accounts. Share this link with someone new, or log out first to register under it.'), 600);
  } else {
    openAuth('register');
  }
}

// boot: restore session, then load real matches
$('#burgerBtn').addEventListener('click', openMenu);
$('#drawerClose').addEventListener('click', closeMenu);
$('#drawerShade').addEventListener('click', closeMenu);

(async () => {
  renderSlip();
  render();
  if (state.token) await refreshUser();
  loadMatches();
})();
