const { sql, readBody, send, guard, requireAuth, alphapayConfig, alphapayFetch, settleAlphaPayAttempt, ensurePaymentTables } = require('../../_lib');

// Submit the OTP for an AlphaPay Softpay deposit whose operator asked
// for one. Server-side call with the secret key. The client holds the
// otp_reference from the initiate answer and sends it back with the
// code; the payment is keyed by payment_id (attempt intent_id).
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!alphapayConfig().secretKey) return send(res, 503, { error: 'provider_not_configured' });
  const { reference, otp, otp_reference } = await readBody(req);
  if (!reference || !otp) return send(res, 400, { error: 'otp_required' });
  await ensurePaymentTables();
  const rows = await sql(
    `select id, user_id, provider, reference, intent_id, amount_ghs, amount_minor, currency, status
     from payment_attempts where reference = $1 and user_id = $2`,
    [String(reference), auth.uid]
  );
  if (!rows.length || !rows[0].intent_id || rows[0].provider !== 'alphapay') return send(res, 404, { error: 'attempt_not_found' });
  const attempt = rows[0];
  let out;
  try {
    out = await alphapayFetch(`/payments/${encodeURIComponent(attempt.intent_id)}/confirm-otp/`, {
      method: 'POST',
      body: { otp: String(otp), otp_reference: String(otp_reference || '') }
    });
  } catch (e) {
    return send(res, 202, { status: 'unknown', detail: 'Could not confirm the code. If the payment completes, your wallet is credited automatically.' });
  }
  const d = out.data || {};
  const inner = (d.data && typeof d.data === 'object') ? d.data : {};
  const st = String((d.payment && d.payment.status) || inner.status || d.status || '').toUpperCase();
  if (out.status === 200 && st) {
    if (st === 'SUCCESS') {
      const result = await settleAlphaPayAttempt(attempt);
      return send(res, 200, { reference: String(reference), status: result === 'credited' || result === 'already' ? 'succeeded' : 'awaiting' });
    }
    if (st === 'FAILED' || st === 'CANCELLED') {
      await sql(`update payment_attempts set status = 'failed' where id = $1 and status <> 'succeeded'`, [attempt.id]);
      return send(res, 200, { reference: String(reference), status: 'failed' });
    }
    return send(res, 200, { reference: String(reference), status: 'awaiting' });
  }
  const code = (d.error && d.error.code) || (inner.error && inner.error.code) || d.code || inner.code || 'otp_failed';
  const detail = (d.error && d.error.message) || (inner.error && inner.error.message) || d.message || inner.message || 'That code was not accepted.';
  return send(res, out.status >= 400 && out.status < 500 ? out.status : 402, { error: code, detail });
});
