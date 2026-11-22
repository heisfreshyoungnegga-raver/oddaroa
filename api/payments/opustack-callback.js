// OpusTack callback — the settlement signal for OpusTack hosted-checkout
// deposits (Prince, 2026-11-22 — the instant gateway for both GHS and
// NGN, replacing ShinobiPay / Flutterwave). One URL, two methods
// (per-payment callback_url):
//   POST: signed webhook (charge.success / charge.failed /
//         refund.processed, X-OpusTack-Signature = HMAC-SHA512 of the
//         raw body, keyed with the secret key for that mode).
//   GET:  browser landing after the customer leaves the hosted
//         checkout — verify server-side, then send them home with
//         ?opu_return=1&reference=… so the deposit page can resume
//         its status poll; the deposit-status poll settles the
//         wallet, never the redirect.
//
// Trust rules (mirroring the ShinobiPay webhook, adapted to OpusTack):
//  1. Verify the HMAC against the RAW request bytes before trusting
//     anything. Re-serialised JSON never matches.
//  2. Idempotent on a namespaced event id — the OpusTack payload has
//     no stable event id, so reference + paid_at is namespaced (never
//     reused raw).
//  3. On charge.success, RE-VERIFY with a GET to OpusTack and credit
//     only if it still says success and the amount, currency and
//     reference match the attempt. Credit happens exactly once, in one
//     statement, for exactly the requested amount (NGN converts to
//     cedis at fx_ngn_per_ghs — see settleOpusTackAttempt).
//  4. A transient failure is answered 500 so a retrying sender can
//     redeliver (idempotency dedupes); the deposit-status reconciler
//     heals it either way.
//  5. If the secret is not configured yet, answer 503 so nothing is
//     processed unverified.
const crypto = require('crypto');
const { sql, send, opustackConfig, opustackFetch, ensurePaymentTables, settleOpusTackAttempt } = require('../_lib');

// Vercel: keep the raw body stream intact for signature verification.
module.exports.config = { api: { bodyParser: false } };

function verifySignature(rawBody, header, secret) {
  const sig = String(header || '').trim();
  if (!sig || !secret) return false;
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const PLAYER_SITE = 'https://oddaroa.com/';

module.exports = async (req, res) => {
  // Browser landing: verify server-side (best effort), then send the
  // customer home with the return marker so the deposit page can
  // resume its status poll. Never credit from the redirect — the
  // deposit-status poll settles the wallet within one pass of the
  // customer landing.
  if (req.method === 'GET') {
    const reference = String((req.query && req.query.reference) || '');
    if (reference && opustackConfig().secretKey) {
      try { await opustackFetch(`/v1/transactions/verify/${encodeURIComponent(reference)}`); } catch (e) { /* the poll settles */ }
    }
    const landing = reference
      ? PLAYER_SITE + '?opu_return=1&reference=' + encodeURIComponent(reference)
      : PLAYER_SITE;
    res.statusCode = 302;
    res.setHeader('Location', landing);
    return res.end();
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const { secretKey } = opustackConfig();
  if (!process.env.DATABASE_URL || !secretKey) return send(res, 503, { error: 'webhook_not_configured' });
  let eventId = '';
  try {
    const raw = await readRawBody(req);
    if (!verifySignature(raw, req.headers['x-opustack-signature'], secretKey)) {
      return send(res, 401, { error: 'invalid_signature' });
    }
    const event = JSON.parse(raw || '{}');
    const data = (event.data && typeof event.data === 'object') ? event.data : event;
    await ensurePaymentTables();

    // Idempotency: a second delivery of the same event is a no-op.
    const reference = String(data.reference || event.reference || '');
    const paidAt = String(data.paid_at || event.paid_at || data.id || event.id || '');
    eventId = 'opustack:' + reference + ':' + paidAt;
    const seen = await sql(
      `insert into webhook_events (event_id) values ($1) on conflict (event_id) do nothing returning event_id`,
      [eventId]
    );
    if (!seen.length) return send(res, 200, { ok: true, duplicate: true });

    const rows = await sql(
      `select id, user_id, reference, intent_id, amount_ghs, amount_minor, currency, network, status, provider
       from payment_attempts where reference = $1`,
      [reference]
    );
    if (!rows.length || rows[0].provider !== 'opustack') return send(res, 200, { ok: true, unmatched: true });
    const attempt = rows[0];

    const type = String(event.event || event.type || '');
    const succeeded = type === 'charge.success' || (!type && data.status === 'success');
    if (succeeded) {
      // Re-verify and credit through the shared settler (exactly the
      // attempt's amount, exactly once).
      const result = await settleOpusTackAttempt(attempt);
      return send(res, 200, { ok: true, credited: result === 'credited', unverified: result === 'unverified' });
    }

    if (type === 'charge.failed' || (!type && data.status === 'failed')) {
      await sql(`update payment_attempts set status = 'failed' where id = $1 and status <> 'succeeded'`, [attempt.id]);
      return send(res, 200, { ok: true });
    }

    return send(res, 200, { ok: true, ignored: type || null });
  } catch (e) {
    if (!res.writableEnded) send(res, 500, { error: 'webhook_error' });
  }
};

// Exported for the local signature unit test only.
module.exports.verifySignature = verifySignature;
