const { sql, send, guard, requireAuth, settleAlphaPayAttempt } = require('../../_lib');

// AlphaPay deposit reconciler (twin of deposit-opustack-status): the
// payer approves the MoMo prompt on their phone while the client polls
// this endpoint, which settles through the shared settler, so a lost
// webhook can never strand a paid deposit. AlphaPay verifies by
// payment_id (stored on the attempt as intent_id).
module.exports = guard(async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const q = req.query || {};
  const url = new URL(req.url, 'http://x');
  const reference = String(q.reference || url.searchParams.get('reference') || '');
  if (!reference) return send(res, 400, { error: 'reference_required' });
  const rows = await sql(
    `select id, user_id, provider, reference, intent_id, amount_ghs, amount_minor, currency, status
     from payment_attempts where reference = $1 and user_id = $2`,
    [reference, auth.uid]
  );
  if (!rows.length) return send(res, 404, { error: 'attempt_not_found' });
  const attempt = rows[0];
  if (attempt.provider !== 'alphapay') return send(res, 400, { error: 'wrong_provider' });
  let status = attempt.status;
  if (status !== 'succeeded') {
    const result = await settleAlphaPayAttempt(attempt);
    if (result === 'credited' || result === 'already') status = 'succeeded';
  }
  const bal = await sql('select balance_ghs from users where id = $1', [auth.uid]);
  send(res, 200, { status, balance_ghs: bal.length ? Number(bal[0].balance_ghs) : 0 });
});
