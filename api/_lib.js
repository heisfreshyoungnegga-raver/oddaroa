// Oddaroa API shared library. Zero dependencies: Node built-ins plus
// Neon's HTTP SQL endpoint, so Vercel runs these functions as-is.
const crypto = require('crypto');

function config() {
  return {
    databaseUrl: process.env.DATABASE_URL || '',
    sessionSecret: process.env.SESSION_SECRET || ''
  };
}
function missingConfig() {
  const c = config();
  const missing = [];
  if (!c.databaseUrl) missing.push('DATABASE_URL');
  if (!c.sessionSecret) missing.push('SESSION_SECRET');
  return missing;
}

// Run one SQL statement against Neon over HTTPS. The connection string
// (which carries the DB password) is sent as a header to the database
// host only, and never logged.
async function sql(query, params = []) {
  const { databaseUrl } = config();
  const host = new URL(databaseUrl.replace(/^postgres(ql)?:\/\//, 'https://')).host;
  const res = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'Neon-Connection-String': databaseUrl,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, params })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `database error (${res.status})`);
    err.dbMessage = data.message || '';
    throw err;
  }
  return data.rows || [];
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

function signToken(payload) {
  const { sessionSecret } = config();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  const { sessionSecret } = config();
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}
function issueToken(user) {
  return signToken({ uid: user.id, role: user.role, exp: Date.now() + 7 * 24 * 3600 * 1000 });
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// Returns the session payload or sends 401 and returns null.
function requireAuth(req, res) {
  const header = req.headers.authorization || '';
  const payload = verifyToken(header.replace(/^Bearer\s+/i, ''));
  if (!payload) { send(res, 401, { error: 'not_logged_in' }); return null; }
  return payload;
}
function requireAdmin(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return null;
  if (payload.role !== 'admin' && payload.role !== 'super_admin') { send(res, 403, { error: 'admin_only' }); return null; }
  return payload;
}
function requireSuperAdmin(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return null;
  if (payload.role !== 'super_admin') { send(res, 403, { error: 'super_admin_only' }); return null; }
  return payload;
}

// Wrap a handler with the config check and a uniform error shape.
function guard(handler) {
  return async (req, res) => {
    const missing = missingConfig();
    if (missing.length) return send(res, 503, { error: 'backend_not_configured', missing });
    try {
      await handler(req, res);
    } catch (e) {
      if (!res.writableEnded) send(res, 500, { error: 'server_error', detail: String(e.dbMessage || e.message || e).slice(0, 300) });
    }
  };
}

function publicUser(u) {
  return { id: u.id, phone: u.phone, email: u.email || null, display_name: u.display_name, role: u.role, status: u.status, balance_ghs: Number(u.balance_ghs) };
}
function betCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return 'PB-' + code;
}

// Market catalogue shared by bet placement and settlement. Keys match
// the odds jsonb stored on each match row.
const MARKETS = {
  '1X2': { '1': 'o1', 'X': 'ox', '2': 'o2' },
  'Double Chance': { '12': 'dc12', '1X': 'dc1x', 'X2': 'dcx2' },
  // Over/Under markets are handled dynamically by line (see keyFor/pickWon).
  'Both Teams To Score': { 'Yes': 'gg', 'No': 'ng' }
};
// Map a (market, pick) pair to its key inside the match odds jsonb.
// Over/Under works for any half-goal line: 'Over/Under 1.5' + 'Over 1.5'
// resolves to 'over15'.
function fmtLine(x) { return (x > 0 ? '+' : '') + Number(x).toFixed(1); }
function keyFor(market, pick) {
  if (MARKETS[market]) return MARKETS[market][pick] || null;
  const ou = /^Over\/Under (\d+\.\d)$/.exec(market);
  if (ou) {
    const suffix = ou[1].replace('.', '');
    if (pick === 'Over ' + ou[1]) return 'over' + suffix;
    if (pick === 'Under ' + ou[1]) return 'under' + suffix;
  }
  // Handicap markets carry the home team's spread line in the name
  // ('Handicap +0.5'); picks are 'Home +0.5' / 'Away -0.5'.
  const hc = /^Handicap ([+-]?\d+\.\d)$/.exec(market);
  if (hc) {
    const line = parseFloat(hc[1]);
    if (pick === 'Home ' + fmtLine(line)) return 'sph';
    if (pick === 'Away ' + fmtLine(-line)) return 'spa';
  }
  return null;
}
function pickWon(market, pick, home, away) {
  const total = home + away;
  const ou = /^Over\/Under (\d+\.\d)$/.exec(market);
  if (ou) {
    const line = parseFloat(ou[1]);
    return pick === 'Over ' + ou[1] ? total > line : total < line;
  }
  const hc = /^Handicap ([+-]?\d+\.\d)$/.exec(market);
  if (hc) {
    const line = parseFloat(hc[1]);
    // The home pick applies the line to the home score; the away
    // pick carries the mirrored line. A level adjusted score (only
    // possible on whole lines) loses — ESPN soccer spreads are
    // half-goal lines, so this does not arise in practice.
    return pick.indexOf('Home ') === 0 ? (home + line) > away : (away - line) > home;
  }
  switch (market) {
    case '1X2': return pick === '1' ? home > away : pick === 'X' ? home === away : away > home;
    case 'Double Chance': return pick === '12' ? home !== away : pick === '1X' ? home >= away : away >= home;
    case 'Both Teams To Score': return pick === 'Yes' ? (home > 0 && away > 0) : (home === 0 || away === 0);
    default: return false;
  }
}

