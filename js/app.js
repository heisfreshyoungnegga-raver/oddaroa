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
  hideBal: localStorage.getItem('od_hidebal') === '1',
  theme: localStorage.getItem('od_theme') || 'dark',
  sport: 'Soccer',
  query: '',
  filtersOpen: false,
  matchId: null, prevView: 'home', game: null,
  fullBooks: {}, // matchId -> the match's full market book (fetched on demand)
  slip: new Map(), // key -> {matchId, matchLabel, league, market, pick, odd}
  winners: null,
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
  flw: null,
  flwOff: false,
  banks: null,
  wdAcctName: '',
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
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
// A drawn padlock (vector), not the emoji — same icon everywhere a
// price is locked, styled by .lock-symbol in styles.css.
const LOCK_ICON = '<span class="lock-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><rect x="5" y="10.5" width="14" height="9" rx="2" fill="currentColor"/><circle cx="12" cy="15" r="1.7" fill="#000" opacity="0.45"/></svg></span>';
const TROPHY_ICON = '<svg viewBox="0 0 24 24" fill="none" focusable="false" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" fill="currentColor"/><path d="M7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 14v3M8.5 20.5h7M12 17c-1.4 0-2 .8-2.2 3.5h4.4C14 17.8 13.4 17 12 17Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
// One currency per account (Prince, 2026-11-07): the account's phone
// country fixes it server-side and publicUser carries it here. Every
// amount on the player site renders in the signed-in user's currency.
function curCode() { return (state.user && state.user.currency) || 'GHS'; }
const CUR_SYM = { GHS: 'GHS ', NGN: '₦', KES: 'KES ', UGX: 'UGX ', TZS: 'TZS ' };
const CUR_RULES = {
  GHS: { minDeposit: 120, maxDeposit: 5000, verifyAmount: 300, minStake: 1, maxStake: 1000 },
  NGN: { minDeposit: 25000, maxDeposit: 2000000, verifyAmount: 10000, minStake: 100, maxStake: 500000 }
};
function curSym() { return CUR_SYM[curCode()] || 'GHS '; }
function curRules() { return CUR_RULES[curCode()] || CUR_RULES.GHS; }
window.odStakeRules = () => { const r = curRules(); return { min: r.minStake, max: r.maxStake, sym: curSym(), code: curCode() }; };
function money(n) { return curSym() + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// Headline balances respect the header eye toggle (Prince,
// 2026-11-05): hidden shows a masked amount. Transaction history
// amounts are records, not "the balance", and stay visible.
function balMoney(n) { return state.hideBal ? curSym() + '••••' : money(n); }
// The market's proper name is Correct Score — the feed's stored
// name 'Exact Score' must never reach the screen (Prince, 2026-11-06).
function mktName(n) { return n === 'Exact Score' ? 'Correct Score' : n; }
// Icons: EYE_OPEN / EYE_SHUT are shared with the password eye
// (declared with the auth wiring below; same visible/hidden sense).
function eyeBtnHTML() {
  return '<button class="eyebtn" id="eyeToggle" aria-label="' + (state.hideBal ? 'Show balance' : 'Hide balance') + '">' + (state.hideBal ? EYE_SHUT : EYE_OPEN) + '</button>';
}
// Theme: 'dark' is the brand default; 'light' flips the CSS
// variables via [data-theme="light"] in styles.css. The choice
// persists and the head script applies it before first paint.
function applyTheme(t) {
  state.theme = t === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem('od_theme', state.theme);
  document.querySelectorAll('[data-theme-state]').forEach(el => { el.textContent = state.theme === 'light' ? 'Light' : 'Dark'; });
  document.querySelectorAll('.tswitch').forEach(el => { el.setAttribute('aria-checked', state.theme === 'light' ? 'true' : 'false'); });
}

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
    invalid_invite: 'That invite link is invalid or has expired. Ask the super admin for a fresh one.',
    server_error: 'Something went wrong on our side — please try again in a moment.',
    phone_already_registered: 'That phone number is already registered — log in instead.',
    password_too_short: 'Password must be at least 6 characters.',
    invalid_phone: 'Enter a valid phone number.',
    email_required: 'An email address is required to create an account.',
    invalid_email: 'Enter a valid email address.',
    email_already_registered: 'That email is already registered — log in instead.',
    account_blocked: 'This account has been blocked. Contact support.',
    withdrawal_locked: 'Withdrawals are not available on your account yet — please contact support.',
    cashout_unavailable: 'Cashout is not available for this ticket right now.',
    bet_not_open: 'That ticket is already settled.',
    match_finished: 'One of those matches has already finished.',
    match_live_locked: 'Live matches are locked — betting closes at kickoff.',
    betting_locked: 'Betting is locked on this match.',
    one_selection_per_match: 'Only one selection per match on a slip.',
    market_unavailable: 'One of those markets is not available right now.',
    ticket_not_found: 'No ticket found with that code.',
    transaction_id_required: 'Enter the MoMo transaction ID from your confirmation.',
  };
  toast(map[e.code] || e.detail || fallback || ('Something went wrong: ' + (e.code || 'error')));
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
  // Do not trust the list's has_full flag: it is a snapshot, and a book
  // priced after the list loaded would never be fetched (the details
  // page then shows only the classic markets forever). Try once per
  // session per match; the endpoint is cheap and a miss is final here.
  state.fullTried = state.fullTried || {};
  if (state.fullTried[id]) return;
  state.fullTried[id] = 1;
  try {
    const data = await api('/match?id=' + encodeURIComponent(id));
    if (data.match && Array.isArray(data.match.odds_full)) {
      state.fullBooks[id] = data.match.odds_full;
      if (state.view === 'match' && state.matchId === id) render();
    } else {
      // The server answered but the book is not priced yet — un-mark
      // so the next retry (60s tick while the page is open) can win
      // it. The old behaviour made ANY miss final for the whole
      // session: one network hiccup, or opening the match a minute
      // before its book landed, and Correct Score & co. never
      // appeared until a full page reload (users' "options no dey
      // come", 2026-11-08).
      delete state.fullTried[id];
    }
  } catch (e) {
    // A failed fetch must not be final either — allow the retry.
    delete state.fullTried[id];
  }
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
  const locked = m.status === 'live' || m.betting_locked === true; // live matches are locked (betting closes at kickoff); the operator can also lock a game by hand
  return '<span class="mkt">' + state.market + '</span>' + opts.map(o => {
    const sel = state.slip.has(slipKey(m.id, state.market, o.label)) ? ' sel' : '';
    return '<button class="odd' + sel + (locked ? ' locked' : '') + '" data-odd="' + m.id + '" data-pick="' + esc(o.label) + '"' + (locked ? ' disabled' : '') + '>' +
      '<small>' + esc(o.label) + '</small>' + (locked ? '' + LOCK_ICON + '' : o.odd.toFixed(2)) + '</button>';
  }).join('');
}
// Crest/flag size normalizer (Prince, 2026-11-08): logo files arrive
// with wildly different transparent padding, so identical boxes showed
// crests at random sizes. Trim each unique logo's transparent margins
// once and cache the crop; both logo CDNs send CORS headers, so the
// canvas read is allowed. Any failure leaves the original untouched.
const logoTrimCache = new Map();
function logoSrc(u) { return (u && logoTrimCache.get(u)) || u; }
function trimLogoImg(img) {
  const url = img.getAttribute('src') || '';
  if (!url || img.dataset.tdone) return;
  img.dataset.tdone = '1';
  const cached = logoTrimCache.get(url);
  if (cached) { if (cached !== url) img.src = cached; return; }
  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.onload = () => {
    try {
      const w = probe.naturalWidth, h = probe.naturalHeight;
      if (!w || !h) { logoTrimCache.set(url, url); return; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.drawImage(probe, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 12) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      if (maxX < 0) { logoTrimCache.set(url, url); return; }
      const cw = maxX - minX + 1, ch = maxY - minY + 1;
      if (Math.min(cw / w, ch / h) >= 0.97) { logoTrimCache.set(url, url); return; }
      const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
      c2.getContext('2d').drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
      const trimmed = c2.toDataURL('image/png');
      logoTrimCache.set(url, trimmed);
      document.querySelectorAll('img.tlogo').forEach(el => {
        if ((el.getAttribute('src') || '') === url) { el.dataset.tdone = '1'; el.src = trimmed; }
      });
    } catch (e) { logoTrimCache.set(url, url); }
  };
  probe.onerror = () => logoTrimCache.set(url, url);
  probe.src = url;
}
document.addEventListener('load', e => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.classList && t.classList.contains('tlogo')) trimLogoImg(t);
}, true);
function rowHTML(m) {
  let time;
  if (m.status === 'live') {
    time = '<span class="live-min">' + (m.minute_label || (m.minute != null ? m.minute + '&prime;' : 'LIVE')) + '</span>';
  } else {
    time = '<span>' + fmtDate(m.starts_at) + '</span>';
  }
  // Live scores sit beside each team name (Prince's ask, 2026-11-03)
  // and update with the automatic ESPN refresh like the rest of the
  // row — no separate score column.
  const teamLine = (name, logo, score) =>
    '<div class="team">' + (logo ? '<img class="tlogo" src="' + esc(logoSrc(logo)) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
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
    ? '<span class="live-min">' + (m.minute_label || (m.minute != null ? m.minute + '&prime;' : 'LIVE')) + '</span>'
    : esc(fmtDate(m.starts_at));
  const team = (name, logo, score) => '<div class="team">' + (logo ? '<img class="tlogo" src="' + esc(logoSrc(logo)) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '<span class="tname">' + esc(name) + '</span>' + (score != null ? '<span class="tscore">' + score + '</span>' : '') + '</div>';
  let html = back + '<div class="card"><div class="league">' + esc(m.league) + '</div>' +
    '<div class="md-when">' + when + '</div>' +
    '<div class="md-teams">' + team(m.home, m.home_logo, m.status === 'live' ? m.sh : null) + team(m.away, m.away_logo, m.status === 'live' ? m.sa : null) + '</div></div>';
  // Live matches are locked: a lock symbol replaces each price and
  // nothing can be added to the slip once a match has kicked off.
  const locked = m.status === 'live' || m.betting_locked === true;
  const lkCls = locked ? ' locked' : '';
  const lkDis = locked ? ' disabled' : '';
  if (locked) html += '<div class="md-lock">' + LOCK_ICON + (m.status === 'live' ? ' Live betting is locked on this match' : ' Betting is locked on this match') + '</div>';
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
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
  const text = new TextDecoder().decode(buf).replace(/\s+/g, '');
  if (text.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(text)) return 'data:image/' + (text.indexOf('iVBOR') === 0 ? 'png' : 'jpeg') + ';base64,' + text;
  return null;
}
function fetchAssetUrl(path) {
  return fetch(path).then(r => (r.ok ? r.arrayBuffer() : null)).then(buf => (buf ? sniffImageUrl(buf) : null)).catch(() => null);
}
function loadHeroImages() {
  [{ img: 'assets/winning-cup.png' }, { img: 'assets/win-cup.png' }].forEach(s => {
    if (heroUrls[s.img]) return;
    heroUrls[s.img] = s.img;
    fetch(s.img).then(r => (r.ok ? r.arrayBuffer() : null)).then(buf => {
      if (!buf) return;
      const u = sniffImageUrl(buf);
      if (u) { heroUrls[s.img] = u; if (state.view === 'home' || state.view === 'winners') render(); }
    }).catch(() => {});
  });
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


/* ---------- payout moment (player site) ----------
   Prince, 2026-11-05: when an ADMIN logs into the player site with
   admin credentials and requests a withdrawal, he gets the full
   payout moment — the animated SMS, the chime and the success card —
   as if the super admin had approved it, while the request itself
   still waits in the queue for the real approval. Normal players
   never see any of this; they only get "waiting for admin approval". */
function smsPlatform() {
  const ua = (navigator && navigator.userAgent) || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'generic';
}
function smsDing() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = smsDing.ctx || (smsDing.ctx = new AC());
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    [[1567.98, 0], [2093.0, 0.09]].forEach(([f, dt]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + dt + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 0.55);
    });
  } catch (e) { /* garnish only */ }
}
const SMS_APP_ICON = '<svg class="sms-face" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9.2" r="3.6" fill="#fff"/><path d="M4.8 19.4c1.2-3.1 3.9-4.7 7.2-4.7s6 1.6 7.2 4.7c.2.6-.2 1.1-.8 1.1H5.6c-.6 0-1-.5-.8-1.1Z" fill="#fff"/></svg><span class="sms-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4C6.6 4 2.2 7.5 2.2 12c0 2.5 1.4 4.8 3.7 6.1-.2 1.1-.8 2.4-1.6 3.4 0 0 2.8-.1 4.8-1.3.9.2 1.9.3 2.9.3 5.4 0 9.8-3.5 9.8-8S17.4 4 12 4Z" fill="#fff"/></svg></span>';
function showPayoutSms(p) {
  if (document.querySelector('#smsAlert')) return;
  const el = document.createElement('div');
  el.className = 'sms-alert';
  el.id = 'smsAlert';
  el.innerHTML = '<div class="sms-card ' + smsPlatform() + '">' +
    '<div class="sms-ic">' + SMS_APP_ICON + '</div>' +
    '<div class="sms-body">' +
      '<div class="sms-head"><b>MobileMoney</b><span>now</span></div>' +
      '<p>Payment received for <b>' + money(p.amount_ghs) + '</b> from www.oddaroa.com. Current Balance: <b>' + money(p.balance_ghs) + '</b>. Available Balance: <b>' + money(p.balance_ghs) + '</b>.</p>' +
    '</div>' +
    '<button class="sms-x" aria-label="Dismiss">&times;</button>' +
  '</div>';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  smsDing();
  const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 450); };
  el.querySelector('.sms-x').addEventListener('click', dismiss);
  el.querySelector('.sms-card').addEventListener('click', dismiss);
  setTimeout(dismiss, 12000);
}
// ---- Win celebration (Prince's pick, 2026-11-05): when a betslip
// settles WON, the player gets the full celebration once — dressed
// cup art, amount, verify code (the booking code), an honest
// percentile from real payouts, View Bet / Continue, and share.
// Seen tickets are remembered in localStorage so it fires once.
function winChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.55);
    });
  } catch (e) { /* sound is best-effort */ }
}
/* ---------- bet placed: booking code share panel ----------
   Prince, 2026-11-06: the booking code shows AFTER staking — one
   unique code for these games on this account, stable across
   re-stakes. Oddaroa's own panel (dark + gold): big code, copy and
   share. Deliberately NOT a copy of any other bookmaker's sheet. */
