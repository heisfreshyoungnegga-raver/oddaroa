// Oddaroa API shared library — same pattern as PrimeStake: zero
// dependencies, Node built-ins plus Neon's HTTP SQL endpoint, so the
// same handlers run on Railway (via server.js) and as Vercel functions.
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

// One SQL statement against Neon over HTTPS. The connection string
// (which carries the DB password) goes only to the database host as a
// header, and is never logged.
async function sql(query, params = []) {
  const { databaseUrl } = config();
  const host = new URL(databaseUrl.replace(/^postgres(ql)?:\/\//, 'https://')).host;
  const res = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: { 'Neon-Connection-String': databaseUrl, 'Content-Type': 'application/json' },
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
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
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

// Config check + uniform error shape around every handler.
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
  return {
    id: u.id, phone: u.phone, display_name: u.display_name || null,
    role: u.role, status: u.status,
    vip: !!u.vip_until && new Date(u.vip_until) > new Date(),
    vip_until: u.vip_until || null,
    created_at: u.created_at
  };
}

// ---- ShinobiPay (direct MoMo push for VIP subscriptions) ------------
// Same integration pattern as PrimeStake. The secret key lives ONLY in
// server env (SHINOBIPAY_SECRET_KEY); the webhook signing secret is
// SHINOBIPAY_WEBHOOK_SECRET. Without them the payment endpoints answer
// 503 and the VIP page falls back to WhatsApp signup.
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
// means this is only a default the customer can override in the UI.
function detectNetwork(localPhone) {
  const p = String(localPhone || '').slice(0, 3);
  if (['024', '025', '053', '054', '055', '059'].includes(p)) return 'MTN';
  if (['020', '050'].includes(p)) return 'TELECEL';
  if (['026', '027', '056', '057'].includes(p)) return 'AIRTELTIGO';
  return null;
}

// Payment attempts + webhook idempotency tables. Created lazily so the
// integration self-installs on first use; backend/schema.sql carries
// the same definitions for the record. plan/plan_days record which VIP
// subscription a payment buys; the webhook grants exactly that.
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
        plan text,
        plan_days integer,
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

async function getSetting(key) {
  const rows = await sql('select value from operator_settings where key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

module.exports = { sql, hashPassword, verifyPassword, issueToken, verifyToken, readBody, send, requireAuth, requireAdmin, requireSuperAdmin, guard, publicUser, shinobiConfig, shinobiFetch, mapIntentStatus, detectNetwork, ensurePaymentTables, getSetting };