// Settlement for the API-Football full-book markets. Every market
// here is a pure function of the full-time score (H, A) and, for the
// half markets, the half-time score (hH, hA); second-half goals are
// the difference. Returns true/false, or null when the pick cannot
// be decided yet (a half market whose half-time score is unknown,
// or a pick format this evaluator does not recognise — those stay
// pending rather than being guessed at).
function afPickWon(market, pick, H, A, hH, hA) {
  const p = String(pick);
  const res = (h, a) => (h > a ? 'Home' : h < a ? 'Away' : 'Draw');
  const ou = (total, pk) => {
    const m = /^(Over|Under) ([\d.]+)$/.exec(pk);
    if (!m) return null;
    const line = parseFloat(m[2]);
    return m[1] === 'Over' ? total > line : total < line;
  };
  const exactGoals = (n, pk) => {
    if (/^\d+$/.test(pk)) return n === Number(pk);
    const more = /^more (\d+)$/.exec(pk) || /^(\d+)\+$/.exec(pk);
    if (more) return n >= Number(more[1]);
    return null;
  };
  const handicap = (h, a, pk) => {
    const m = /^(Home|Draw|Away) ([+-]?[\d.]+)$/.exec(pk);
    if (!m) return null;
    return res(h + parseFloat(m[2]), a) === m[1];
  };
  const needHt = [hH, hA].some(v => v === null || v === undefined);
  const H2 = needHt ? null : { h: H - hH, a: A - hA };
  switch (market) {
    case 'Match Winner': return res(H, A) === p;
    case 'Double Chance':
      return p === 'Home/Draw' ? H >= A : p === 'Home/Away' ? H !== A : p === 'Draw/Away' ? A >= H : null;
    case 'Both Teams Score': case 'Both Teams To Score':
      return p === 'Yes' ? (H > 0 && A > 0) : p === 'No' ? (H === 0 || A === 0) : null;
    case 'Goals Over/Under': return ou(H + A, p);
    case 'Clean Sheet - Home': return p === 'Yes' ? A === 0 : p === 'No' ? A > 0 : null;
    case 'Clean Sheet - Away': return p === 'Yes' ? H === 0 : p === 'No' ? H > 0 : null;
    case 'Handicap Result': return handicap(H, A, p);
    case 'Exact Score': {
      const m = /^(\d+):(\d+)$/.exec(p);
      return m ? (H === Number(m[1]) && A === Number(m[2])) : null;
    }
    case 'Total - Home': return ou(H, p);
    case 'Total - Away': return ou(A, p);
    case 'Win To Nil':
      return p === 'Home' ? (H > A && A === 0) : p === 'Away' ? (A > H && H === 0) : null;
    case 'Odd/Even': return p === 'Odd' ? (H + A) % 2 === 1 : p === 'Even' ? (H + A) % 2 === 0 : null;
    case 'Home Odd/Even': return p === 'Odd' ? H % 2 === 1 : p === 'Even' ? H % 2 === 0 : null;
    case 'Away Odd/Even': return p === 'Odd' ? A % 2 === 1 : p === 'Even' ? A % 2 === 0 : null;
    case 'Exact Goals Number': return exactGoals(H + A, p);
    case 'Home Team Exact Goals Number': return exactGoals(H, p);
    case 'Away Team Exact Goals Number': return exactGoals(A, p);
    case 'Winning Margin': {
      if (p === 'Score Draw') return H === A && H > 0;
      if (p === 'Draw') return H === 0 && A === 0;
      const m = /^([12]) by (\d+)(\+?)$/.exec(p);
      if (!m) return null;
      const margin = m[1] === '1' ? H - A : A - H;
      return m[3] === '+' ? margin >= Number(m[2]) : margin === Number(m[2]);
    }
    case 'Results/Both Teams Score': {
      const m = /^(Home|Draw|Away)\/(Yes|No)$/.exec(p);
      if (!m) return null;
      const btts = H > 0 && A > 0;
      return res(H, A) === m[1] && (m[2] === 'Yes' ? btts : !btts);
    }
    case 'Result/Total Goals': {
      const m = /^(Home|Draw|Away)\/(Over|Under) ([\d.]+)$/.exec(p);
      if (!m) return null;
      return res(H, A) === m[1] && ou(H + A, m[2] + ' ' + m[3]);
    }
    case 'Total Goals/Both Teams To Score': {
      const m = /^([ou])\/(yes|no) ([\d.]+)$/.exec(p);
      if (!m) return null;
      const over = H + A > parseFloat(m[3]);
      const btts = H > 0 && A > 0;
      return (m[1] === 'o' ? over : !over) && (m[2] === 'yes' ? btts : !btts);
    }
    case 'Number Of Goals In Match':
      return p === 'Under 2 goals' ? H + A <= 1
        : p === '2 or 3 goals' ? (H + A === 2 || H + A === 3)
        : p === 'Over 3 goals' ? H + A >= 4 : null;
  }
  // Half markets: undecidable until the half-time score is known.
  if (needHt) return null;
  const htTotal = hH + hA, shTotal = H2.h + H2.a;
  switch (market) {
    case 'First Half Winner': return res(hH, hA) === p;
    case 'Second Half Winner': return res(H2.h, H2.a) === p;
    case 'Goals Over/Under First Half': return ou(htTotal, p);
    case 'Goals Over/Under - Second Half': return ou(shTotal, p);
    case 'HT/FT Double': {
      const parts = p.split('/');
      return parts.length === 2 && res(hH, hA) === parts[0] && res(H, A) === parts[1];
    }
    case 'Handicap Result - First Half': return handicap(hH, hA, p);
    case 'Correct Score - First Half': {
      const m = /^(\d+):(\d+)$/.exec(p);
      return m ? (hH === Number(m[1]) && hA === Number(m[2])) : null;
    }
    case 'Double Chance - First Half':
      return p === 'Home/Draw' ? hH >= hA : p === 'Home/Away' ? hH !== hA : p === 'Draw/Away' ? hA >= hH : null;
    case 'Both Teams Score - First Half':
      return p === 'Yes' ? (hH > 0 && hA > 0) : p === 'No' ? (hH === 0 || hA === 0) : null;
    case 'Both Teams To Score - Second Half':
      return p === 'Yes' ? (H2.h > 0 && H2.a > 0) : p === 'No' ? (H2.h === 0 || H2.a === 0) : null;
    case 'Win Both Halves':
      return p === 'Home' ? (hH > hA && H2.h > H2.a) : p === 'Away' ? (hA > hH && H2.a > H2.h) : null;
    case 'To Win Either Half':
      return p === 'Home' ? (hH > hA || H2.h > H2.a) : p === 'Away' ? (hA > hH || H2.a > H2.h) : null;
    case 'To Score In Both Halves By Teams':
      return p === 'Home' ? (hH > 0 && H2.h > 0) : p === 'Away' ? (hA > 0 && H2.a > 0) : null;
    case 'Odd/Even - First Half': return p === 'Odd' ? htTotal % 2 === 1 : p === 'Even' ? htTotal % 2 === 0 : null;
    case 'Odd/Even - Second Half': return p === 'Odd' ? shTotal % 2 === 1 : p === 'Even' ? shTotal % 2 === 0 : null;
    case 'Exact Goals Number - First Half': return exactGoals(htTotal, p);
    case 'Second Half Exact Goals Number': return exactGoals(shTotal, p);
    case 'Highest Scoring Half':
      return p === '1st Half' ? htTotal > shTotal : p === '2nd Half' ? shTotal > htTotal : p === 'Draw' ? htTotal === shTotal : null;
    case 'Home Highest Scoring Half':
      return p === '1st Half' ? hH > H2.h : p === '2nd Half' ? H2.h > hH : p === 'Draw' ? hH === H2.h : null;
    case 'Away Highest Scoring Half':
      return p === '1st Half' ? hA > H2.a : p === '2nd Half' ? H2.a > hA : p === 'Draw' ? hA === H2.a : null;
    default: return null;
  }
}

