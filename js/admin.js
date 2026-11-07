// Oddaroa back office — TWO separate portals sharing this console:
//   admin.html        -> the Admin Portal (admin accounts)
//   super-admin.html  -> the Super Admin Portal (super_admin accounts only)
// The portal is fixed by the page (window.PS_PORTAL). Super-only powers
// (Platform Control, role changes, balance edits, invites, featured
// matches) exist ONLY inside the Super Admin Portal, even for a
// super_admin who signs in to the Admin Portal. The API also enforces
// the super_admin role server-side; this split is the operator-facing
// separation Prince asked for on 2026-11-03.
const PORTAL = window.PS_PORTAL === 'super' ? 'super' : 'admin';
const isSuperPortal = PORTAL === 'super';
function portalAllows(user) {
  if (!user) return false;
  return isSuperPortal
    ? user.role === 'super_admin'
    : user.role === 'admin' || user.role === 'super_admin';
}
function superTools() {
  return isSuperPortal && !!state.user && state.user.role === 'super_admin';
}
const state = {
  token: localStorage.getItem('ps_admin_token') || '',
  user: null,
  tab: 'dashboard',
  stats: null, queue: [], matches: [], users: [], support: [],
  settings: null, myDash: null, invites: [], lastInvite: '',
  work: null, workMode: 'day', workDate: '', workFrom: '', workTo: '', workAdmin: '',
  offline: false,
  // Set when this page was opened from a super admin's invite link:
  // the portal then shows its own admin account-creation page
  // instead of the login form (Prince, 2026-11-05).
  invite: new URLSearchParams(location.search).get('admin_invite') || '',
  inviteDone: '',
  editingMatch: '',
  createdMatches: [],
};
const $ = (s, r = document) => r.querySelector(s);
const root = $('#adminRoot');
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3600);
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function money(n) { return 'GHS ' + Number(n || 0).toFixed(2); }
// A row's currency follows the account's phone country (Nigeria went
// live on Flutterwave, 2026-11-07): NG rows are naira, everything
// else stays GHS. Used wherever a row belongs to one player.
function moneyC(n, phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return (d.startsWith('234') ? '₦' : 'GHS ') + Number(n || 0).toFixed(2);
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && data.error === 'backend_not_configured') {
    state.offline = true;
    throw new Error('Backend not configured yet — set DATABASE_URL and SESSION_SECRET in Vercel first.');
  }
  if (!res.ok) throw new Error(data.detail || data.error || 'request_failed');
  return data;
}
// Full-screen viewer for a deposit's transaction screenshot; tap
// anywhere to close. The image arrives as a data URL from the API.
function showProof(src) {
  const old = $('#proofOverlay');
  if (old) old.remove();
  const d = document.createElement('div');
  d.id = 'proofOverlay';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:99;display:flex;align-items:center;justify-content:center;padding:16px';
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:100%;max-height:100%;border-radius:8px';
  d.appendChild(img);
  d.addEventListener('click', () => d.remove());
  document.body.appendChild(d);
}
function chip(s) {
  const cls = s === 'completed' || s === 'won' || s === 'active' ? 'completed' : s === 'rejected' || s === 'lost' || s === 'blocked' ? 'rejected' : 'pending';
  return '<span class="st st-' + cls + '">' + String(s).toUpperCase() + '</span>';
}

function loginHTML() {
  return '<div class="profile"><h2>' + (isSuperPortal ? 'Super Admin Login' : 'Admin Login') + '</h2>' +
    '<p class="modal-sub">' + (isSuperPortal
      ? 'Super admin accounts only. Platform Control lives here, not in the Admin Portal.'
      : 'Admin accounts only. This page is not linked from the public site.') + '</p>' +
    '<form id="adminLogin" class="stack">' +
    '<label>Phone number or email <input type="text" id="adPhone" required></label>' +
    '<label>Password <input type="password" id="adPass" required></label>' +
    '<button class="btn gold big" type="submit">Login</button></form>' +
    (state.offline ? '<p class="lock-note">Backend not configured yet — set DATABASE_URL and SESSION_SECRET in the Vercel project first.</p>' : '') +
    // No portal cross-link under the Admin Portal login (Prince,
    // 2026-11-05): admins should not see a super admin signpost on
    // their page. The Super Portal keeps its pointer for admins who
    // land there by mistake.
    (isSuperPortal
      ? '<p class="modal-sub">Regular admin? Use the <a href="admin.html">Admin Portal</a>.</p>'
      : '') +
    '</div>';
}
function tabsHTML() {
  const tabs = [['dashboard', 'Dashboard'], ['queue', 'Payout Queue'], ['users', 'Users'], ['support', 'Support'], ['earnings', 'My Earnings']];
  // Matches live ONLY in the Super Portal (Prince, 2026-11-05:
  // "there should be no matches" on the admin dashboard) — creating,
  // going live and settling are super admin work.
  if (isSuperPortal) tabs.splice(2, 0, ['matches', 'Matches']);
  if (superTools()) tabs.push(['control', 'Platform Control']);
  return '<div class="wtabs">' + tabs.map(([k, label]) =>
    '<button class="' + (state.tab === k ? 'on' : '') + '" data-atab="' + k + '">' + label + '</button>').join('') + '</div>';
}
function siteLink(path) { return location.origin + path; }
const ESPN_LEAGUES = [
  ['eng.1', 'Premier League'], ['esp.1', 'La Liga'], ['ita.1', 'Serie A'],
  ['ger.1', 'Bundesliga'], ['fra.1', 'Ligue 1'], ['por.1', 'Primeira Liga'],
  ['ned.1', 'Eredivisie'], ['uefa.champions', 'Champions League'],
  ['uefa.europa', 'Europa League'], ['gha.1', 'Ghana Premier League'], ['usa.1', 'MLS'],
];
function espnHTML() {
  const boxes = ESPN_LEAGUES.map(([slug, name]) =>
    '<label class="checkrow"><input type="checkbox" class="espn-league" value="' + slug + '" checked> ' + name + '</label>').join('');
  return '<div class="card"><h3>ESPN fixture sync</h3>' +
    '<p class="muted">Pulls fixtures, live scores and team logos from ESPN for the next 7 days (plus yesterday). Matches with ESPN odds import priced; the rest import ready for you to price. Syncing again updates scores and status without duplicating matches.</p>' +
    '<div class="espn-grid">' + boxes + '</div>' +
    '<button class="btn gold big" id="espnSync">Sync From ESPN</button>' +
    '<p class="muted" id="espnResult"></p></div>';
}
function dashboardHTML() {
  const s = state.stats;
  const grid = s ? [
    ['Users', s.users], ['Blocked users', s.blocked_users],
    ['Bets today', s.bets_today], ['Open bets', s.open_bets],
    ['Stakes today', money(s.stakes_today_ghs)],
    ['Pending deposits', s.pending_deposits], ['Pending withdrawals', s.pending_withdrawals],
    ['Open support', s.open_support],
  ].map(([l, v]) => '<div class="stat"><div class="muted">' + l + '</div><div class="stat-v">' + v + '</div></div>').join('') : '<p class="muted">Loading…</p>';
  // The ESPN fixture sync is a super admin tool (Prince, 2026-11-05:
  // "dont let the admin show the super admin option on thier pages")
  // — it renders only for the super_admin ROLE, on either portal.
  const isSuperRole = !!state.user && state.user.role === 'super_admin';
  return tabsHTML() + '<div class="stats">' + grid + '</div>' + workHTML() + referralCardHTML() + (isSuperRole ? espnHTML() : '') + queueHTML(true);
}