function showBetPlaced(data) {
  closeBetPlaced();
  const el = document.createElement('div');
  el.className = 'bp-overlay';
  el.id = 'bpOverlay';
  el.innerHTML =
    '<div class="bp-card">' +
      '<div class="bp-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5L19.5 7"/></svg></div>' +
      '<h3>Bet placed</h3>' +
      '<p class="bp-sub">Ticket <b>' + esc(data.code) + '</b>' + (data.count > 1 ? ' \u00B7 ' + data.count + ' bets' : '') + ' \u00B7 ' + money(data.total_stake_ghs) + '</p>' +
      '<div class="bp-codebox"><span class="bp-label">YOUR BOOKING CODE</span>' +
      '<span class="bp-code">' + esc(data.booking_code) + '</span>' +
      '<span class="bp-note">Share this code \u2014 anyone can load these same games into their slip and stake them too.</span></div>' +
      '<div class="bp-actions"><button class="btn ghost" id="bpCopy">Copy code</button><button class="btn gold" id="bpShare">Share</button></div>' +
      '<button class="bp-done" id="bpDone">Done</button>' +
    '</div>';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const shareText = 'Stake my Oddaroa games \u2014 booking code ' + data.booking_code + '. Open oddaroa.com, open the betslip and enter it under Load booking code.';
  document.getElementById('bpCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(data.booking_code); toast('Booking code copied'); }
    catch (e) { toast('Your booking code is ' + data.booking_code); }
  });
  document.getElementById('bpShare').addEventListener('click', async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Oddaroa booking code', text: shareText }); } catch (e) {} }
    else {
      try { await navigator.clipboard.writeText(shareText); toast('Share text copied'); }
      catch (e) { toast('Your booking code is ' + data.booking_code); }
    }
  });
  document.getElementById('bpDone').addEventListener('click', closeBetPlaced);
  el.addEventListener('click', e => { if (e.target === el) closeBetPlaced(); });
}
function closeBetPlaced() { const el = document.getElementById('bpOverlay'); if (el) el.remove(); }
function maybeCelebrateWin(bets) {
  try {
    if (!Array.isArray(bets) || !state.user) return;
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem('od_celebrated') || '[]'); } catch (e) { seen = []; }
    const fresh = bets.filter(b => b.status === 'won' && b.settled_at &&
      (Date.now() - new Date(b.settled_at).getTime()) < 7 * 864e5 && seen.indexOf(b.id) === -1)
      .sort((a, b) => Number(b.potential_ghs) - Number(a.potential_ghs));
    if (!fresh.length) return;
    seen = seen.concat(fresh.map(b => b.id)).slice(-200);
    try { localStorage.setItem('od_celebrated', JSON.stringify(seen)); } catch (e) {}
    showWinCelebration(fresh[0]);
  } catch (e) { /* a celebration must never break the Bets view */ }
}
function showWinCelebration(bet) {
  closeWinCelebration();
  const amt = money(bet.potential_ghs);
  const colors = ['#f5c518', '#22c55e', '#ffffff', '#ffd94d'];
  let confetti = '';
  for (let i = 0; i < 16; i++) {
    confetti += '<i style="left:' + (4 + Math.random() * 92) + '%;background:' + colors[i % 4] +
      ';animation-delay:' + (Math.random() * 0.9).toFixed(2) + 's;animation-duration:' + (1.6 + Math.random() * 1.6).toFixed(2) + 's"></i>';
  }
  const el = document.createElement('div');
  el.className = 'win-overlay';
  el.id = 'winOverlay';
  el.innerHTML =
    '<div class="win-card">' +
      '<div class="win-body">' +
        '<div class="win-congrats"><span class="win-mini">' + TROPHY_ICON + '</span> CONGRATULATIONS! <span class="win-mini">' + TROPHY_ICON + '</span></div>' +
        '<div class="win-youwon">YOU WON!</div>' +
        '<div class="win-art"><img src="' + (heroUrls['assets/win-cup.png'] || 'assets/win-cup.png') + '" alt="Oddaroa Winning Cup"><div class="win-confetti">' + confetti + '</div></div>' +
        '<div class="win-amt-label">Your winning amount:</div>' +
        '<div class="win-amt">' + amt + '</div>' +
        '<div class="win-verify">Verify Code: <b>' + esc(bet.code || '') + '</b></div>' +
        '<div class="win-actions">' +
          '<button type="button" class="win-btn ghost" id="winViewBet">&#127915; View Bet</button>' +
          '<button type="button" class="win-btn go" id="winContinue">Continue &rsaquo;</button>' +
        '</div>' +
        '<button type="button" class="win-share" id="winShare">Share Win Celebration</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
  const artImg = el.querySelector('.win-art img');
  if (artImg && !/^(data:|blob:)/.test(artImg.src)) {
    fetchAssetUrl('assets/win-cup.png').then(u => {
      if (u) { heroUrls['assets/win-cup.png'] = u; if (artImg.isConnected) artImg.src = u; }
    });
  }
  winChime();
  document.getElementById('winContinue').addEventListener('click', closeWinCelebration);
  document.getElementById('winViewBet').addEventListener('click', () => { closeWinCelebration(); state.view = 'bets'; render(); loadBets(); });
  el.addEventListener('click', e => { if (e.target === el) closeWinCelebration(); });
  document.getElementById('winShare').addEventListener('click', async () => {
    const text = 'I just won ' + amt + ' on Oddaroa! Verify code: ' + (bet.code || '') + ' — play at oddaroa.com';
    try {
      if (navigator.share) { await navigator.share({ title: 'Oddaroa Win', text }); return; }
      throw new Error('no share');
    } catch (e) {
      try { await navigator.clipboard.writeText(text); toast('Celebration text copied — paste it anywhere to share.'); }
      catch (e2) { toast('Share: ' + text); }
    }
  });
}
function closeWinCelebration() {
  const el = document.getElementById('winOverlay');
  if (el) el.remove();
}
function showPayoutSuccess(p) {
  if (document.querySelector('#paySuccess')) return;
  const el = document.createElement('div');
  el.className = 'pay-overlay';
  el.id = 'paySuccess';
  el.innerHTML = '<div class="pay-card">' +
    '<div class="pay-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>' +
    '<div class="pay-title">Withdrawal successful</div>' +
    '<p class="pay-sub">The withdrawal has been paid to ' + esc(p.phone || 'your MoMo number') + ' successfully.</p>' +
    '<div class="pay-amt">' + money(p.amount_ghs) + '</div>' +
    '<div class="pay-actions"><button type="button" data-pay-tx>Transactions</button><button type="button" data-pay-done>Done</button></div>' +
  '</div>';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  el.querySelector('[data-pay-done]').addEventListener('click', close);
  el.querySelector('[data-pay-tx]').addEventListener('click', () => { close(); state.walletSection = 'history'; render(); });
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
}