// ---- ShinobiPay (direct MoMo push deposits) --------------------------
// The secret key lives ONLY in server env (SHINOBIPAY_SECRET_KEY); it is
// never sent to the browser and never logged. The webhook signing secret
// is SHINOBIPAY_WEBHOOK_SECRET. Without the key, deposit endpoints answer
// 503 provider_not_configured and the wallet falls back to manual transfer.
function shinobiConfig() {
  return {
    apiBase: (process.env.SHINOBIPAY_API_BASE || 'https://akwapayapi.onrender.com/v1').replace(/\/$/, ''),
    secretKey: process.env.SHINOBIPAY_SECRET_KEY || '',
    webhookSecret: process.env.SHINOBIPAY_WEBHOOK_SECRET || ''
  };
}

// One JSON call to the ShinobiPay API. Returns { status, data } and never
// throws on an HTTP error status (callers branch on it); it throws only
// when the network itself failed, which callers must treat as "unknown".
async function shinobiFetch(path, { method = 'GET', body, idempotencyKey } = {}) {
  const { apiBase, secretKey } = shinobiConfig();
  const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(apiBase + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ShinobiPay intent status -> our attempt status vocabulary.
function mapIntentStatus(s) {
  switch (s) {
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    case 'processing': return 'processing';
    case 'requires_action': return 'awaiting';
    case 'unknown': return 'unknown';
    default: return 'processing';
  }
}

// Guess the MoMo network from a local Ghana number's prefix. Portability
// means this is only a default: the customer confirms the network in the
// UI, and ShinobiPay warns on a mismatch rather than rerouting.
function detectNetwork(localPhone) {
  const p = String(localPhone || '').slice(0, 3);
  if (['024', '025', '053', '054', '055', '059'].includes(p)) return 'MTN';
  if (['020', '050'].includes(p)) return 'TELECEL';
  if (['026', '027', '056', '057'].includes(p)) return 'AIRTELTIGO';
  return null;
}

// Tables for payment attempts + webhook idempotency. Created lazily so
// the integration self-installs on first use (no console access needed);
// backend/schema.sql carries the same definitions for the record.
let tablesReady = null;
function ensurePaymentTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      await sql(`create table if not exists payment_attempts (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users (id),
        provider text not null default 'shinobipay',
        reference text not null unique,
        intent_id text,
        client_secret text,
        amount_ghs numeric(12, 2) not null,
        amount_minor integer not null,
        phone text,
        network text,
        status text not null default 'created',
        fail_reason text,
        last_sequence integer not null default 0,
        created_at timestamptz not null default now(),
        settled_at timestamptz
      )`);
      await sql(`create table if not exists webhook_events (
        event_id text primary key,
        received_at timestamptz not null default now()
      )`);
    })().catch(e => { tablesReady = null; throw e; });
  }
  return tablesReady;
}