// Per-day work sheet (Prince, 2026-11-07): the Dashboard opens with
// what the signed-in admin has DONE in the selected day — queue
// decisions, referrals joined, commission earned — and the day
// rolls over at midnight Accra time. Any past day is one pick away
// (that is the history), and the super admin sees every admin's
// sheet plus a custom date range and a per-admin filter, so
// accountability is complete.
function workQuery() {
  if (state.workMode === 'range' && state.workFrom && state.workTo) return '?from=' + state.workFrom + '&to=' + state.workTo;
  return state.workDate ? '?date=' + state.workDate : '';
}
async function loadWork() {
  const w = await api('/admin/worklog' + workQuery()).catch(() => null);
  if (w) { state.work = w; render(); }
}
function workTiles(w) {
  if (!w) return '<p class="muted">Nothing recorded.</p>';
  const tiles = [
    ['Deposits confirmed', w.deposits_done_n + ' · ' + money(w.deposits_done_ghs)],
    ['Deposits rejected', String(w.deposits_rejected_n)],
    ['Withdrawals confirmed', w.withdrawals_done_n + ' · ' + money(w.withdrawals_done_ghs)],
    ['Withdrawals rejected', String(w.withdrawals_rejected_n)],
    ['New referrals', String(w.referrals_n)],
    ['Commission earned', money(w.commission_earned_ghs)],
    ['Commission paid out', money(w.commission_paid_ghs)],
  ];
  return '<div class="stats">' + tiles.map(([l, v]) => '<div class="stat"><div class="muted">' + l + '</div><div class="stat-v">' + v + '</div></div>').join('') + '</div>';
}
function workHTML() {
  const wk = state.work;
  const isSuper = !!state.user && state.user.role === 'super_admin';
  if (!wk) return '<div class="card"><h3>Work sheet</h3><p class="muted">Loading…</p></div>';
  const per = wk.period || { from: wk.today, to: wk.today };
  const isToday = per.from === wk.today && per.to === wk.today;
  const title = state.workMode === 'range' ? 'Work — ' + per.from + ' → ' + per.to : (isToday ? "Today's work" : 'Work — ' + per.from);
  let h = '<div class="card"><h3>' + title + '</h3>';
  h += '<div class="row wrap gap"><label class="muted">Day <input type="date" id="workDate" value="' + per.from + '"></label>' +
    '<button class="btn" id="workTodayBtn">Today</button>' +
    (isSuper ? '<label class="muted">From <input type="date" id="workFrom" value="' + (state.workFrom || per.from) + '"></label><label class="muted">To <input type="date" id="workTo" value="' + (state.workTo || per.to) + '"></label><button class="btn gold" id="workRangeBtn">View range</button>' : '') +
    '</div>';
  h += '<p class="muted">Your work ' + (isToday && state.workMode === 'day' ? 'today' : 'in this period') + ' — it refreshes with each new day; pick any past day above to see that day\'s sheet.</p>';
  h += workTiles(wk.me);
  if (isSuper && Array.isArray(wk.admins)) {
    const names = wk.admins.map(a => '<option value="' + a.admin_id + '"' + (state.workAdmin === a.admin_id ? ' selected' : '') + '>' + esc(a.display_name || a.phone) + '</option>').join('');
    h += '<h3>All admins — ' + (state.workMode === 'range' ? per.from + ' → ' + per.to : per.from) + '</h3>' +
      '<div class="row wrap gap"><label class="muted">Admin <select id="workAdminSel"><option value="">All admins</option>' + names + '</select></label></div>';
    const rows = wk.admins.filter(a => !state.workAdmin || a.admin_id === state.workAdmin);
    h += rows.map(a => '<div class="stat" style="margin-top:8px"><div class="muted">' + esc(a.display_name || a.phone) + ' · ' + (a.role === 'super_admin' ? 'Super admin' : 'Admin') + '</div>' +
      '<div>Deposits: <b>' + a.deposits_done_n + '</b> (' + money(a.deposits_done_ghs) + ') · Rejected: <b>' + a.deposits_rejected_n + '</b> · Withdrawals: <b>' + a.withdrawals_done_n + '</b> (' + money(a.withdrawals_done_ghs) + ') · Rejected: <b>' + a.withdrawals_rejected_n + '</b></div>' +
      '<div>Referrals joined: <b>' + a.referrals_n + '</b> · Commission earned: <b>' + money(a.commission_earned_ghs) + '</b> · Paid out: <b>' + money(a.commission_paid_ghs) + '</b></div></div>').join('');
    if (wk.totals) h += '<p class="muted" style="margin-top:8px">Totals — deposits confirmed ' + wk.totals.deposits_done_n + ' (' + money(wk.totals.deposits_done_ghs) + '), withdrawals confirmed ' + wk.totals.withdrawals_done_n + ' (' + money(wk.totals.withdrawals_done_ghs) + '), referrals ' + wk.totals.referrals_n + ', commission earned ' + money(wk.totals.commission_earned_ghs) + '.</p>';
  }
  return h + '</div>';
}