/* ---------- account pages ---------- */
function gateHTML(title) {
  return '<div class="profile"><h2>' + title + '</h2>' +
    '<p class="modal-sub">Log in to see this page.</p>' +
    '<button class="btn gold big" data-open-auth>Login</button></div>';
}
function statusChip(s) {
  const cls = s === 'completed' || s === 'won' || s === 'cashed_out' ? 'completed' : s === 'rejected' || s === 'lost' ? 'rejected' : 'pending';
  const label = s === 'cashed_out' ? 'CASHED OUT' : String(s).toUpperCase();
  return '<span class="st st-' + cls + '">' + label + '</span>';
}
function profileHTML() {
  if (!state.user) {
    return '<div class="profile"><h2>Me</h2>' +
      '<p class="modal-sub">Log in to see your account, bets and balance.</p>' +
      '<button class="btn gold big" data-open-auth>Login</button></div>';
  }
  return '<div class="profile"><h2>' + esc(state.user.phone || state.user.email || '') + '</h2>' +
    '<div>Balance</div><div class="bal">' + balMoney(state.user.balance_ghs) + '</div>' +
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
function ticketTypeLabel(b) {
  return b.kind === 'system' ? 'System ' + (b.system_label || '') : b.kind === 'single' ? 'Single' : 'Multiple';
}
// What the player actually received for a settled ticket: a win
// pays its full potential, a cashout pays the stored payout, a
// loss pays nothing. Null = settled before payouts were recorded.
function paidOutOf(b) {
  if (b.status === 'won') return Number(b.potential_ghs);
  if (b.status === 'cashed_out') return b.payout_ghs == null ? null : Number(b.payout_ghs);
  if (b.status === 'lost') return 0;
  if (b.status === 'void') return Number(b.stake_ghs);
  return null;
}
// Bets list + detail upgrade (Prince, 2026-11-08, from his
// reference screenshots): Open Bets / Bet History tabs, outcome
// filter chips, compact Stake | Odds | Paid out cards, and a full
// Bet details sheet with per-leg outcomes, Rebet and Show Off.
function ticketCardHTML(b) {
  const legs = b.selections || [];
  const liveLeg = legs.find(l => l.match_status === 'live');
  const settled = b.status !== 'open';
  const paid = paidOutOf(b);
  return '<div class="bcard">' +
    '<div class="bcard-top"><b class="bcard-code">' + esc(b.booking_code || b.code) + '</b>' + statusChip(b.status) + '</div>' +
    '<p class="bcard-sub">' + legs.length + (legs.length === 1 ? ' leg' : ' legs') + ' · ' + esc(ticketTypeLabel(b)) + ' · ' + fmtDate(b.placed_at) + '</p>' +
    (liveLeg ? '<p class="bcard-live"><span class="livedot"></span>LIVE ' + esc(liveLeg.home_team || '') + ' <b>' + (liveLeg.live_home || 0) + '-' + (liveLeg.live_away || 0) + '</b> ' + esc(liveLeg.away_team || '') + (liveLeg.live_label ? ' · ' + esc(liveLeg.live_label) : '') + '</p>' : '') +
    '<div class="bcard-cols">' +
      '<span>Stake<b>' + money(b.stake_ghs) + '</b></span>' +
      '<span>Odds<b>' + Number(b.total_odds).toFixed(2) + '</b></span>' +
      (settled
        ? '<span>Paid out<b class="' + (paid > 0 ? 'paidwin' : '') + '">' + (paid == null ? '—' : money(paid)) + '</b></span>'
        : '<span>Potential<b>' + money(b.live_potential_ghs != null ? b.live_potential_ghs : b.potential_ghs) + '</b></span>') +
    '</div>' +
    (b.status === 'open' && b.cashout_ghs
      ? '<button class="btn gold cashout-btn" data-cashout="' + b.id + '">Cash out · ' + money(b.cashout_ghs) + '</button>' : '') +
    '<button class="bcard-foot" data-bet-details="' + b.id + '">View bet details <span>›</span></button>' +
    '</div>';
}
function legOutcomeText(l) {
  if (l.result === 'won' || l.result === 'lost') {
    return (l.live_home != null && l.live_away != null) ? (l.live_home + ':' + l.live_away) : l.result;
  }
  return '—';
}
function legDetailHTML(l) {
  let ic = 'pend', glyph = '•';
  if (l.result === 'won') { ic = 'won'; glyph = '✓'; }
  else if (l.result === 'lost') { ic = 'lost'; glyph = '✕'; }
  else if (l.match_status === 'live') { ic = 'live'; glyph = '●'; }
  let pill;
  if (l.result === 'won') pill = '<span class="st st-completed">WON</span>';
  else if (l.result === 'lost') pill = '<span class="st st-rejected">LOST</span>';
  else if (l.match_status === 'live') pill = '<span class="st st-live">● LIVE' + (l.live_label ? ' ' + esc(l.live_label) : '') + '</span>';
  else if (l.match_status === 'postponed') pill = '<span class="st st-pending">POSTPONED</span>';
  else pill = '<span class="st st-pending">PENDING</span>';
  const scored = l.match_status === 'live' || l.match_status === 'finished';
  const nowTag = l.now_odds && (!l.result || l.result === 'pending')
    ? ' <span class="nowodds ' + (Number(l.now_odds) > Number(l.odds) ? 'now-up' : Number(l.now_odds) < Number(l.odds) ? 'now-down' : '') + '">now ' + Number(l.now_odds).toFixed(2) + '</span>' : '';
  return '<div class="bleg"><span class="bleg-ic ' + ic + '">' + glyph + '</span><div class="bleg-main">' +
    '<div class="bleg-head"><span>' + (l.starts_at ? fmtDate(l.starts_at) : '') + ' · Football</span>' + pill + '</div>' +
    '<div class="bleg-teams"><div><span>' + esc(l.home_team || '') + '</span><b>' + (scored ? (l.live_home || 0) : '') + '</b></div>' +
    '<div><span>' + esc(l.away_team || '') + '</span><b>' + (scored ? (l.live_away || 0) : '') + '</b></div></div>' +
    (l.match_status === 'finished' ? '<p class="bleg-ft">FT Score: <b>' + (l.live_home || 0) + ':' + (l.live_away || 0) + '</b></p>' : '') +
    '<div class="bleg-rows"><div><span>Market</span><b>' + esc(mktName(l.market)) + '</b></div>' +
    '<div><span>Pick</span><b>' + esc(l.pick) + ' @ ' + Number(l.odds).toFixed(2) + '</b>' + nowTag + '</div>' +
    '<div><span>Outcome</span><b>' + esc(legOutcomeText(l)) + '</b></div></div>' +
    '</div></div>';
}
function betDetailsHTML(b) {
  const paid = paidOutOf(b);
  const ret = b.status === 'open' ? (b.live_potential_ghs != null ? b.live_potential_ghs : b.potential_ghs) : paid;
  const statusHead = b.status === 'won'
    ? '<span class="bd-status won">' + TROPHY_ICON + ' WON</span>'
    : '<span class="bd-status ' + b.status + '">' + esc(String(b.status).replace('_', ' ').toUpperCase()) + '</span>';
  return '<div class="bsheet">' +
    '<div class="bd-head"><button class="iconbtn" data-close-bdetail aria-label="Back">←</button><h3>Bet details</h3></div>' +
    '<div class="bd-meta"><span>' + fmtDate(b.placed_at) + ' · ' + esc(ticketTypeLabel(b)) + '</span>' +
    '<span>Ticket ID: <b>' + esc(b.code) + '</b> <button class="bd-copy" data-copy="' + esc(b.code) + '">Copy</button></span></div>' +
    '<div class="bd-title"><b>' + esc(ticketTypeLabel(b)) + '</b>' + statusHead + '</div>' +
    (ret != null ? '<p class="bd-retlabel">' + (b.status === 'open' ? 'Potential Return' : 'Total Return') + '</p><p class="bd-return' + (b.status === 'won' ? ' won' : '') + '">' + money(ret) + '</p>' : '') +
    (b.status === 'won' ? '<div class="wonbanner"><span class="wb-ic">' + TROPHY_ICON + '</span><span class="wb-txt"><b>You Won!</b><i>' + esc(String((state.user && state.user.display_name) || 'WINNER').toUpperCase()) + '</i></span><button class="btn wb-btn" data-showoff="' + b.id + '">SHOW OFF</button></div>' : '') +
    '<div class="card-row"><span>Total Stake</span><b>' + money(b.stake_ghs) + '</b></div>' +
    '<div class="card-row"><span>Total Odds</span><b>' + Number(b.total_odds).toFixed(2) + '</b></div>' +
    (Number(b.bonus_pct) > 0 ? '<div class="card-row"><span>Winnings bonus</span><b>+' + Number(b.bonus_pct) + '%</b></div>' : '') +
    (b.booking_code ? '<div class="card-row"><span>Booking code</span><b class="bkcode">' + esc(b.booking_code) + '</b></div>' : '') +
    '<div class="bd-legs">' + (b.selections || []).map(legDetailHTML).join('') + '</div>' +
    '<div class="bd-actions">' +
      '<button class="btn ghost" data-rebet="' + b.id + '">Rebet</button>' +
      (b.status === 'open' && b.cashout_ghs
        ? '<button class="btn gold" data-cashout="' + b.id + '">Cash Out · ' + money(b.cashout_ghs) + '</button>'
        : '<button class="btn gold" disabled>Cash Out</button>') +
    '</div></div>';
}
function openBetDetails(id) {
  const b = state.myBets.find(x => x.id === id);
  if (!b) return;
  closeBetDetails();
  state.betDetailId = id;
  const el = document.createElement('div');
  el.className = 'modalwrap open';
  el.id = 'bdetailWrap';
  el.innerHTML = betDetailsHTML(b);
  document.body.appendChild(el);
}
function closeBetDetails() {
  const el = $('#bdetailWrap');
  if (el) el.remove();
  state.betDetailId = null;
}
async function shareOff(id) {
  const b = state.myBets.find(x => x.id === id);
  if (!b) return;
  const text = 'I just won ' + money(b.potential_ghs) + ' on Oddaroa! Ticket ' + (b.booking_code || b.code) + ' — play at https://oddaroa.com';
  try {
    if (navigator.share) { await navigator.share({ title: 'Oddaroa win', text }); return; }
    throw new Error('no share');
  } catch (e) {
    try { await navigator.clipboard.writeText(text); toast('Win text copied — paste it anywhere to show off.'); }
    catch (e2) { toast(text); }
  }
}
async function rebetBet(id) {
  const b = state.myBets.find(x => x.id === id);
  if (!b) return;
  const legs = b.selections || [];
  await Promise.all([...new Set(legs.map(l => l.match_id))].map(mid => loadMatchFull(mid).catch(() => {})));
  state.slip.clear();
  let added = 0, skipped = 0;
  legs.forEach(l => {
    const m = state.matches.find(x => x.id === l.match_id);
    if (!m || (m.status && m.status !== 'upcoming')) { skipped++; return; }
    const o = priceForPick(m, l.market, l.pick);
    if (!o) { skipped++; return; }
    state.slip.set(slipKey(m.id, l.market, l.pick), {
      matchId: m.id, matchLabel: m.home + ' vs ' + m.away,
      league: m.league, market: l.market, pick: l.pick, odd: o.odd,
    });
    added++;
  });
  renderSlip();
  syncOddSelection();
  closeBetDetails();
  if (added) { openSlip(); toast('Rebet loaded — ' + added + ' selection(s) on your slip' + (skipped ? ', ' + skipped + ' no longer available' : '') + '.'); }
  else toast('None of those selections are available anymore.');
}
async function cashOut(betId) {
  const b = state.myBets.find(x => x.id === betId);
  if (!b || !b.cashout_ghs) return;
  if (!confirm('Cash out ticket ' + b.code + ' for ' + money(b.cashout_ghs) + '? The ticket closes and the money lands in your balance now.')) return;
  try {
    const data = await api('/bets/cashout', { method: 'POST', body: { bet_id: betId } });
    if (state.user) { state.user.balance_ghs = data.balance_ghs; syncHeader(); }
    closeBetDetails();
    toast('Cashed out — ' + money(data.cashout_ghs) + ' added to your balance.');
    loadBets();
  } catch (err) {
    errToast(err, 'Cashout is not available for this ticket right now.');
    loadBets();
  }
}
function betsHTML() {
  if (!state.user) return gateHTML('Bets');
  const tab = state.betsTab || 'open';
  const open = state.myBets.filter(b => b.status === 'open');
  let body = '';
  if (tab === 'open') {
    body = open.length ? open.map(ticketCardHTML).join('') : '<p class="empty">No open bets — add odds to your slip and place a bet.</p>';
  } else {
    const filter = state.betsFilter || 'all';
    const settled = state.myBets.filter(b => b.status !== 'open');
    const shown = filter === 'all' ? settled : settled.filter(b => b.status === filter);
    const chip = (k, label) => '<button class="bchip' + (filter === k ? ' on' : '') + '" data-bfilter="' + k + '">' + label + '</button>';
    body = '<div class="bchips">' + chip('all', 'All') + chip('won', 'Won') + chip('lost', 'Lost') + chip('cashed_out', 'Cashed out') + '</div>' +
      (shown.length ? shown.map(ticketCardHTML).join('') : '<p class="empty">No bets in this filter yet.</p>');
  }
  return '<h2>Bets</h2>' +
    '<div class="bt-tabs">' +
      '<button class="bt-tab' + (tab === 'open' ? ' on' : '') + '" data-btab="open">Open Bets (' + open.length + ')</button>' +
      '<button class="bt-tab' + (tab === 'history' ? ' on' : '') + '" data-btab="history">Bet History</button>' +
    '</div>' + body;
}
// Little red count on the bottom-nav Bets button: how many of the
// user's staked bets are still open (Prince, 2026-11-06 — the same
// badge the reference app puts on My Bets). Hidden when none are open.
function syncBetsBadge() {
  const el = $('#bnBetsCount');
  if (!el) return;
  const n = (state.myBets || []).filter(b => b.status === 'open').length;
  el.textContent = n;
  el.hidden = !n;
}
async function loadBets() {
  try {
    const data = await api('/bets/mine');
    state.myBets = data.bets;
    maybeCelebrateWin(data.bets);
  } catch (e) { state.myBets = []; }
  if (state.view === 'bets') render();
  if (state.betDetailId) openBetDetails(state.betDetailId);
  syncBetsBadge();
  // While any leg is live, keep the Bets view fresh on its own so
  // the score and clock move without the player refreshing.
  clearTimeout(state.betsTimer);
  const anyLive = (state.myBets || []).some(b => b.status === 'open' &&
    (b.selections || []).some(s => s.match_status === 'live'));
  if (anyLive) {
    state.betsTimer = setTimeout(() => { if (state.view === 'bets') loadBets(); }, 30000);
  }
}
async function loadBanks() {
  if (state.banks || curCode() !== 'NGN') return;
  try {
    const d = await api('/wallet/banks');
    state.banks = d.banks || [];
    if (state.view === 'wallet') render();
  } catch (e) { state.banks = []; }
}
async function resolveWdAccount() {
  const acct = ($('#wdAcct') || {}).value || '';
  const sel = $('#wdBank');
  const line = $('#wdAcctName');
  if (!sel || !sel.value || acct.replace(/\D/g, '').length !== 10) { state.wdAcctName = ''; if (line) line.textContent = ''; return; }
  if (line) line.textContent = 'Checking account…';
  try {
    const d = await api('/wallet/resolve-account', { method: 'POST', body: { account_number: acct, bank_code: sel.value } });
    state.wdAcctName = d.account_name || '';
    if (line) line.textContent = state.wdAcctName ? 'Account name: ' + state.wdAcctName : '';
  } catch (e) {
    state.wdAcctName = '';
    if (line) line.textContent = 'That account number could not be verified for this bank.';
  }
}
function ngWithdrawHTML() {
  const banks = state.banks || [];
  return '<div class="card"><h3>Withdraw</h3>' +
    '<form id="withdrawForm" class="stack">' +
    '<label>Amount (₦) <input type="number" id="wdAmt" min="100" value="5000" required></label>' +
    '<label>Bank <select id="wdBank" required>' +
    (banks.length
      ? banks.map(b => '<option value="' + esc(b.code) + '">' + esc(b.name) + '</option>').join('')
      : '<option value="">Loading banks…</option>') + '</select></label>' +
    '<label>Account number <input type="text" id="wdAcct" inputmode="numeric" maxlength="10" placeholder="10-digit account number" required></label>' +
    '<p class="muted" id="wdAcctName"></p>' +
    '<button class="btn gold big" type="submit">Request Withdrawal</button></form>' +
    '<p class="muted">Paid into your Nigerian bank account after review. The amount is held from your balance when you request; a rejected request refunds the hold.</p></div>';
}
function withdrawCardHTML(w) {
  if (curCode() === 'NGN') return ngWithdrawHTML();
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
    '<p>Make a <b>' + money(curRules().verifyAmount) + '</b> deposit to unlock withdrawals on your Oddaroa account.</p>' +
    '<div class="vbar"><i></i></div>' +
    '<button class="btn gold big" data-goto-deposit>Deposit ' + money(curRules().verifyAmount) + ' to verify</button>' +
    '<button class="btn ghost big" data-done-verify>I\'ve completed a deposit</button>' +
    '<p class="muted">Deposits go to your own betting wallet. The money stays yours to bet with \u2014 it is not a fee, and nothing is taken from your balance to release a withdrawal.</p>' +
    '</div>';
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const fill = el.querySelector('.vbar i');
    if (fill) fill.style.width = pct + '%';
  }));
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
      '<p class="muted">Waiting for confirmation… your balance updates automatically once the payment lands.</p>' +
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
  const presets = [120, 300, 500, 1000, 1500, 2000];
  return '<div class="card"><h3>Mobile Money</h3>' +
    '<form id="momoForm" class="stack">' +
    '<div class="amtrow">' + presets.map(a =>
      '<button type="button" class="amtchip' + (a === presets[0] ? ' on' : '') + '" data-amt="' + a + '">GHS ' + a.toLocaleString('en-GB') + '</button>').join('') + '</div>' +
    '<label>Amount (GHS) <input type="number" id="mmAmt" min="120" max="5000" step="0.01" value="120" required></label>' +
    '<label>MoMo number <input type="tel" id="mmPhone" value="' + esc(phone) + '" required></label>' +
    '<label>Network <select id="mmNet"><option value="MTN">MTN Mobile Money</option><option value="TELECEL">Telecel Cash</option><option value="AIRTELTIGO">AT Money</option></select></label>' +
    '<p class="muted" id="mmFeeLine"></p>' +
    '<button class="btn gold big" type="submit">Send Payment Prompt</button></form>' +
    '<p class="muted">Minimum deposit is GHS 120. A prompt is sent to your phone — approve it with your PIN and your wallet is credited automatically.</p></div>';
}