// ---- Admin platform: invites, commissions, settings, custom matches --
// Lazy self-migration (same pattern as the payment tables): invite
// attribution columns on users, one-time admin invite tokens, the
// commission ledger, goal schedules on matches, and the operator
// settings the super-admin dashboard controls.
let adminTablesReady = null;
function ensureAdminTables() {
  if (!adminTablesReady) {
    adminTablesReady = (async () => {
      await sql(`alter table users add column if not exists invite_code text`);
      await sql(`create unique index if not exists users_invite_code_idx on users (invite_code) where invite_code is not null`);
      await sql(`alter table users add column if not exists invited_by uuid references users (id)`);
      // Widen the status check so invited admins can sit in 'pending'
      // until the super admin verifies them.
      await sql(`do $$ declare c text; begin
        select conname into c from pg_constraint
        where conrelid = 'users'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%';
        if c is not null then execute 'alter table users drop constraint ' || quote_ident(c); end if;
        alter table users add constraint users_status_check check (status in ('active', 'blocked', 'pending'));
      end $$`);
      await sql(`create table if not exists invites (
        id uuid primary key default gen_random_uuid(),
        token text not null unique,
        kind text not null default 'admin',
        created_by uuid references users (id),
        expires_at timestamptz not null,
        used_by uuid references users (id),
        used_at timestamptz,
        created_at timestamptz not null default now()
      )`);
      await sql(`create table if not exists commissions (
        id uuid primary key default gen_random_uuid(),
        earner_id uuid not null references users (id),
        source_user_id uuid not null references users (id),
        source_txn_id uuid references wallet_transactions (id),
        basis_ghs numeric(12, 2) not null,
        pct numeric(6, 2) not null,
        amount_ghs numeric(12, 2) not null,
        paid_at timestamptz,
        created_at timestamptz not null default now()
      )`);
      await sql(`create unique index if not exists commissions_source_idx on commissions (source_txn_id) where source_txn_id is not null`);
      await sql(`alter table matches add column if not exists goal_events jsonb not null default '[]'::jsonb`);
      await sql(`insert into operator_settings (key, value) values
        ('gateway_enabled', '1'), ('payouts_frozen', '0'),
        ('admin_commission_pct', '0'), ('user_cashback_pct', '0')
        on conflict (key) do nothing`);
    })().catch(e => { adminTablesReady = null; throw e; });
  }
  return adminTablesReady;
}