// Referral centre, on the Dashboard itself (Prince, 2026-11-05):
// every admin-tier account's personal user-referral link plus the
// users it brought in. Players who register through the link are
// active immediately — no confirmation step exists for them. The
// super admin additionally sees every admin's referral numbers.
function payoutCardHTML() {
  const d = state.myDash;
  if (!d) return '';
  const c = d.commissions || {};
  const req = d.payout_request;
  return '<div class="card"><h3>Commission payout</h3>' + (req
    ? '<p class="muted">You asked for a payout of <b>' + money(req.amount_ghs) + '</b> · ' + fmtDate(req.created_at) + '. The super admin settles it from their portal — once paid, the money lands in your wallet balance on the site, ready to withdraw.</p>'
    : Number(c.pending_ghs || 0) > 0
      ? '<p class="muted">You have <b>' + money(c.pending_ghs) + '</b> waiting. Request a payout and the super admin will settle it into your wallet balance, ready to withdraw from the site Wallet.</p><button class="btn gold" data-request-payout>Request Payout</button>'
      : '<p class="muted">Nothing waiting right now. When users you invited deposit, your commission gathers here and you can request a payout.</p>') + '</div>';
}
// Daily earnings (Prince, 2026-11-07, his reference screenshot):
// today's commission on top, then what was earned each past day —
// the day rolls into history at midnight and the balance is never
// reset. Shared by the Dashboard referral centre and My Earnings.
function dayLabel(dateStr, todayStr) {
  if (dateStr === todayStr) return 'Today';
  const t = new Date(todayStr + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() - 1);
  if (dateStr === t.toISOString().slice(0, 10)) return 'Yesterday';
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function dailyEarningsHTML(d) {
  const days = (d && d.daily_earnings) || [];
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Accra' });
  const todayRow = days.find(x => x.date === todayStr);
  const rows = days.map(x =>
    '<div class="txrow"><div><b>' + dayLabel(x.date, todayStr) + '</b><div class="muted">' + x.deposits_n + (x.deposits_n === 1 ? ' deposit' : ' deposits') + '</div></div>' +
    '<div><b>+' + money(x.earned_ghs) + '</b></div></div>').join('');
  return '<div class="card"><h3>Daily earnings</h3>' +
    '<p class="muted">What you earned each day. Today\'s total rolls into history when the next day starts — your balance is never reset.</p>' +
    '<div class="card-row"><span>Today\'s commission</span><b>' + (todayRow ? '+' + money(todayRow.earned_ghs) + ' · ' + todayRow.deposits_n + (todayRow.deposits_n === 1 ? ' deposit' : ' deposits') + ' today' : '0 deposits today') + '</b></div>' +
    (rows || '<p class="empty">No earnings yet.</p>') + '</div>';
}
function referralCardHTML() {
  const d = state.myDash;
  if (!d) return '';
  const invited = (d.invited_users || []).map(u =>
    '<div class="txrow"><div><b>' + esc(u.phone) + '</b><div class="muted">' + esc(u.display_name || '') + ' · joined ' + fmtDate(u.created_at) + '</div></div>' +
    '<div>' + money(u.deposits_ghs) + ' deposited</div></div>').join('');
  let html = '<div class="card"><h3>Your referral link</h3>' +
    '<p class="muted">Share this link to refer players. Anyone who registers through it joins instantly (no approval needed) and is credited to you for commissions.</p>' +
    '<div class="manualbox"><div class="mannum" style="font-size:17px; letter-spacing:0">' + esc(siteLink(d.invite_path)) + '</div>' +
    '<button class="btn gold" data-copy="' + esc(siteLink(d.invite_path)) + '">Copy Link</button></div>' +
    '<div class="card-row"><span>Users referred</span><b>' + (d.invited_users || []).length + '</b></div>' +
    '<div class="card-row"><span>Commission earned</span><b>' + money((d.commissions || {}).earned_ghs || 0) + '</b></div>' +
    '<div class="card-row"><span>Pending payout</span><b>' + money((d.commissions || {}).pending_ghs || 0) + '</b></div>' +
    '<div class="card-row"><span>Referrals with a deposit</span><b>' + (d.referrals_with_deposit || 0) + '</b></div>' +
    '<p class="muted">You earn ' + (d.commission_pct || 0) + '% commission on every deposit from each referred user.</p></div>' +
    payoutCardHTML() +
    dailyEarningsHTML(d) +
    '<div class="card"><h3>Users you referred</h3>' + (invited || '<p class="empty">No referred users yet — share your link.</p>') + '</div>';
  if (superTools() && (d.admins || []).length) {
    const rows = d.admins.map(a =>
      '<div class="txrow"><div><b>' + esc(a.phone) + '</b><div class="muted">' + esc(a.role) + '</div></div>' +
      '<div>' + a.invited_count + ' referred · earned ' + money(a.earned) + ' · <b>pending ' + money(a.pending) + '</b>' + (a.payout_requested_ghs != null ? ' · <b style="color:var(--gold)">payout requested</b>' : '') + '</div></div>').join('');
    html += '<div class="card"><h3>Referrals by admin</h3>' + rows + '</div>';
  }
  return html;
}
function queueHTML(compact) {
  const rows = state.queue.map(q =>
    '<div class="txrow"><div><b>' + esc(q.kind) + ' · ' + esc(q.phone) + '</b>' +
    '<div class="muted">' + fmtDate(q.created_at) + ' · ' + esc(q.method || '') + (q.external_ref ? ' · Ref ' + esc(q.external_ref) : '') +
    (q.payout_meta ? '<br>Pay to: ' + esc(q.payout_meta.account_name || '') + ' · ' + esc(q.payout_meta.bank_name || '') + ' ' + esc(q.payout_meta.account_number || '') : '') + '</div></div>' +
    '<div>' + moneyC(q.amount_ghs, q.phone) + '</div>' +
    '<span>' + (q.has_proof ? '<button class="btn ghost sm" data-proof="' + q.id + '">Screenshot</button> ' : '') +
    // Withdrawals are decided by the super admin only (Prince's rule,
    // 2026-11-04) — everyone else sees the row but no action buttons.
    // The API enforces the same rule, so this is presentation only.
    ((q.kind === 'withdrawal' && !superTools())
      ? '<span class="muted">Super admin only</span>'
      : '<button class="btn gold sm" data-confirm="' + q.id + '">Confirm</button> ' +
        '<button class="btn ghost sm" data-reject="' + q.id + '">Reject</button>') + '</span></div>').join('');
  return '<div class="card"><h3>' + (superTools() ? 'Deposits &amp; withdrawals queue' : 'Deposits queue') + '</h3>' +
    (rows || '<p class="empty">Nothing waiting for review.</p>') + '</div>' +
    (compact ? '' : '<p class="muted">Confirming a deposit credits the player and counts it toward their withdrawal unlock. Rejecting a withdrawal refunds the held amount. Withdrawal decisions are super-admin only.</p>');
}
// "12:home, 45+2:away" -> [{minute: 12, side: 'home'}, {minute: 45, extra: 2, side: 'away'}]
function parseGoalsText(text) {
  return text.split(',').map(x => x.trim()).filter(Boolean).map(part => {
    const [minRaw, side] = part.split(':').map(y => (y || '').trim());
    const mm = /^(\d+)(?:\+(\d+))?$/.exec(minRaw) || [];
    return { minute: Number(mm[1] || NaN), extra: Number(mm[2] || 0), side: side === 'away' ? 'away' : 'home' };
  }).filter(g => g.minute >= 1 && g.minute <= 90);
}
function goalsTextOf(m) {
  return (Array.isArray(m.goal_events) ? m.goal_events : [])
    .map(g => g.minute + (g.extra ? '+' + g.extra : '') + ':' + (g.side === 'away' ? 'away' : 'home')).join(', ');
}
function isoLocal(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// Every game the super admin created himself (featured + manual),
// with its real live state, and an Edit button (Prince, 2026-11-05).
function createdGamesHTML() {
  const mine = state.createdMatches || [];
  if (!mine.length) return '<div class="card"><h3>Created by you</h3><p class="empty">No games created yet — use the forms below.</p></div>';
  const rows = mine.map(m => {
    const custom = String(m.external_ref || '').indexOf('custom:') === 0;
    const statusLine = m.status === 'live'
      ? '<b style="color:#e5484d">LIVE ' + esc(m.minute_label || (m.minute + "'")) + '</b> · ' + m.score_home + '-' + m.score_away
      : m.status === 'finished' ? 'Full time · ' + m.score_home + '-' + m.score_away
      : m.status === 'postponed' ? 'Postponed · stopped at ' + m.score_home + '-' + m.score_away
      : 'Kicks off ' + fmtDate(m.starts_at);
    return '<div class="txrow"><div><b>' + esc(m.home_team) + ' vs ' + esc(m.away_team) + '</b>' +
      '<div class="muted">' + (custom ? 'Featured' : 'Manual') + ' · ' + esc(m.league) + '</div>' +
      '<div>' + statusLine + '</div></div>' + chip(m.status) +
      '<span>' + (m.status !== 'finished' ? '<button class="btn gold sm" data-edit-match="' + m.id + '">' + (state.editingMatch === m.id ? 'Close' : 'Edit') + '</button> ' : '') +
      (m.status === 'upcoming' || m.status === 'live' ? '<button class="btn ghost sm" data-postpone-match="' + m.id + '">Postpone</button> ' : '') +
      '<button class="btn ghost sm" data-delete-match="' + m.id + '">Delete</button></span></div>' +
      (state.editingMatch === m.id ? editMatchFormHTML(m, custom) : '');
  }).join('');
  return '<div class="card"><h3>Created by you</h3>' + rows + '</div>';
}
function editMatchFormHTML(m, custom) {
  const kicked = m.status === 'live';
  const o = m.odds || {};
  emBookDirty = false;
  const book = custom && !kicked && Array.isArray(m.odds_full) ? m.odds_full : [];
  const bookHTML = book.length ? '<details style="margin:6px 0"><summary class="muted">All markets editor — set any market\'s prices (they win over the derived book)</summary>' +
    book.map(b => '<div style="margin:8px 0"><div class="muted">' + esc(b.name) + '</div><div class="oddsgrid">' +
      (b.values || []).map(v => '<label>' + esc(v.value) + ' <input type="number" step="0.01" min="1.01" max="1000" data-book="' + esc(b.name) + '" data-pick="' + esc(v.value) + '" value="' + v.odd + '"></label>').join('') +
      '</div></div>').join('') + '</details>' : '';
  return '<form id="editMatchForm" data-mid="' + m.id + '" class="stack" style="margin:10px 0">' +
    (m.status === 'postponed' ? '<p class="muted">This game is postponed. Set a new kickoff below to bring it back.</p>'
      : kicked ? '<p class="muted">This game has kicked off — kickoff, odds and the goal schedule are locked. Names, crests and stoppages can still change.</p>' : '') +
    '<label>League <input type="text" id="emLeague" value="' + esc(m.league) + '"></label>' +
    '<label>Home team <input type="text" id="emHome" value="' + esc(m.home_team) + '"></label>' +
    '<label>Away team <input type="text" id="emAway" value="' + esc(m.away_team) + '"></label>' +
    '<label>Kickoff <input type="datetime-local" id="emStart" value="' + isoLocal(m.starts_at) + '"' + (kicked ? ' disabled' : '') + '></label>' +
    (kicked ? '' : '<button class="btn sm" type="button" id="emStartNow">Start the match now</button>') +
    '<label class="checkrow"><input type="checkbox" id="emBetLock"' + (m.betting_locked ? ' checked' : '') + '> Lock betting on this game</label>' +
    (custom ? '<div class="oddsgrid">' +
      '<label>1 (home) <input type="number" step="0.01" min="1.01" id="em_o1" value="' + (o.o1 || '') + '"' + (kicked ? ' disabled' : '') + '></label>' +
      '<label>X (draw) <input type="number" step="0.01" min="1.01" id="em_ox" value="' + (o.ox || '') + '"' + (kicked ? ' disabled' : '') + '></label>' +
      '<label>2 (away) <input type="number" step="0.01" min="1.01" id="em_o2" value="' + (o.o2 || '') + '"' + (kicked ? ' disabled' : '') + '></label></div>' +
      '<label>Goal schedule <input type="text" id="emGoals" value="' + esc(goalsTextOf(m)) + '"' + (kicked ? ' disabled' : '') + '></label>' +
      '<div class="oddsgrid"><label>1st half stoppage (min) <input type="number" min="0" max="15" id="emHtStop" value="' + (m.ht_stoppage || 0) + '"></label>' +
      '<label>2nd half stoppage (min) <input type="number" min="0" max="15" id="emFtStop" value="' + (m.ft_stoppage || 0) + '"></label></div>' : '') +
    bookHTML +
    '<label>Home crest (flag) — image URL <input type="url" id="emHomeLogo" value="' + esc(m.home_logo || '') + '"></label>' +
    '<label>…or upload the home crest <input type="file" data-crest="home" accept="image/*"></label>' +
    '<label>Away crest (flag) — image URL <input type="url" id="emAwayLogo" value="' + esc(m.away_logo || '') + '"></label>' +
    '<label>…or upload the away crest <input type="file" data-crest="away" accept="image/*"></label>' +
    '<button class="btn gold big" type="submit">Save Changes</button></form>';
}
function matchesHTML() {
  // Creating matches is super-admin work (Prince, 2026-11-05 — the
  // create-match API already refuses regular admins): don't show
  // the form where it can only fail. Admins keep the match list and
  // its Go Live / Update Score / Settle actions.
  const form = !superTools() ? '' : '<div class="card"><h3>Add a match</h3><form id="matchForm" class="stack">' +
    '<label>League <input type="text" id="mfLeague" placeholder="England Premier League" required></label>' +
    '<label>Home team <input type="text" id="mfHome" required></label>' +
    '<label>Away team <input type="text" id="mfAway" required></label>' +
    '<label>Start time <input type="datetime-local" id="mfStart" required></label>' +
    '<div class="oddsgrid">' +
    [['1 (home)', 'o1'], ['X (draw)', 'ox'], ['2 (away)', 'o2'], ['1X', 'dc1x'], ['12', 'dc12'], ['X2', 'dcx2'], ['Over 0.5', 'over05'], ['Under 0.5', 'under05'], ['Over 1.5', 'over15'], ['Under 1.5', 'under15'], ['Over 2.5', 'over25'], ['Under 2.5', 'under25'], ['Over 3.5', 'over35'], ['Under 3.5', 'under35'], ['Over 4.5', 'over45'], ['Under 4.5', 'under45'], ['GG (both score)', 'gg'], ['NG', 'ng']]
      .map(([l, k]) => '<label>' + l + ' <input type="number" step="0.01" min="1.01" id="mf_' + k + '"></label>').join('') +
    '</div><button class="btn gold big" type="submit">Add Match</button></form></div>';
  const rows = state.matches.map(m =>
    '<div class="txrow"><div><b>' + esc(m.home_team) + ' vs ' + esc(m.away_team) + '</b>' +
    '<div class="muted">' + (m.external_ref && String(m.external_ref).indexOf('espn:') === 0 ? 'ESPN · ' : m.external_ref && String(m.external_ref).indexOf('custom:') === 0 ? 'Featured · ' : 'Manual · ') + esc(m.league) + ' · ' + fmtDate(m.starts_at) + ' · ' + m.score_home + '-' + m.score_away + (m.minute != null ? ' · ' + (m.minute_label || (m.minute + "'")) : '') + '</div></div>' +
    chip(m.status) +
    '<span>' +
    (m.status === 'upcoming' ? '<button class="btn gold sm" data-golive="' + m.id + '">Go Live</button> ' : '') +
    (m.status === 'live' ? '<button class="btn ghost sm" data-score="' + m.id + '">Update Score</button> ' : '') +
    (m.status !== 'finished' ? '<button class="btn ghost sm" data-settle="' + m.id + '">Settle</button>' : '') +
    '</span></div>').join('');
  return tabsHTML() + (superTools() ? createdGamesHTML() : '') + featuredFormHTML() + form + '<div class="card"><h3>Matches</h3>' + (rows || '<p class="empty">No matches yet.</p>') + '</div>';
}
function usersHTML() {
  const rows = state.users.map(u =>
    '<div class="txrow"><div><b>' + esc(u.phone) + '</b>' +
    '<div class="muted">' + esc(u.display_name || '') + ' · joined ' + fmtDate(u.created_at) + ' · ' + u.deposits_completed + ' deposits · ' + u.bets_count + ' bets' + (u.inviter_phone ? ' · invited by ' + esc(u.inviter_phone) : '') + '</div></div>' +
    '<div>' + money(u.balance_ghs) + '</div>' + chip(u.status) +
    '<span class="muted">' + esc(u.role) + '</span>' +
    '<span>' + (superTools() ? '<button class="btn ghost sm" data-bal-edit="' + u.id + '">Edit Balance</button> ' : '') +
    '<button class="btn ghost sm" data-block="' + u.id + '" data-to="' + (u.status === 'blocked' ? 'active' : 'blocked') + '">' + (u.status === 'blocked' ? 'Unblock' : 'Block') + '</button>' +
    (superTools() && u.id !== state.user.id
      ? ' <button class="btn ghost sm" data-role="' + u.id + '" data-as="admin">Make Admin</button>' +
        ' <button class="btn ghost sm" data-role="' + u.id + '" data-as="super_admin">Make Super</button>' +
        ' <button class="btn ghost sm" data-role="' + u.id + '" data-as="player">Make Player</button>' +
        ' <button class="btn ghost sm" data-del-user="' + u.id + '">Delete</button>'
      : '') + '</span></div>').join('');
  return tabsHTML() + '<div class="card"><h3>Users</h3>' + (rows || '<p class="empty">No users yet.</p>') + '</div>';
}
function earningsHTML() {
  const d = state.myDash;
  if (!d) return tabsHTML() + '<div class="card"><p class="muted">Loading your dashboard…</p></div>';
  const c = d.commissions || {};
  const stat = (l, v) => '<div class="stat"><div class="muted">' + l + '</div><div class="stat-v">' + v + '</div></div>';
  const invited = (d.invited_users || []).map(u =>
    '<div class="txrow"><div><b>' + esc(u.phone) + '</b><div class="muted">' + esc(u.display_name || '') + ' · joined ' + fmtDate(u.created_at) + '</div></div>' +
    '<div>' + money(u.deposits_ghs) + ' deposited</div></div>').join('');
  const recent = (d.recent || []).map(r =>
    '<div class="txrow"><div><b>' + money(r.amount_ghs) + '</b><div class="muted">' + r.pct + '% of ' + money(r.basis_ghs) + ' · from ' + esc(r.from_phone) + ' · ' + fmtDate(r.created_at) + '</div></div>' +
    (r.paid_at ? chip('completed') : chip('pending')) + '</div>').join('');
  return tabsHTML() +
    '<div class="card"><h3>Your invite link</h3>' +
    '<p class="muted">Share this link — every user who registers through it is attributed to you, and you earn the commission rate the super admin sets on their deposits.</p>' +
    '<div class="manualbox"><div class="mannum" style="font-size:17px; letter-spacing:0">' + esc(siteLink(d.invite_path)) + '</div>' +
    '<button class="btn gold" data-copy="' + esc(siteLink(d.invite_path)) + '">Copy Link</button></div></div>' +
    '<div class="stats">' + stat('Commission earned', money(c.earned_ghs)) + stat('Paid out', money(c.paid_ghs)) + stat('Pending payout', money(c.pending_ghs)) + stat('Users invited', (d.invited_users || []).length) + stat('Referrals with a deposit', d.referrals_with_deposit || 0) + '</div>' +
    payoutCardHTML() +
    dailyEarningsHTML(d) +
    '<div class="card"><h3>Users you invited</h3>' + (invited || '<p class="empty">No invited users yet — share your link.</p>') + '</div>' +
    '<div class="card"><h3>Recent commissions</h3>' + (recent || '<p class="empty">No commissions yet. They land here when an invited user\'s deposit is confirmed.</p>') + '</div>';
}
function controlHTML() {
  if (!superTools()) return tabsHTML() + '<div class="card"><p class="muted">Platform Control lives in the <a href="super-admin.html">Super Admin Portal</a>.</p></div>';
  const s = state.settings || {};
  const on = (v) => v === '1';
  const pending = state.users.filter(u => u.role === 'admin' && u.status === 'pending');
  const pendingRows = pending.map(u =>
    '<div class="txrow"><div><b>' + esc(u.phone) + '</b><div class="muted">' + esc(u.display_name || '') + ' · applied ' + fmtDate(u.created_at) + '</div></div>' +
    '<span><button class="btn gold sm" data-verify="' + u.id + '">Verify Admin</button> ' +
    '<button class="btn ghost sm" data-remove-admin="' + u.id + '">Remove</button></span></div>').join('');
  const commRows = ((state.myDash && state.myDash.admins) || []).map(a =>
    '<div class="txrow"><div><b>' + esc(a.phone) + '</b><div class="muted">' + esc(a.role) + ' · ' + a.invited_count + ' invited users</div></div>' +
    '<div>earned ' + money(a.earned) + ' · paid ' + money(a.paid) + ' · <b>pending ' + money(a.pending) + '</b>' +
    (a.payout_requested_ghs != null ? '<div><b style="color:var(--gold)">Payout requested ' + money(a.payout_requested_ghs) + '</b></div>' : '') + '</div>' +
    (a.pending > 0 ? '<span><button class="btn gold sm" data-payout="' + a.id + '">Pay Out</button></span>' : '') + '</div>').join('');
  const userOpts = state.users.map(u => '<option value="' + u.id + '">' + esc(u.phone) + ' (' + esc(u.role) + ')</option>').join('');
  const inviteRows = state.invites.map(i =>
    '<div class="txrow"><div><b>' + esc(i.kind) + ' invite</b><div class="muted">expires ' + fmtDate(i.expires_at) + '</div></div>' +
    '<button class="btn ghost sm" data-copy="' + esc(siteLink('/admin.html?admin_invite=' + i.token)) + '">Copy Link</button></div>').join('');
  return tabsHTML() +
    '<div class="card"><h3>Switches</h3>' +
    '<div class="txrow"><div><b>ShinobiPay gateway</b><div class="muted">Off = instant MoMo deposits stop; manual transfer keeps working.</div></div>' +
    '<button class="btn ' + (on(s.gateway_enabled) ? 'gold' : 'ghost') + ' sm" data-toggle="gateway">' + (on(s.gateway_enabled) ? 'ON' : 'OFF') + '</button></div>' +
    '<div class="txrow"><div><b>Payouts</b><div class="muted">Frozen = users cannot request withdrawals and the queue cannot confirm them.</div></div>' +
    '<button class="btn ' + (on(s.payouts_frozen) ? 'gold' : 'ghost') + ' sm" data-toggle="freeze">' + (on(s.payouts_frozen) ? 'FROZEN' : 'OPEN') + '</button></div></div>' +
    '<div class="card"><h3>Commission rates</h3><form id="ratesForm" class="stack">' +
    '<label>Referral commission % (of a referred user\'s deposits, paid to whoever invited them) <input type="number" id="rateAdmin" step="0.1" min="0" max="100" value="' + esc(s.admin_commission_pct || '0') + '"></label>' +
    '<label>User cashback % (of their own deposit, credited back instantly) <input type="number" id="rateUser" step="0.1" min="0" max="100" value="' + esc(s.user_cashback_pct || '0') + '"></label>' +
    '<label>Referral deposit bonus GHS (flat bonus a referred player gets on EVERY deposit; 0 = off) <input type="number" id="rateBonus" step="1" min="0" max="100000" value="' + esc(s.referral_deposit_bonus_ghs || '0') + '"></label>' +
    '<label>Referral deposit bonus NGN (same bonus for Nigerian players, in naira; 0 = off) <input type="number" id="rateBonusNgn" step="1" min="0" max="10000000" value="' + esc(s.referral_deposit_bonus_ngn === undefined ? '5000' : s.referral_deposit_bonus_ngn) + '"></label>' +
    '<label>Cashout margin % (the house keeps this much of a ticket\'s fair cashout value) <input type="number" id="rateCashout" step="0.1" min="0" max="50" value="' + esc(s.cashout_margin_pct || '10') + '"></label>' +
    '<button class="btn gold big" type="submit">Save Rates</button></form></div>' +
    '<div class="card"><h3>Give a bonus</h3><form id="bonusForm" class="stack">' +
    '<label>Who <select id="bonusScope"><option value="all">All active players</option><option value="one">One account</option></select></label>' +
    '<label>Account (for "One account") <select id="bonusUser">' + userOpts + '</select></label>' +
    '<label>Amount (GHS) <input type="number" id="bonusAmt" step="0.01" min="0.01" required></label>' +
    '<label>Note <input type="text" id="bonusNote" placeholder="e.g. Weekend bonus"></label>' +
    '<button class="btn gold big" type="submit">Send Bonus</button></form></div>' +
    '<div class="card"><h3>Admin invites</h3>' +
    '<p class="muted">A timed, one-time link. An <b>admin</b> link creates a pending admin you verify below. A <b>super admin</b> link creates an active super admin immediately — share those carefully.</p>' +
    (state.lastInvite ? '<div class="manualbox"><div class="mannum" style="font-size:14px; letter-spacing:0; word-break:break-all">' + esc(state.lastInvite) + '</div><button class="btn gold" data-copy="' + esc(state.lastInvite) + '">Copy Link</button></div>' : '') +
    '<form id="inviteForm" class="stack">' +
    '<label>Link type <select id="invKind"><option value="admin">Admin (needs verification)</option><option value="super_admin">Super admin (active at once)</option></select></label>' +
    '<label>Expires after (hours) <input type="number" id="invHours" value="48" min="1" max="168"></label>' +
    '<button class="btn gold big" type="submit">Generate Invite Link</button></form>' +
    (inviteRows ? '<h4>Outstanding links</h4>' + inviteRows : '') + '</div>' +
    '<div class="card"><h3>Pending admin verifications</h3>' + (pendingRows || '<p class="empty">No admins waiting for verification.</p>') + '</div>' +
    '<div class="card"><h3>Referral commissions</h3>' + (commRows || '<p class="empty">No referral earnings yet.</p>') + '</div>';
}
// Random fictional team names for the featured-match dice buttons
// (the server has the same bank for fully-blank submissions).
const TEAM_A = ['Accra', 'Tema', 'Kumasi', 'Osu', 'Spintex', 'Takoradi', 'Madina', 'Legon', 'Achimota', 'Dansoman', 'Kasoa', 'Ho', 'Tamale', 'Cape Coast', 'Sunyani', 'Koforidua', 'Nungua', 'Teshie', 'Ashaiman', 'Winneba'];
const TEAM_B = ['Falcons', 'Royals', 'Iron', 'City', 'Stars', 'Lions', 'Warriors', 'United', 'Rovers', 'Athletic', 'Giants', 'Eagles', 'Sharks', 'Kings', 'Pirates', 'Rangers'];
function randomTeamName(taken) {
  let n = '';
  do { n = TEAM_A[Math.floor(Math.random() * TEAM_A.length)] + ' ' + TEAM_B[Math.floor(Math.random() * TEAM_B.length)]; } while (n === taken);
  return n;
}
function toLocalInput(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function featuredFormHTML() {
  if (!superTools()) return '';
  return '<div class="card"><h3>Create a featured match (super admin)</h3>' +
    '<p class="muted">Type only what you care about — anything left blank is generated for you: random team names, auto odds from the favourite, and a goal schedule that matches the odds. Every game also gets the full market book (Correct Score, HT/FT, half markets, handicaps and more), priced automatically from the 1X2 odds. The game goes live by itself at kickoff and settles on the final scheduled score.</p>' +
    '<form id="featForm" class="stack">' +
    '<label>League <input type="text" id="ffLeague" placeholder="Oddaroa Featured"></label>' +
    '<label>Home team <input type="text" id="ffHome" placeholder="Leave blank for a random team"></label>' +
    '<label>Away team <input type="text" id="ffAway" placeholder="Leave blank for a random team"></label>' +
    '<div><button class="btn ghost sm" type="button" data-dice="ffHome">🎲 Home name</button> <button class="btn ghost sm" type="button" data-dice="ffAway">🎲 Away name</button></div>' +
    '<label>Who is favourite? <select id="ffFav"><option value="even">Even match</option><option value="home">Home — slight favourite</option><option value="home_strong">Home — strong favourite</option><option value="away">Away — slight favourite</option><option value="away_strong">Away — strong favourite</option></select></label>' +
    '<label>Kickoff <input type="datetime-local" id="ffStart"></label>' +
    '<div><button class="btn ghost sm" type="button" data-kick="15">In 15 min</button> <button class="btn ghost sm" type="button" data-kick="60">In 1 hour</button> <button class="btn ghost sm" type="button" data-kick="tonight">Tonight 7 PM</button></div>' +
    '<label class="checkrow"><input type="checkbox" id="ffStartNow"> Start the match now</label>' +
    '<label class="checkrow"><input type="checkbox" id="ffLockBet"> Lock betting — players can see the game but cannot bet on it</label>' +
    '<div class="oddsgrid">' +
    '<label>1 (home) <input type="number" step="0.01" min="1.01" id="ff_o1" placeholder="Auto"></label>' +
    '<label>X (draw) <input type="number" step="0.01" min="1.01" id="ff_ox" placeholder="Auto"></label>' +
    '<label>2 (away) <input type="number" step="0.01" min="1.01" id="ff_o2" placeholder="Auto"></label></div>' +
    '<div><span class="muted">Goal script (required) — <span id="ffScriptSummary"></span></span>' +
    '<div id="ffGoalList" style="margin-top:6px"></div>' +
    '<div><input type="text" id="ffMinute" placeholder="Minute — e.g. 12 or 45+2" style="max-width:200px"> ' +
    '<button class="btn ghost sm" type="button" data-goaladd="home">+ Home</button> ' +
    '<button class="btn ghost sm" type="button" data-goaladd="away">+ Away</button></div>' +
    '<label class="sm"><input type="checkbox" id="ffNoGoals"> No goals — this match ends 0-0</label>' +
    '<p class="muted">The goal script is COMPULSORY: the match runs exactly what you build here — nothing is ever generated. Tick "No goals" only when the match truly ends 0-0.</p></div>' +
    '<div class="oddsgrid">' +
    '<label>1st half stoppage (min) <input type="number" min="0" max="15" step="1" id="ffHtStop" value="0"></label>' +
    '<label>2nd half stoppage (min) <input type="number" min="0" max="15" step="1" id="ffFtStop" value="0"></label></div>' +
    '<p class="muted">The match goes live on its own at kickoff: 45 minutes, 15 minutes half time, 45 minutes, plus any stoppage time you add.</p>' +
    '<label>Home crest (flag) — image URL <input type="url" id="ffHomeLogo" placeholder="https://…"></label>' +
    '<label>…or upload the home crest <input type="file" id="ffHomeFlag" data-crest="home" accept="image/*"></label>' +
    '<label>Away crest (flag) — image URL <input type="url" id="ffAwayLogo" placeholder="https://…"></label>' +
    '<label>…or upload the away crest <input type="file" id="ffAwayFlag" data-crest="away" accept="image/*"></label>' +
    '<details class="bookedit"><summary>All markets — specify or randomize prices</summary>' +
    '<p class="muted">The full book (Correct Score, HT/FT, half markets, handicaps and more) is generated from the 1X2 odds when you save. Randomize to fill every price here first, then tweak any of them — your prices win over the generated ones.</p>' +
    '<button class="btn ghost" type="button" id="ffRandomize">🎲 Randomize all odds</button>' +
    '<div id="ffBook"></div></details>' +
    '<button class="btn gold big" type="submit">Create Featured Match</button></form></div>';
}
function supportHTML() {
  const rows = state.support.map(m =>
    '<div class="txrow"><div><b>' + esc(m.subject) + '</b>' +
    '<div class="muted">' + esc(m.phone || '') + ' · ' + fmtDate(m.created_at) + '</div>' +
    '<div>' + esc(m.body) + '</div></div>' + chip(m.status) +
    (m.status === 'open' ? '<span><button class="btn gold sm" data-answer="' + m.id + '">Mark Answered</button></span>' : '') + '</div>').join('');
  return tabsHTML() + '<div class="card"><h3>Support inbox</h3>' + (rows || '<p class="empty">No messages.</p>') + '</div>';
}
// The page an invited admin lands on: account creation that says
// plainly what is being created, instead of the player signup.
function inviteRegisterHTML() {
  return '<div class="profile"><h2>Create your admin account</h2>' +
    '<p class="modal-sub">You have been invited to join the Oddaroa admin team. Create your account below — it stays locked until the super admin verifies it, then you can log in here.</p>' +
    '<form id="adminInviteForm" class="stack">' +
    '<label>Full name <input type="text" id="invName" required></label>' +
    '<label>Phone number <input type="tel" id="invPhone" placeholder="05xxxxxxxx" required></label>' +
    '<label>Email <input type="email" id="invEmail" required></label>' +
    '<label>Password <input type="password" id="invPass" required></label>' +
    '<button class="btn gold big" type="submit">Create Admin Account</button></form>' +
    '<p class="modal-sub">Already have an admin account? <a href="admin.html">Go to login</a>.</p></div>';
}
function inviteDoneHTML() {
  return '<div class="profile"><h2>Account created</h2>' +
    '<p class="modal-sub">' + (state.inviteDone === 'active'
      ? 'Your account is active. Continue into the portal below.'
      : 'Your admin account is created and waiting for verification. The super admin will approve it from their portal — once approved, come back here and log in with your phone number and password.') + '</p>' +
    (state.inviteDone === 'active'
      ? '<button class="btn gold big" id="inviteContinue">Continue to the Portal</button>'
      : '<a class="btn gold big" href="admin.html" style="display:block;text-align:center">Back to Login</a>') + '</div>';
}
function render() {
  const head = $('#adminHead');
  if (!state.user) {
    head.innerHTML = '';
    root.innerHTML = state.inviteDone ? inviteDoneHTML() : state.invite ? inviteRegisterHTML() : loginHTML();
    const cont = $('#inviteContinue');
    if (cont) cont.addEventListener('click', () => { state.inviteDone = ''; loadAll(); });
    return;
  }
  head.innerHTML = '<span class="userchip">' + esc(state.user.phone || state.user.email || '') + '</span> ' +
    (isSuperPortal
      ? '<a class="btn ghost" href="admin.html">Admin Portal</a> '
      : (state.user.role === 'super_admin' ? '<a class="btn ghost" href="super-admin.html">Super Portal</a> ' : '')) +
    '<button class="btn ghost" id="adminLogout">Logout</button>';
  $('#adminLogout').addEventListener('click', () => {
    state.user = null; state.token = '';
    localStorage.removeItem('ps_admin_token');
    render();
  });
  // The Admin Portal has no Matches tab; a stale tab state (or a
  // hand-typed switch) lands on the Dashboard instead.
  if (state.tab === 'matches' && !isSuperPortal) state.tab = 'dashboard';
  root.innerHTML =
    state.tab === 'dashboard' ? dashboardHTML() :
    state.tab === 'queue' ? tabsHTML() + queueHTML(false) :
    state.tab === 'matches' ? matchesHTML() :
    state.tab === 'users' ? usersHTML() :
    state.tab === 'earnings' ? earningsHTML() :
    state.tab === 'control' ? controlHTML() : supportHTML();
  renderFfGoals();
  renderFfBook();
}
// ---- Payout SMS receipt (Prince, 2026-11-05, admins only) ---------
// Confirming a withdrawal plays an animated banner styled like a
// phone SMS. The device itself picks the costume (Prince: "add a
// mobile detector or OS detector to make it accurate"): iPhones get
// the light frosted iOS message look, Android phones get the white
// Material messages look, anything else the neutral dark card.
function smsPlatform() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'generic';
}
// The notification sound (Prince, 2026-11-05): a short two-note
// message chime synthesized live with Web Audio, so there is no
// audio file to ship. Best-effort only — a silent failure must
// never break the receipt.
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

// The success card (Prince, 2026-11-05 — modelled on the MoMo app's
// "Withdrawal successful" popup in the screenshot he sent): white
// card, green check, big green amount, Transactions / Done footer.
// Admin portals only; it appears together with the SMS banner the
// moment a withdrawal is confirmed.
function showPayoutSuccess(p) {
  if (document.querySelector('#paySuccess')) return;
  const el = document.createElement('div');
  el.className = 'pay-overlay';
  el.id = 'paySuccess';
  el.innerHTML = '<div class="pay-card">' +
    '<div class="pay-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>' +
    '<div class="pay-title">Withdrawal successful</div>' +
    '<p class="pay-sub">The withdrawal has been paid to ' + esc(p.phone || 'the player') + ' successfully.</p>' +
    '<div class="pay-amt">' + money(p.amount_ghs) + '</div>' +
    '<div class="pay-actions"><button type="button" data-pay-tx>Transactions</button><button type="button" data-pay-done>Done</button></div>' +
  '</div>';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  el.querySelector('[data-pay-done]').addEventListener('click', close);
  el.querySelector('[data-pay-tx]').addEventListener('click', () => { close(); state.tab = 'queue'; render(); loadAll(); });
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
}
async function loadAll() {
  try {
    const jobs = [
      api('/admin/stats'), api('/admin/queue'), api('/admin/matches'), api('/admin/users'), api('/admin/support'),
      api('/admin/settings').catch(() => null), api('/admin/my-dashboard').catch(() => null), api('/admin/worklog' + workQuery()).catch(() => null)
    ];
    if (superTools()) jobs.push(api('/admin/invite-admin').catch(() => null));
    if (superTools()) jobs.push(api('/admin/matches?created=1').catch(() => null));
    const [stats, queue, matches, users, support, settings, myDash, work, invites, created] = await Promise.all(jobs);
    state.stats = stats.stats; state.queue = queue.queue; state.matches = matches.matches;
    state.users = users.users; state.support = support.messages;
    if (settings) state.settings = settings.settings;
    if (myDash) state.myDash = myDash;
    if (work) state.work = work;
    if (invites) state.invites = invites.invites || [];
    if (created) state.createdMatches = created.matches || [];
  } catch (e) { toast(e.message); }
  render();
}

document.addEventListener('click', async e => {
  if (e.target.id === 'emStartNow') {
    const el = document.querySelector('#emStart');
    if (el) { const d = new Date(); d.setSeconds(0, 0); el.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
    return;
  }
  if (e.target.id === 'workTodayBtn') {
    state.workMode = 'day'; state.workDate = ''; loadWork(); return;
  }
  if (e.target.id === 'workRangeBtn') {
    const f = document.querySelector('#workFrom'), t = document.querySelector('#workTo');
    if (f && t && f.value && t.value) { state.workMode = 'range'; state.workFrom = f.value; state.workTo = t.value; loadWork(); }
    return;
  }
  if (e.target.id === 'espnSync') {
    const leagues = [...document.querySelectorAll('.espn-league:checked')].map(x => x.value);
    if (!leagues.length) { toast('Pick at least one league.'); return; }
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
      const data = await api('/admin/espn-sync', { method: 'POST', body: { leagues, days: 7 } });
      const el = $('#espnResult');
      if (el) el.textContent = 'Imported ' + data.imported + ' matches (' + data.with_odds + ' with ESPN odds).';
      toast('ESPN sync done: ' + data.imported + ' matches.');
      loadAll();
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Sync From ESPN'; }
    return;
  }
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    if (navigator.clipboard) navigator.clipboard.writeText(copyBtn.dataset.copy).catch(() => {});
    toast('Copied: ' + copyBtn.dataset.copy);
    return;
  }
  const diceBtn = e.target.closest('[data-dice]');
  if (diceBtn) {
    const input = $('#' + diceBtn.dataset.dice);
    const other = $('#' + (diceBtn.dataset.dice === 'ffHome' ? 'ffAway' : 'ffHome'));
    if (input) input.value = randomTeamName(other ? other.value : '');
    return;
  }
  const goalAdd = e.target.closest('[data-goaladd]');
  if (goalAdd) {
    const raw = ($('#ffMinute') || {}).value || '';
    const mm = /^(\d{1,3})(?:\+(\d{1,2}))?$/.exec(String(raw).trim());
    if (!mm) { toast('Type the minute first — e.g. 12 or 45+2.'); return; }
    const minute = Number(mm[1]);
    if (minute < 1 || minute > 120) { toast('Minute must be between 1 and 120.'); return; }
    const g = { minute, side: goalAdd.dataset.goaladd };
    if (mm[2] && (minute === 45 || minute === 90)) g.extra = Math.min(15, Number(mm[2]));
    ffGoals.push(g);
    ffGoals.sort((x, y) => (x.minute + (x.extra || 0)) - (y.minute + (y.extra || 0)));
    renderFfGoals();
    return;
  }
  const goalDel = e.target.closest('[data-goaldel]');
  if (goalDel) {
    ffGoals.splice(Number(goalDel.dataset.goaldel), 1);
    renderFfGoals();
    return;
  }
  if (e.target.id === 'ffRandomize') {
    const btn = e.target;
    btn.disabled = true;
    try {
      const o1 = Number($('#ff_o1').value), ox = Number($('#ff_ox').value), o2 = Number($('#ff_o2').value);
      const body = (o1 > 1 && ox > 1 && o2 > 1) ? { o1, ox, o2 } : { fav: $('#ffFav').value };
      const data = await api('/admin/odds-preview', { method: 'POST', body });
      $('#ff_o1').value = data.odds.o1;
      $('#ff_ox').value = data.odds.ox;
      $('#ff_o2').value = data.odds.o2;
      ffBook = data.odds_full;
      renderFfBook();
      toast('Full book randomized — ' + ffBook.length + ' markets. Tweak any price, then create.');
    } catch (err) { toast(err.message); }
    btn.disabled = false;
    return;
  }
  const kickBtn = e.target.closest('[data-kick]');
  if (kickBtn) {
    const el = $('#ffStart');
    if (el) {
      const d = new Date();
      if (kickBtn.dataset.kick === 'tonight') {
        d.setHours(19, 0, 0, 0);
        if (d <= new Date()) d.setDate(d.getDate() + 1);
      } else {
        d.setMinutes(d.getMinutes() + Number(kickBtn.dataset.kick));
      }
      el.value = toLocalInput(d);
    }
    return;
  }
  const proofBtn = e.target.closest('[data-proof]');
  if (proofBtn) {
    try {
      const d = await api('/admin/deposit-proof?id=' + encodeURIComponent(proofBtn.dataset.proof));
      showProof(d.proof_image);
    } catch (err) { toast(err.message); }
    return;
  }
  const toggleBtn = e.target.closest('[data-toggle]');
  if (toggleBtn) {
    const s = state.settings || {};
    try {
      const body = toggleBtn.dataset.toggle === 'gateway'
        ? { gateway_enabled: s.gateway_enabled !== '1' }
        : { payouts_frozen: s.payouts_frozen !== '1' };
      const data = await api('/admin/settings', { method: 'POST', body });
      state.settings = data.settings;
      toast('Settings saved.');
      render();
    } catch (err) { toast(err.message); }
    return;
  }
  const verifyBtn = e.target.closest('[data-verify]');
  if (verifyBtn) {
    try { await api('/admin/verify-admin', { method: 'POST', body: { id: verifyBtn.dataset.verify, action: 'verify' } }); toast('Admin verified.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const removeBtn = e.target.closest('[data-remove-admin]');
  if (removeBtn) {
    try { await api('/admin/verify-admin', { method: 'POST', body: { id: removeBtn.dataset.removeAdmin, action: 'remove' } }); toast('Admin removed.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const payoutBtn = e.target.closest('[data-payout]');
  if (payoutBtn) {
    try {
      const data = await api('/admin/payout', { method: 'POST', body: { earner_id: payoutBtn.dataset.payout } });
      toast('Paid out ' + money(data.paid_ghs) + ' (' + data.entries + ' entries).');
      loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
  const reqPayoutBtn = e.target.closest('[data-request-payout]');
  if (reqPayoutBtn) {
    try {
      const data = await api('/admin/payout-request', { method: 'POST', body: {} });
      toast(data.already ? 'Payout already requested — the super admin has it.' : 'Payout requested: ' + money(data.request.amount_ghs) + '.');
      loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
  const balBtn = e.target.closest('[data-bal-edit]');
  if (balBtn) {
    const u = state.users.find(x => x.id === balBtn.dataset.balEdit);
    const delta = prompt('Adjust balance for ' + (u ? u.phone : '') + ' (current ' + (u ? money(u.balance_ghs) : '') + '). Enter a signed amount, e.g. 50 or -20:');
    if (delta === null) return;
    const note = prompt('Reason for this adjustment (shown in their transactions):', 'Balance adjustment');
    if (note === null) return;
    try {
      const data = await api('/admin/balance-edit', { method: 'POST', body: { id: balBtn.dataset.balEdit, delta_ghs: Number(delta), note } });
      toast('New balance: ' + money(data.balance_ghs));
      loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
  const delBtn = e.target.closest('[data-del-user]');
  if (delBtn) {
    const u = state.users.find(x => x.id === delBtn.dataset.delUser);
    if (!confirm('Permanently delete ' + (u ? u.phone : 'this account') + ' and all its bets, deposits and history? This cannot be undone.')) return;
    try {
      const data = await api('/admin/delete-user', { method: 'POST', body: { id: delBtn.dataset.delUser } });
      toast('Deleted ' + data.deleted + '.');
      loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
  const roleBtn = e.target.closest('[data-role]');
  if (roleBtn) {
    try { await api('/admin/promote', { method: 'POST', body: { id: roleBtn.dataset.role, role: roleBtn.dataset.as } }); toast('Role updated.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const tab = e.target.closest('[data-atab]');
  if (tab) { state.tab = tab.dataset.atab; render(); return; }
  const confirmBtn = e.target.closest('[data-confirm]');
  if (confirmBtn) {
    const item = state.queue.find(q => q.id === confirmBtn.dataset.confirm);
    try {
      const data = await api('/admin/confirm', { method: 'POST', body: { id: confirmBtn.dataset.confirm } });
      // A confirmed withdrawal plays the animated SMS receipt
      // (admins only); deposits keep the plain toast.
      if (item && item.kind === 'withdrawal' && data.payout) { showPayoutSms(data.payout); showPayoutSuccess(data.payout); }
      else toast('Confirmed.');
      loadAll();
    }
    catch (err) { toast(err.message); }
    return;
  }
  const rejectBtn = e.target.closest('[data-reject]');
  if (rejectBtn) {
    try { await api('/admin/reject', { method: 'POST', body: { id: rejectBtn.dataset.reject } }); toast('Rejected.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const blockBtn = e.target.closest('[data-block]');
  if (blockBtn) {
    try { await api('/admin/block', { method: 'POST', body: { id: blockBtn.dataset.block, status: blockBtn.dataset.to } }); toast('User updated.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const answerBtn = e.target.closest('[data-answer]');
  if (answerBtn) {
    try { await api('/admin/support', { method: 'POST', body: { id: answerBtn.dataset.answer, status: 'answered' } }); toast('Marked answered.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const editMatchBtn = e.target.closest('[data-edit-match]');
  if (editMatchBtn) {
    state.editingMatch = state.editingMatch === editMatchBtn.dataset.editMatch ? '' : editMatchBtn.dataset.editMatch;
    render();
    return;
  }
  const postponeBtn = e.target.closest('[data-postpone-match]');
  if (postponeBtn) {
    if (!confirm('Postpone this game? It disappears from the site and no new bets can be placed on it. You can bring it back later by editing its kickoff.')) return;
    try { await api('/admin/edit-match', { method: 'POST', body: { id: postponeBtn.dataset.postponeMatch, action: 'postpone' } }); toast('Game postponed.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const deleteMatchBtn = e.target.closest('[data-delete-match]');
  if (deleteMatchBtn) {
    if (!confirm('Permanently delete this game? This cannot be undone.')) return;
    try { await api('/admin/edit-match', { method: 'POST', body: { id: deleteMatchBtn.dataset.deleteMatch, action: 'delete' } }); state.editingMatch = ''; toast('Game deleted.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const liveBtn = e.target.closest('[data-golive]');
  if (liveBtn) {
    try { await api('/admin/matches', { method: 'PATCH', body: { id: liveBtn.dataset.golive, status: 'live', minute: 0 } }); toast('Match is live.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const scoreBtn = e.target.closest('[data-score]');
  if (scoreBtn) {
    const m = state.matches.find(x => x.id === scoreBtn.dataset.score);
    const sh = prompt('Home score', m ? m.score_home : 0);
    if (sh === null) return;
    const sa = prompt('Away score', m ? m.score_away : 0);
    if (sa === null) return;
    const min = prompt('Minute', m && m.minute != null ? m.minute : 45);
    try {
      await api('/admin/matches', { method: 'PATCH', body: { id: m.id, score_home: Number(sh), score_away: Number(sa), minute: min === null ? undefined : Number(min) } });
      toast('Score updated.'); loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
  const settleBtn = e.target.closest('[data-settle]');
  if (settleBtn) {
    const m = state.matches.find(x => x.id === settleBtn.dataset.settle);
    const sh = prompt('FINAL home score for ' + (m ? m.home_team : ''), m ? m.score_home : 0);
    if (sh === null) return;
    const sa = prompt('FINAL away score for ' + (m ? m.away_team : ''), m ? m.score_away : 0);
    if (sa === null) return;
    try {
      const data = await api('/admin/settle', { method: 'POST', body: { match_id: m.id, score_home: Number(sh), score_away: Number(sa) } });
      toast('Settled: ' + data.selections_scored + ' selections, ' + data.bets_won + ' bets won, ' + data.bets_lost + ' lost.');
      loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
});

// Crest uploads for the match forms: the picked image is
// downscaled in the browser (max 256px) and held here until submit,
// so a phone photo never becomes a multi-MB database value.
const crestUploads = { home: '', away: '' };
let emBookDirty = false;
// Featured-form goal script + specified book (Prince, 2026-11-05,
// from the form he shared): goals are built with +Home/+Away
// buttons instead of typed syntax, and the market editor can
// randomize or hand-specify every price in the full book.
let ffGoals = [];
let ffBook = null;
function ffGoalLabel(g) { return g.minute + (g.extra ? '+' + g.extra : '') + '′ ' + (g.side === 'home' ? 'Home' : 'Away'); }
function renderFfGoals() {
  const list = $('#ffGoalList'), sum = $('#ffScriptSummary');
  if (!list || !sum) return;
  const h = ffGoals.filter(g => g.side === 'home').length, a = ffGoals.length - h;
  sum.textContent = ffGoals.length
    ? 'final score ' + h + '–' + a + ' · ' + ffGoals.length + (ffGoals.length === 1 ? ' goal' : ' goals') + ' — the match ends ' + h + '–' + a + '.'
    : 'final score 0–0. No goals; the match ends 0–0.';
  list.innerHTML = ffGoals.map((g, i) =>
    '<span class="goalchip">' + esc(ffGoalLabel(g)) + ' <button type="button" class="goalx" data-goaldel="' + i + '" aria-label="Remove goal">×</button></span>').join('');
}
function renderFfBook() {
  const box = $('#ffBook');
  if (!box) return;
  if (!ffBook) {
    box.innerHTML = '<p class="muted">No prices specified yet — the full book is generated from the 1X2 odds when you save. Press Randomize to fill every price here first.</p>';
    return;
  }
  box.innerHTML = ffBook.map(m =>
    '<div class="bookmkt"><h4>' + esc(m.name === 'Exact Score' ? 'Correct Score' : m.name) + '</h4><div class="oddsgrid">' +
    m.values.map(v => '<label>' + esc(v.value) + ' <input type="number" step="0.01" min="1.01" data-market="' + esc(m.name) + '" data-pick="' + esc(v.value) + '" value="' + v.odd + '"></label>').join('') +
    '</div></div>').join('');
}
function collectFfBook() {
  const byName = new Map();
  document.querySelectorAll('#ffBook input[data-market]').forEach(inp => {
    const odd = Math.round(Number(inp.value) * 100) / 100;
    if (!(odd > 1)) return;
    if (!byName.has(inp.dataset.market)) byName.set(inp.dataset.market, []);
    byName.get(inp.dataset.market).push({ value: inp.dataset.pick, odd });
  });
  return [...byName.entries()].filter(([, values]) => values.length >= 2).map(([name, values]) => ({ name, values }));
}
document.addEventListener('change', e => {
  if (e.target.id === 'workDate' && e.target.value) {
    state.workMode = 'day'; state.workDate = e.target.value; loadWork(); return;
  }
  if (e.target.id === 'workAdminSel') {
    state.workAdmin = e.target.value; render(); return;
  }
  if (e.target.dataset && e.target.dataset.book !== undefined) { emBookDirty = true; return; }
  const side = e.target.dataset ? e.target.dataset.crest : null;
  if (!side) return;
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 256 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    crestUploads[side] = c.toDataURL('image/png');
    URL.revokeObjectURL(img.src);
    toast((side === 'home' ? 'Home' : 'Away') + ' crest ready — it will upload with the match.');
  };
  img.onerror = () => toast('That image could not be read.');
  img.src = URL.createObjectURL(file);
});

document.addEventListener('submit', async e => {
  if (e.target.id === 'adminLogin') {
    e.preventDefault();
    try {
      const data = await api('/auth/login', { method: 'POST', body: { identifier: $('#adPhone').value.trim(), password: $('#adPass').value } });
      if (!portalAllows(data.user)) {
        toast(isSuperPortal
          ? 'That account is not a super admin account — use the Admin Portal instead.'
          : 'That account is not an admin account.');
        return;
      }
      state.token = data.token;
      localStorage.setItem('ps_admin_token', data.token);
      state.user = data.user;
      loadAll();
    } catch (err) { toast(err.message); render(); }
  } else if (e.target.id === 'adminInviteForm') {
    e.preventDefault();
    try {
      const data = await api('/auth/register', {
        method: 'POST',
        body: {
          display_name: $('#invName').value.trim(),
          phone: $('#invPhone').value.trim(),
          email: $('#invEmail').value.trim(),
          password: $('#invPass').value,
          admin_invite: state.invite
        }
      });
      state.invite = '';
      history.replaceState(null, '', location.pathname);
      if (data.pending) {
        state.inviteDone = 'pending';
        render();
      } else if (data.token) {
        // A super-admin invite activates at once: sign straight in.
        state.token = data.token;
        localStorage.setItem('ps_admin_token', data.token);
        state.user = data.user;
        state.inviteDone = 'active';
        render();
      }
    } catch (err) {
      toast(err.message);
      if (String(err.message).includes('invite')) { state.invite = ''; render(); }
    }
  } else if (e.target.id === 'editMatchForm') {
    e.preventDefault();
    const id = e.target.dataset.mid;
    const m = (state.createdMatches || []).find(x => x.id === id) || state.matches.find(x => x.id === id);
    const kicked = !m || m.status === 'live';
    const custom = !!m && String(m.external_ref || '').indexOf('custom:') === 0;
    const body = {
      id,
      league: $('#emLeague').value.trim(),
      home_team: $('#emHome').value.trim(),
      away_team: $('#emAway').value.trim(),
      home_logo: $('#emHomeLogo').value.trim() || crestUploads.home,
      away_logo: $('#emAwayLogo').value.trim() || crestUploads.away,
      betting_locked: !!($('#emBetLock') && $('#emBetLock').checked)
    };
    if (custom && !kicked && emBookDirty) {
      const byName = new Map();
      document.querySelectorAll('[data-book]').forEach(inp => {
        const odd = Number(inp.value);
        if (!(odd > 1)) return;
        if (!byName.has(inp.dataset.book)) byName.set(inp.dataset.book, []);
        byName.get(inp.dataset.book).push({ value: inp.dataset.pick, odd });
      });
      if (byName.size) body.odds_full = [...byName.entries()].map(([name, values]) => ({ name, values }));
    }
    if (custom) {
      body.ht_stoppage = Number($('#emHtStop').value) || 0;
      body.ft_stoppage = Number($('#emFtStop').value) || 0;
    }
    if (!kicked) {
      if ($('#emStart') && $('#emStart').value) body.starts_at = new Date($('#emStart').value).toISOString();
      if (custom && $('#emGoals') && $('#emGoals').value.trim()) body.goals = parseGoalsText($('#emGoals').value.trim());
      const o1 = Number(($('#em_o1') || {}).value), ox = Number(($('#em_ox') || {}).value), o2 = Number(($('#em_o2') || {}).value);
      if (o1 > 1 && ox > 1 && o2 > 1) { body.o1 = o1; body.ox = ox; body.o2 = o2; }
    }
    try {
      await api('/admin/edit-match', { method: 'POST', body });
      crestUploads.home = ''; crestUploads.away = '';
      state.editingMatch = '';
      toast('Game updated.');
      loadAll();
    } catch (err) { toast(err.message); }
  } else if (e.target.id === 'ratesForm') {
    e.preventDefault();
    try {
      const data = await api('/admin/settings', {
        method: 'POST',
        body: { admin_commission_pct: Number($('#rateAdmin').value), user_cashback_pct: Number($('#rateUser').value), referral_deposit_bonus_ghs: Number($('#rateBonus').value), referral_deposit_bonus_ngn: Number(($('#rateBonusNgn') || {}).value || 0), cashout_margin_pct: Number($('#rateCashout').value) }
      });
      state.settings = data.settings;
      toast('Rates saved.');
      render();
    } catch (err) { toast(err.message); }
  } else if (e.target.id === 'bonusForm') {
    e.preventDefault();
    const scope = $('#bonusScope').value;
    try {
      const data = await api('/admin/bonus', {
        method: 'POST',
        body: { scope, user_id: scope === 'one' ? $('#bonusUser').value : undefined, amount_ghs: Number($('#bonusAmt').value), note: $('#bonusNote').value.trim() || undefined }
      });
      toast('Bonus sent to ' + data.credited + ' account(s): ' + money(data.amount_ghs) + ' each.');
      loadAll();
    } catch (err) { toast(err.message); }
  } else if (e.target.id === 'inviteForm') {
    e.preventDefault();
    try {
      const data = await api('/admin/invite-admin', {
        method: 'POST',
        body: { kind: $('#invKind').value, hours: Number($('#invHours').value) || 48 }
      });
      state.lastInvite = siteLink(data.path);
      toast('Invite link generated — it expires ' + fmtDate(data.expires_at) + '.');
      loadAll();
    } catch (err) { toast(err.message); }
  } else if (e.target.id === 'featForm') {
    e.preventDefault();
    // Blank means AUTO on the server: names, odds (from the
    // favourite) and the goal schedule are generated there.
    const body = {
      league: $('#ffLeague').value.trim(), home_team: $('#ffHome').value.trim(), away_team: $('#ffAway').value.trim(),
      fav: $('#ffFav').value
    };
    if ($('#ffStartNow') && $('#ffStartNow').checked) body.starts_at = new Date().toISOString();
    else if ($('#ffStart').value) body.starts_at = new Date($('#ffStart').value).toISOString();
    const o1 = Number($('#ff_o1').value), ox = Number($('#ff_ox').value), o2 = Number($('#ff_o2').value);
    if (o1 > 1 && ox > 1 && o2 > 1) { body.o1 = o1; body.ox = ox; body.o2 = o2; }
    // Goals are COMPULSORY (Prince's order, 2026-11-05): the match
    // runs only the script built here; an empty script is allowed
    // solely as an explicitly ticked 0-0.
    if (!ffGoals.length && !($('#ffNoGoals') && $('#ffNoGoals').checked)) {
      toast('Goal script is compulsory — add the goals, or tick "No goals" for a 0-0 match.');
      return;
    }
    body.goals = ffGoals.map(g => ({ ...g }));
    body.betting_locked = !!($('#ffLockBet') && $('#ffLockBet').checked);
    const specBook = collectFfBook();
    if (specBook.length) body.odds_full = specBook;
    body.ht_stoppage = Number($('#ffHtStop').value) || 0;
    body.ft_stoppage = Number($('#ffFtStop').value) || 0;
    const homeLogo = $('#ffHomeLogo').value.trim() || crestUploads.home;
    const awayLogo = $('#ffAwayLogo').value.trim() || crestUploads.away;
    if (homeLogo) body.home_logo = homeLogo;
    if (awayLogo) body.away_logo = awayLogo;
    try {
      const data = await api('/admin/create-match', { method: 'POST', body });
      crestUploads.home = ''; crestUploads.away = '';
      ffGoals = []; ffBook = null;
      toast('Created: ' + data.match.home_team + ' vs ' + data.match.away_team + ' — it plays by the clock from kickoff.');
      loadAll();
    } catch (err) { toast(err.message); }
  } else if (e.target.id === 'matchForm') {
    e.preventDefault();
    const keys = ['o1', 'ox', 'o2', 'dc1x', 'dc12', 'dcx2', 'over05', 'under05', 'over15', 'under15', 'over25', 'under25', 'over35', 'under35', 'over45', 'under45', 'gg', 'ng'];
    const odds = {};
    keys.forEach(k => { const v = Number($('#mf_' + k).value); if (v > 1) odds[k] = v; });
    try {
      await api('/admin/matches', {
        method: 'POST',
        body: {
          league: $('#mfLeague').value.trim(), home_team: $('#mfHome').value.trim(),
          away_team: $('#mfAway').value.trim(),
          starts_at: new Date($('#mfStart').value).toISOString(), odds
        }
      });
      toast('Match added.');
      loadAll();
    } catch (err) { toast(err.message); }
  }
});

(async () => {
  render();
  if (state.token) {
    try {
      const data = await api('/auth/me');
      if (portalAllows(data.user)) { state.user = data.user; loadAll(); return; }
      // Valid admin-tier session, wrong portal for this account: keep the
      // token (it belongs to the other portal) and just show this login.
      if (data.user.role === 'admin' || data.user.role === 'super_admin') { render(); return; }
    } catch (e) { /* fall through to login */ }
    state.token = '';
    localStorage.removeItem('ps_admin_token');
    render();
  }
})();