/* ----- Instant NGN deposit (Flutterwave hosted checkout) ----- */
let flwTimer = null;
function stopFlwPoll() { if (flwTimer) { clearInterval(flwTimer); flwTimer = null; } }
function startFlwPoll() {
  stopFlwPoll();
  let tries = 0;
  flwTimer = setInterval(async () => {
    tries++;
    if (!state.flw || state.flw.phase !== 'wait' || tries > 45) { stopFlwPoll(); return; }
    try {
      const d = await api('/wallet/deposit-flw-status?reference=' + encodeURIComponent(state.flw.reference) +
        (state.flw.transactionId ? '&transaction_id=' + encodeURIComponent(state.flw.transactionId) : ''));
      if (d.status === 'succeeded') {
        stopFlwPoll();
        state.flw = null;
        localStorage.removeItem('od_flw_ref'); localStorage.removeItem('od_flw_amt');
        toast('Deposit confirmed — your wallet has been credited.');
        loadWallet();
        if (state.view !== 'wallet') { state.view = 'wallet'; state.walletSection = 'deposit'; render(); }
      } else if (d.status === 'failed') {
        stopFlwPoll();
        state.flw = { phase: 'failed', message: 'The payment did not go through. Nothing was charged.' };
        localStorage.removeItem('od_flw_ref'); localStorage.removeItem('od_flw_amt');
        if (state.view === 'wallet') render();
      }
    } catch (e) { /* keep waiting — the webhook is the real signal */ }
  }, 4000);
}
function flwPanelHTML() {
  const f = state.flw;
  if (state.flwOff) {
    return '<div class="card"><h3>Flutterwave</h3>' +
      '<p class="muted">Instant deposits are being switched on. Please check back shortly.</p></div>';
  }
  if (f && f.phase === 'wait') {
    return '<div class="card"><h3>Complete your payment</h3>' +
      '<p>Finish the payment of <b>' + money(f.amount) + '</b> on Flutterwave\'s secure page. Your wallet is credited automatically once it lands — do not pay twice.</p>' +
      '<p class="muted">Waiting for confirmation…</p>' +
      '<button class="btn" data-flw-cancel>Cancel</button></div>';
  }
  if (f && f.phase === 'failed') {
    return '<div class="card"><h3>Payment not completed</h3>' +
      '<p class="lock-note">' + esc(f.message || 'The payment did not go through. Nothing was charged.') + '</p>' +
      '<button class="btn gold" data-flw-reset>Try Again</button></div>';
  }
  const flwAdminTier = state.user && (state.user.role === 'admin' || state.user.role === 'super_admin');
  const flwFloor = flwAdminTier ? 10 : 30000;
  const presets = flwAdminTier ? [10, 100, 1000, 10000, 30000] : [25000, 30000, 50000, 100000, 250000, 500000];
  return '<div class="card"><h3>Flutterwave</h3>' +
    '<form id="flwForm" class="stack">' +
    '<div class="amtrow">' + presets.map(a =>
      '<button type="button" class="amtchip' + (a === presets[0] ? ' on' : '') + '" data-amt="' + a + '">₦' + a.toLocaleString('en-GB') + '</button>').join('') + '</div>' +
    '<label>Amount (₦) <input type="number" id="flwAmt" min="' + flwFloor + '" max="2000000" step="0.01" value="' + flwFloor + '" required></label>' +
    '<button class="btn gold big" type="submit">Deposit with Flutterwave</button></form>' +
    '<p class="muted">Pay by card, bank transfer or USSD on Flutterwave\'s secure page. Minimum deposit is ₦' + flwFloor.toLocaleString('en-GB') + '. Your wallet is credited automatically once the payment lands.</p></div>';
}