async function getSettings(keys) {
  const rows = await sql('select key, value from operator_settings where key = any($1::text[])', [keys]);
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
}

// Rewards that hang off a completed deposit, run once per deposit txn:
//  - user cashback: user_cashback_pct of the deposit, credited straight
//    back to the depositor's balance as an adjustment ledger row.
//  - referral commission: admin_commission_pct of the deposit, recorded
//    in the commission ledger for whoever invited the depositor — any
//    account can refer, players included — to be paid out later from
//    the super-admin dashboard.
// Idempotent per source txn, so a retried call can never double-pay.
async function applyDepositRewards(userId, txnId, amountGhs) {
  const amount = Number(amountGhs);
  if (!(amount > 0)) return;
  const s = await getSettings(['admin_commission_pct', 'user_cashback_pct']);
  const cashPct = Number(s.user_cashback_pct || 0);
  const commPct = Number(s.admin_commission_pct || 0);
  if (cashPct > 0) {
    const cash = Math.round(amount * cashPct) / 100;
    if (cash > 0) {
      const dupe = await sql('select id from wallet_transactions where external_ref = $1', ['cashback:' + txnId]);
      if (!dupe.length) {
        await sql(
          `with ins as (
             insert into wallet_transactions (user_id, kind, method, amount_ghs, status, external_ref, note)
             values ($1, 'adjustment', 'Deposit cashback', $2, 'completed', $3, $4) returning id
           )
           update users set balance_ghs = balance_ghs + $2 where id = $1`,
          [userId, cash, 'cashback:' + txnId, cashPct + '% cashback on deposit']
        );
      }
    }
  }
  if (commPct > 0) {
    const inv = await sql(
      `select i.id from users u join users i on i.id = u.invited_by
       where u.id = $1 and i.status = 'active' and i.role in ('admin', 'super_admin')`,
      [userId]
    );
    if (inv.length) {
      const earn = Math.round(amount * commPct) / 100;
      if (earn > 0) {
        await sql(
          `insert into commissions (earner_id, source_user_id, source_txn_id, basis_ghs, pct, amount_ghs)
           values ($1, $2, $3, $4, $5, $6) on conflict (source_txn_id) where source_txn_id is not null do nothing`,
          [inv[0].id, userId, txnId, amount, commPct, earn]
        );
      }
    }
  }
}

// A super-admin "featured" match carries a goal schedule. Its displayed
// state is derived from the clock: before kickoff it is upcoming; from
// kickoff the minute counts up and each scheduled goal lands at its
// minute; at 95 minutes it is finished with the full scheduled score.
function isCustomMatch(m) {
  return m && typeof m.external_ref === 'string' && m.external_ref.startsWith('custom:');
}
function customMatchState(m, now = new Date()) {
  const goals = Array.isArray(m.goal_events) ? m.goal_events : [];
  const finH = goals.filter(g => g.side === 'home').length;
  const finA = goals.filter(g => g.side === 'away').length;
  if (m.status === 'finished') return { status: 'finished', minute: null, score_home: m.score_home, score_away: m.score_away, final_home: m.score_home, final_away: m.score_away };
  const elapsed = Math.floor((now - new Date(m.starts_at)) / 60000);
  if (elapsed < 0) return { status: 'upcoming', minute: null, score_home: 0, score_away: 0, final_home: finH, final_away: finA };
  if (elapsed >= 95) return { status: 'finished', minute: null, score_home: finH, score_away: finA, final_home: finH, final_away: finA };
  const shown = goals.filter(g => Number(g.minute) <= elapsed);
  return {
    status: 'live', minute: Math.min(elapsed, 90),
    score_home: shown.filter(g => g.side === 'home').length,
    score_away: shown.filter(g => g.side === 'away').length,
    final_home: finH, final_away: finA
  };
}

// Build a full odds book from a 1X2 line for a custom match: Double
// Chance from the 1X2 prices (same maths as the ESPN sync), the
// Over/Under ladder and BTTS from a Poisson goal model whose total is
// split between the teams by their implied win strengths.
function poissonCdf(k, mu) {
  let term = Math.exp(-mu), sum = term;
  for (let i = 1; i <= k; i++) { term *= mu / i; sum += term; }
  return sum;
}
function expandOdds(o1, ox, o2) {
  const odds = {};
  if (!(o1 > 1 && ox > 1 && o2 > 1)) return odds;
  odds.o1 = o1; odds.ox = ox; odds.o2 = o2;
  odds.dc1x = Math.round((o1 * ox) / (o1 + ox) * 100) / 100;
  odds.dc12 = Math.round((o1 * o2) / (o1 + o2) * 100) / 100;
  odds.dcx2 = Math.round((ox * o2) / (ox + o2) * 100) / 100;
  const raw = [1 / o1, 1 / ox, 1 / o2];
  const margin = raw[0] + raw[1] + raw[2];
  const pH = raw[0] / margin, pA = raw[2] / margin;
  const mu = 2.7;
  const muH = mu * (pH / (pH + pA || 1)) || mu / 2;
  const muA = Math.max(mu - muH, 0.15);
  const pHomeScores = 1 - Math.exp(-muH), pAwayScores = 1 - Math.exp(-muA);
  const fair = (p) => (p > 0.02 && p < 0.98) ? Math.round((1 / p) / (margin > 1 ? 1.05 : 1) * 100) / 100 : null;
  [0.5, 1.5, 2.5, 3.5, 4.5].forEach(line => {
    const suffix = String(line).replace('.', '');
    const pOver = 1 - poissonCdf(Math.floor(line), mu);
    const o = fair(pOver), u = fair(1 - pOver);
    if (o && o > 1.01) odds['over' + suffix] = o;
    if (u && u > 1.01) odds['under' + suffix] = u;
  });
  const gg = fair(pHomeScores * pAwayScores);
  const ng = fair(1 - pHomeScores * pAwayScores);
  if (gg && gg > 1.01) odds.gg = gg;
  if (ng && ng > 1.01) odds.ng = ng;
  Object.keys(odds).forEach(k => { if (!(odds[k] > 1)) delete odds[k]; });
  return odds;
}

// Complete a partial odds book from its 1X2 line: any key the book
// lacks (totals lines ESPN did not publish, BTTS it never carries)
// is priced by expandOdds; keys already present are never touched.
// Deterministic — the match list, the details page and bet
// placement all see the same completed book.
function fillOdds(odds) {
  if (!odds || !(odds.o1 > 1 && odds.ox > 1 && odds.o2 > 1)) return odds || {};
  return { ...expandOdds(odds.o1, odds.ox, odds.o2), ...odds };
}

function inviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'OD';
  const buf = require('crypto').randomBytes(8);
  for (let i = 0; i < 8; i++) code += chars[buf[i] % chars.length];
  return code;
}

// Every account — player, admin or super admin — owns one permanent
// referral code. Mint it lazily on first use and return it.
async function ensureInviteCode(userId) {
  const rows = await sql('select invite_code from users where id = $1', [userId]);
  if (!rows.length) return null;
  if (rows[0].invite_code) return rows[0].invite_code;
  for (let i = 0; i < 5; i++) {
    const upd = await sql('update users set invite_code = $2 where id = $1 and invite_code is null returning invite_code', [userId, inviteCode()]);
    if (upd.length) return upd[0].invite_code;
    const again = await sql('select invite_code from users where id = $1', [userId]);
    if (again.length && again[0].invite_code) return again[0].invite_code;
  }
  return null;
}

// Settle one MoMo deposit attempt (settlement safety net, 2026-11-04):
// re-verify the intent with ShinobiPay and, only if it truly succeeded
// for exactly the attempt's amount and reference, credit the wallet
// exactly once — attempt flip, ledger deposit row and balance move in
// a single statement, and the status guard makes a second call a
// no-op. Shared by the webhook (primary) and the deposit-status poll
// (reconciler), so a lost or unverifiable webhook can never strand a
// paid deposit at "awaiting" forever — the player's own waiting
// screen heals it. `attempt` needs id, user_id, reference, intent_id,
// amount_ghs, amount_minor, network, status.
// Returns 'credited' | 'already' | 'unverified' | 'not_succeeded'.
async function settleAttempt(attempt) {
  if (attempt.status === 'succeeded') return 'already';
  if (!attempt.intent_id) return 'not_succeeded';
  const got = await shinobiFetch(`/payment_intents/${encodeURIComponent(attempt.intent_id)}`);
  const intent = got.data || {};
  if (got.status !== 200 || intent.status !== 'succeeded') return 'not_succeeded';
  const verified = Number(intent.merchant_amount) === Number(attempt.amount_minor)
    && (!intent.reference || intent.reference === attempt.reference);
  if (!verified) {
    // Leave the status untouched but record why, so support can see
    // the mismatch instead of a silent strand.
    try {
      await sql(
        `update payment_attempts set fail_reason = $2 where id = $1 and status <> 'succeeded'`,
        [attempt.id, `verify_mismatch merchant_amount=${intent.merchant_amount} amount_minor=${attempt.amount_minor} ref=${intent.reference || ''}`]
      );
    } catch (e) { /* diagnostics only */ }
    return 'unverified';
  }
  const out = await sql(
    `with a as (
       update payment_attempts set status = 'succeeded', settled_at = now()
       where id = $1 and status <> 'succeeded'
       returning user_id, amount_ghs, network, intent_id
     ),
     ins as (
       insert into wallet_transactions (user_id, kind, method, amount_ghs, status, external_ref, note)
       select user_id, 'deposit', network || ' MoMo (ShinobiPay)', amount_ghs, 'completed', intent_id, 'ShinobiPay direct push deposit'
       from a returning id
     ),
     cred as (
       update users set balance_ghs = balance_ghs + (select amount_ghs from a)
       where id = (select user_id from a) returning id
     )
     select (select count(*) from a) as settled, (select id from ins) as txn_id`,
    [attempt.id]
  );
  if (Number(out[0].settled) === 1 && out[0].txn_id) {
    await ensureAdminTables();
    await applyDepositRewards(attempt.user_id, out[0].txn_id, Number(attempt.amount_ghs));
    return 'credited';
  }
  return 'already';
}

module.exports = { sql, hashPassword, verifyPassword, verifyToken, issueToken, readBody, send, requireAuth, requireAdmin, requireSuperAdmin, guard, publicUser, betCode, MARKETS, keyFor, pickWon, afPickWon, shinobiConfig, shinobiFetch, mapIntentStatus, detectNetwork, ensurePaymentTables, ensureAdminTables, getSettings, applyDepositRewards, settleAttempt, isCustomMatch, customMatchState, expandOdds, fillOdds, inviteCode, ensureInviteCode };