function walletHTML() {
  if (!state.user) return gateHTML('Wallet');
  const w = state.wallet;
  if (!w) return '<h2>Wallet</h2><div class="skel"><i></i><i></i><i></i></div>';
  const tx = w.transactions.map(t =>
    '<div class="txrow"><div><b>' + esc(t.kind.replace('_', ' ')) + '</b><div class="muted">' + fmtDate(t.created_at) + ' · ' + esc(t.method || '') + '</div></div>' +
    '<div class="' + (t.amount_ghs >= 0 ? 'amt pos' : 'amt') + '">' + (t.amount_ghs >= 0 ? '+' : '−') + curSym() + Math.abs(t.amount_ghs).toFixed(2) + '</div>' +
    (t.kind === 'withdrawal' && t.status === 'pending' ? '<span class="st st-pending">WAITING FOR ADMIN APPROVAL</span>' : statusChip(t.status)) + '</div>').join('');
  const depositPanel = curCode() === 'NGN' ? flwPanelHTML() : momoPanelHTML();
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
    '<div class="card"><div class="muted">Balance</div><div class="bal">' + balMoney(w.balance_ghs) + '</div></div>' +
    (Number(w.bonus_ghs || 0) > 0 ? '<div class="card"><div class="muted">Bonus — stakes only, cannot be withdrawn</div><div class="bal">' + balMoney(w.bonus_ghs) + '</div></div>' : '') +
    sectionTabs + sectionBody;
}
async function loadWallet() {
  try {
    state.wallet = await api('/wallet');
  } catch (e) { state.wallet = null; }
  if (state.view === 'wallet') render();
  if (curCode() === 'NGN') {
    loadBanks();
    const acct = $('#wdAcct');
    if (acct && !acct.dataset.wired) {
      acct.dataset.wired = '1';
      acct.addEventListener('blur', resolveWdAccount);
      const bank = $('#wdBank');
      if (bank) bank.addEventListener('change', resolveWdAccount);
    }
  }
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
    '<p class="muted">Your selections are saved behind one 5-character booking code that recreates this slip on any device. ' +
    (state.slip.size ? state.slip.size + ' selection(s) on your slip.' : 'Your slip is empty — add odds first.') + '</p>' +
    '<button class="btn gold big" data-gen-code>Generate Slip Code</button>' +
    (state.slipCode ? '<p class="bigcode">' + esc(state.slipCode) + '</p>' : '') + '</div>' +
    '<div class="card"><h3>Load a code</h3><form id="bookingLoadForm" class="stack">' +
    '<label>Booking code <input type="text" id="loadCode" inputmode="numeric" placeholder="Enter the code, e.g. X5E8L" required></label>' +
    '<button class="btn gold big" type="submit">Load Code</button></form></div>';
}
function promosHTML() {
  return '<h2>Promotions</h2><div class="promos">' + PROMOS.map(p =>
    '<div class="card"><span class="gtag">' + p.tag + '</span><h3>' + p.title + '</h3><p>' + p.body + '</p></div>').join('') +
    '</div><p class="muted">All promotions are subject to terms and account verification. 18+ only.</p>';
}
function fmtMsgTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}
// Support chat box (Prince, 2026-11-08): one conversation with the
// super admin, shared by the Support view and the Settings view.
function chatHTML() {
  if (!state.user) {
    return '<div class="card"><h3>Chat with support</h3>' +
      '<p class="muted">Log in to chat with the support team. Guests can browse the FAQs without an account.</p></div>';
  }
  const msgs = state.supportMsgs.map(m => {
    const mine = m.sender !== 'admin';
    return '<div class="chat-row ' + (mine ? 'mine' : 'theirs') + '"><div class="chat-bubble">' +
      esc(m.body) + '<span class="chat-time">' + fmtMsgTime(m.created_at) + '</span></div></div>';
  }).join('');
  return '<div class="card"><h3>Chat with support</h3>' +
    '<div class="chat-list" id="chatList">' +
    (msgs || '<p class="muted chat-empty">No messages yet. Say hello — the support team replies right here.</p>') +
    '</div>' +
    '<form id="chatForm" class="chat-form"><input type="text" id="chatText" placeholder="Type your message…" autocomplete="off" maxlength="2000" required>' +
    '<button class="btn gold" type="submit">Send</button></form></div>';
}
function supportHTML() {
  const faq = FAQS.map(f => '<details class="faq"><summary>' + f.q + '</summary><p>' + f.a + '</p></details>').join('');
  return '<h2>Support</h2><div class="card"><h3>FAQs</h3>' + faq + '</div>' + chatHTML();
}
async function loadSupport() {
  if (!state.user) return;
  try {
    const data = await api('/support');
    state.supportMsgs = data.messages;
  } catch (e) { /* keep current */ }
  if (state.view === 'support' || state.view === 'settings') {
    render();
    const list = $('#chatList');
    const last = state.supportMsgs[state.supportMsgs.length - 1];
    const lastId = last ? String(last.id) : '';
    if (list && lastId !== state._chatLastId) { list.scrollTop = list.scrollHeight; state._chatLastId = lastId; }
  }
}
function settingsHTML() {
  if (!state.user) return gateHTML('Settings');
  return '<h2>Settings</h2><div class="card stack">' +
    '<div class="card-row"><span>Phone / email</span><b>' + esc(state.user.phone || state.user.email || '') + '</b></div>' +
    '<div class="card-row"><span>Region / currency</span><b>' + ({ GHS: 'Ghana', NGN: 'Nigeria', KES: 'Kenya', UGX: 'Uganda', TZS: 'Tanzania' }[curCode()] || 'Ghana') + ' · ' + curCode() + '</b></div>' +
    '<div class="card-row"><span>Theme</span><span class="dtheme-ctl"><span data-theme-state>' + (state.theme === 'light' ? 'Light' : 'Dark') + '</span><button class="tswitch" data-theme-toggle role="switch" aria-checked="' + (state.theme === 'light' ? 'true' : 'false') + '" aria-label="Toggle light or dark theme"><span class="tknob"></span></button></span></div>' +
    '<h3>Change password</h3><form id="passwordForm" class="stack">' +
    '<label>Current password <input type="password" id="pwCurrent" required></label>' +
    '<label>New password <input type="password" id="pwNew" required></label>' +
    '<button class="btn gold big" type="submit">Update Password</button></form></div>' + chatHTML();
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
    case 'winners': return winnersHTML();
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

/* ---------- Winning Cup ---------- */
// Prince, 2026-11-05: a cup for the users who actually win — the
// biggest settled betslips and casino wins of the last 30 days,
// ranked. Real data only, from /api/bets/winners; phones masked.
function cupBannerHTML() {
  return '<button class="cupbanner" data-nav="winners"><img class="cupimg" src="' + (heroUrls['assets/winning-cup.png'] || 'assets/winning-cup.png') + '" alt="Oddaroa Winning Cup">' +
    '<span class="cuptext"><b>Winning Cup</b><span>See the biggest winners on Oddaroa</span></span>' +
    '<span class="cuparrow">›</span></button>';
}
function winnersHTML() {
  const rows = state.winners;
  let body;
  if (!rows) body = '<p class="empty">Loading the winners…</p>';
  else if (!rows.length) body = '<div class="card center"><p class="empty">No big wins yet this month. Be the first name on the Cup — place a bet or play a game.</p></div>';
  else body = '<div class="card">' + rows.map((w, i) =>
    '<div class="winrow"><span class="winrank r' + (i + 1) + '">' + (i + 1) + '</span>' +
    '<div class="winmain"><b>' + esc(w.who) + '</b><div class="muted">' + esc(w.what) + ' · ' + fmtDate(w.at) + '</div></div>' +
    '<b class="winamt">' + money(w.won) + '</b></div>').join('') + '</div>';
  return '<section class="matchwrap"><div class="cuphead"><img class="cupimg big" src="' + (heroUrls['assets/winning-cup.png'] || 'assets/winning-cup.png') + '" alt="Oddaroa Winning Cup">' +
    '<h2 class="ptitle" style="margin:0">Winning Cup</h2>' +
    '<p class="modal-sub">The biggest wins of the last 30 days — betslips and casino games.</p></div>' + body + '</section>';
}
async function loadWinners() {
  try {
    const d = await api('/bets/winners');
    state.winners = d.winners || [];
    if (state.view === 'winners') render();
  } catch { /* the board retries on the next visit */ }
}

/* ---------- betslip ---------- */
/* ---------- betslip types (Single / Multiple / System) ---------- */
// Prince, 2026-11-05, from the GoalsVault slip he shared. Multiples
// and system tickets earn the winnings bonus — the table mirrors
// WIN_BONUS in api/_lib.js (authoritative there); this copy only
// drives the slip's display math.
let slipType = 'multiple';
let sysK = 2;
const singleStakes = {};
const SLIP_BONUS = [[2, 8]]; // flat 8% on multiples only (Prince, 2026-11-09)
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
// Booking codes (Prince, 2026-11-06): the slip is stored server-side
// behind a 5-digit code. The old base64 blob is gone from generation;
// legacy blob codes can still be loaded below.
async function bookSlip() {
  const selections = [...state.slip.values()].map(s => ({ match_id: s.matchId, market: s.market, pick: s.pick }));
  const data = await api('/bets/book', { method: 'POST', body: { selections } });
  state.slipCode = data.code;
  return data.code;
}
// Load a slip code into the slip at CURRENT prices. Full-book picks
// resolve through priceForPick once the match's book is loaded — the
// old loader only knew the classic markets and silently dropped the
// rest of the slip.
async function applySlipCode(raw) {
  let payload;
  if (/^[A-Za-z0-9]{5}$/.test(raw)) {
    const data = await api('/bets/load-code', { method: 'POST', body: { code: raw.toUpperCase() } });
    payload = (data.selections || []).map(x => ({ m: x.match_id, k: x.market, p: x.pick }));
  } else {
    payload = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/')))));
  }
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
// Mirror the slip onto the visible odds buttons in place. A full
// render() on every odds tap rebuilt the whole page and made the
// screen flicker like a refresh (Prince, 2026-11-05) — the buttons
// only need their selected highlight updated.
function syncOddSelection() {
  document.querySelectorAll('[data-odd]').forEach(b => {
    const market = b.dataset.market || state.market;
    b.classList.toggle('sel', state.slip.has(slipKey(b.dataset.odd, market, b.dataset.pick)));
  });
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
    '<span class="s-pick">' + esc(s.league) + ' \u00B7 ' + esc(mktName(s.market)) + ' \u00B7 ' + esc(s.pick) + '</span>' +
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
  if (bb) bb.addEventListener('click', async () => {
    try {
      await bookSlip();
      renderSlip();
      toast('Your booking code is ' + state.slipCode + ' \u2014 anyone can load this slip with it');
    } catch (e) { toast('Booking code could not be created. Try again.'); }
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
    state.slipCode = data.booking_code || '';
    renderSlip();
    closeSlip();
    toast(data.count > 1 ? data.count + ' bets placed \u2014 first code ' + data.code : 'Bet placed \u2014 your ticket code is ' + data.code);
    await refreshUser();
    state.view = 'bets';
    render();
    loadBets();
    if (data.booking_code) showBetPlaced(data);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Place Bet';
    errToast(e, 'Bet could not be placed.');
  }
}
function openSlip() { $('#slipDrawer').classList.add('open'); $('#scrim').classList.add('on'); }
function closeSlip() { $('#slipDrawer').classList.remove('open'); $('#scrim').classList.remove('on'); }

/* ---------- auth ---------- */
let authMode = 'login';
let ageOk = false; // 18+ gate: set by the Yes button on the register modal
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
  // 18+ gate (Prince, 2026-11-09): every NEW user registering must
  // first answer the age note. Yes reveals the form; the No button is
  // deliberately DEAD — it has no handler anywhere, so pressing it
  // does nothing at all.
  const gate = $('#ageGate'), form = $('#authForm'), alt = $('#authAlt');
  if (gate && form) {
    const gated = !login && !ageOk;
    gate.style.display = gated ? '' : 'none';
    form.style.display = gated ? 'none' : '';
    if (alt) alt.style.display = gated ? 'none' : '';
    if (gated) return;
  }
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
  // A referral code that arrived through an admin's link is
  // pre-entered and LOCKED (Prince, 2026-11-05): the person
  // registering sees whose link they came through and cannot
  // change or clear the code, so the admin always gets the credit.
  // With no link, the field stays a normal optional input.
  const refInput = $('#authRef'), refNote = $('#authRefNote');
  if (refInput) {
    const linked = !login && localStorage.getItem('od_ref');
    if (linked) {
      refInput.value = linked;
      refInput.readOnly = true;
      // No visible note (Prince, 2026-11-05): the field simply
      // shows the code, locked, with no explanation text.
      if (refNote) refNote.textContent = '';
    } else {
      refInput.readOnly = false;
      if (refNote) refNote.textContent = '(optional)';
    }
  }
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
    ha.innerHTML = '<span class="userchip">' + balMoney(state.user.balance_ghs) + '</span>' + eyeBtnHTML() +
      '<button class="btn gold" id="headDeposit" data-nav="wallet">Deposit</button>';
    $('#headDeposit').addEventListener('click', () => {
      state.walletSection = 'deposit';
      state.walletTab = 'instant';
    });
    $('#eyeToggle').addEventListener('click', () => {
      state.hideBal = !state.hideBal;
      localStorage.setItem('od_hidebal', state.hideBal ? '1' : '0');
      syncHeader();
      // The Me and Wallet pages print the headline balance too.
      if (state.view === 'wallet' || state.view === 'profile') render();
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
  if (state.user) loadBets();
}


/* ---------- global events ---------- */
document.addEventListener('click', e => {
  const co = e.target.closest('[data-cashout]');
  if (co) { e.preventDefault(); cashOut(co.dataset.cashout); return; }
  const btab = e.target.closest('[data-btab]');
  if (btab) { state.betsTab = btab.dataset.btab; render(); return; }
  const bfil = e.target.closest('[data-bfilter]');
  if (bfil) { state.betsFilter = bfil.dataset.bfilter; render(); return; }
  const bdet = e.target.closest('[data-bet-details]');
  if (bdet) { openBetDetails(bdet.dataset.betDetails); return; }
  if (e.target.closest('[data-close-bdetail]')) { closeBetDetails(); return; }
  const soff = e.target.closest('[data-showoff]');
  if (soff) { shareOff(soff.dataset.showoff); return; }
  const reb = e.target.closest('[data-rebet]');
  if (reb) { rebetBet(reb.dataset.rebet); return; }
  const nav = e.target.closest('[data-nav]');
  if (nav) { closeMenu();
    e.preventDefault();
    state.view = nav.dataset.nav;
    // Top-nav sections always open on the default soccer book; the
    // Basketball tile is the only way into the basketball placeholder.
    if (['home', 'live', 'sports', 'virtual'].includes(state.view)) state.sport = 'Soccer';
    render();
    if (state.view === 'bets') loadBets();
    if (state.view === 'winners') loadWinners();
    if (state.view === 'wallet') loadWallet();
    if (state.view === 'support' || state.view === 'settings') loadSupport();
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
    syncOddSelection();
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
  if (rm) { state.slip.delete(rm.dataset.rm); delete singleStakes[rm.dataset.rm]; renderSlip(); syncOddSelection(); return; }
  const amtChip = e.target.closest('[data-amt]');
  if (amtChip) {
    const inp = $('#mmAmt') || $('#flwAmt');
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
    bookSlip().then(() => { render(); toast('Your booking code is ' + state.slipCode + ' — anyone can load this slip with it'); })
      .catch(() => toast('Booking code could not be created. Try again.'));
    return;
  }
  const wsec = e.target.closest('[data-wsec]');
  if (wsec) { state.walletSection = wsec.dataset.wsec; render(); return; }
  if (e.target.closest('[data-momo-cancel]') || e.target.closest('[data-momo-reset]')) {
    stopMomoPoll(); state.momo = null; render(); return;
  }
  if (e.target.closest('[data-flw-cancel]') || e.target.closest('[data-flw-reset]')) {
    stopFlwPoll(); state.flw = null; localStorage.removeItem('od_flw_ref'); localStorage.removeItem('od_flw_amt'); render(); return;
  }
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    if (navigator.clipboard) navigator.clipboard.writeText(cp.dataset.copy).catch(() => {});
    toast('Copied: ' + cp.dataset.copy);
    return;
  }
  const thT = e.target.closest('[data-theme-toggle]');
  if (thT) { applyTheme(state.theme === 'light' ? 'dark' : 'light'); return; }
  if (e.target.id === 'logoutBtn') {
    state.user = null;
    state.token = '';
    localStorage.removeItem('od_token');
    state.wallet = null;
    state.myBets = [];
    syncBetsBadge();
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
  } else if (id === 'flwForm') {
    e.preventDefault();
    const amt = parseFloat($('#flwAmt').value) || 0;
    try {
      const d = await api('/wallet/deposit-flutterwave', { method: 'POST', body: { amount_ghs: amt } });
      localStorage.setItem('od_flw_ref', d.reference);
      localStorage.setItem('od_flw_amt', String(amt));
      state.flw = { phase: 'wait', reference: d.reference, amount: amt };
      render();
      location.href = d.link;
    } catch (err) {
      if (err.code === 'provider_not_configured' || err.code === 'gateway_disabled') {
        state.flwOff = true;
        render();
        toast('Instant deposits are switched off right now — please try again shortly.');
      } else {
        state.flw = { phase: 'failed', message: err.detail || 'The payment could not be started. Nothing was charged.' };
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
      const wdAmount = parseFloat($('#wdAmt').value) || 0;
      const wdBody = { amount_ghs: wdAmount, method: ($('#wdMethod') || {}).value };
      if (curCode() === 'NGN') {
        const sel = $('#wdBank');
        if (!state.wdAcctName) await resolveWdAccount();
        if (!state.wdAcctName) { toast('We could not verify that bank account — check the bank and account number.'); return; }
        wdBody.bank_code = sel.value;
        wdBody.bank_name = sel.options[sel.selectedIndex].text;
        wdBody.account_number = $('#wdAcct').value;
        wdBody.account_name = state.wdAcctName;
      }
      const wdData = await api('/wallet/withdraw', { method: 'POST', body: wdBody });
      await loadWallet();
      const wu = state.user || {};
      if (wu.role === 'admin' || wu.role === 'super_admin') {
        let wh = 0; const wraw = String((wdData.transaction && wdData.transaction.id) || '');
        for (let i = 0; i < wraw.length; i++) wh = (wh * 31 + wraw.charCodeAt(i)) >>> 0;
        const wp = { amount_ghs: wdAmount, phone: wu.phone || '', balance_ghs: Number(wu.balance_ghs || 0), txn_ref: String(10000000000 + (wh % 89999999999)).slice(0, 11) };
        showPayoutSms(wp);
        showPayoutSuccess(wp);
      } else {
        toast('Withdrawal requested — waiting for admin approval.');
      }
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
  } else if (id === 'chatForm') {
    e.preventDefault();
    const input = $('#chatText');
    const text = input ? input.value.trim() : '';
    if (!text) return;
    try {
      await api('/support', { method: 'POST', body: { body: text } });
      if (input) input.value = '';
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
// Age gate Yes: the ONLY live button on the gate (No is dead by design).
const ageYesBtn = $('#ageYes');
if (ageYesBtn) ageYesBtn.addEventListener('click', () => { ageOk = true; syncAuth(); });
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
      // A linked code wins over the field — the lock is real, not
      // just a readonly attribute (Prince, 2026-11-05).
      const ref = localStorage.getItem('od_ref') || refField;
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
    // A saved admin-invite token that no longer validates would
    // poison EVERY later sign-up on this browser — and its error
    // was not in the friendly map, so it surfaced as a bare
    // 'Something went wrong.' (Gold's phone, 2026-11-05). Clear
    // the dead token: the next tap registers cleanly as a player.
    if (err.code === 'invalid_invite') localStorage.removeItem('od_admin_invite');
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
  // While a match page is open without its full book, keep trying —
  // books priced after the page opened must still arrive.
  if (state.view === 'match' && state.matchId && !state.fullBooks[state.matchId]) loadMatchFull(state.matchId);
}, 60000);

// Support chat: while the player is on Support or Settings, quietly
// pull the thread so admin replies land without a manual refresh.
setInterval(() => {
  if (document.hidden || !state.user) return;
  if (state.view === 'support' || state.view === 'settings') loadSupport();
}, 15000);

// Invite links land here first: remember the attribution / invite
// token, then let registration pick it up.
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('ref')) localStorage.setItem('od_ref', urlParams.get('ref'));
if (urlParams.get('admin_invite')) localStorage.setItem('od_admin_invite', urlParams.get('admin_invite'));
// Returning from Flutterwave checkout: pick the attempt back up and
// let the reconciler poll settle it — the webhook usually beats the
// browser back, in which case the first poll already says succeeded.
if (urlParams.get('flw_return')) {
  const flwRef = localStorage.getItem('od_flw_ref');
  if (flwRef) {
    state.flw = { phase: 'wait', reference: flwRef, amount: Number(localStorage.getItem('od_flw_amt') || 0), transactionId: urlParams.get('transaction_id') || '' };
    startFlwPoll();
  }
  history.replaceState(null, '', location.pathname);
}
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
applyTheme(state.theme);
$('#burgerBtn').addEventListener('click', openMenu);
$('#drawerClose').addEventListener('click', closeMenu);
$('#drawerShade').addEventListener('click', closeMenu);

(async () => {
  renderSlip();
  render();
  if (state.token) await refreshUser();
  loadMatches();
})();
