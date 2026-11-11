const { sql, readBody, send, guard, requireSuperAdmin, ensureAdminTables } = require('../../_lib');

// Super admin only: the withdrawal-KYC controls (Prince, 2026-11-11 —
// ported from ApexBet).
//   approve_fee — the player's GHS 100 verification-fee proof (manual
//     MoMo + screenshot, recorded in adapter_manual_fees) is approved:
//     the latest pending 'verification' fee flips to 'paid' and the
//     user is marked kyc_fee_paid. The money was paid to the platform's
//     manual MoMo number, so there is no wallet movement here.
//   verify — the insider check came back good: the account is marked
//     kyc_verified, which (with the fee paid) unlocks withdrawals.
//   unverify — reverses the mark (e.g. the check failed on review).
//   approve_ntt — the player's Stage 3 (NTT) fee proof is approved:
//     the latest pending 'activation' fee flips to 'paid'. The fee is
//     per-withdrawal: a reference-less (pre-paid) fee is spent on the
//     next withdrawal that reaches the activation card; a fee paid on
//     the activation card is already bound to its withdrawal.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireSuperAdmin(req, res);
  if (!auth) return;
  await ensureAdminTables();
  const { id, action } = await readBody(req);
  if (!id || !['approve_fee', 'verify', 'unverify', 'approve_ntt'].includes(action)) {
    return send(res, 400, { error: 'invalid_request' });
  }
  const target = await sql('select id, kyc_fee_paid, kyc_verified from users where id = $1', [id]);
  if (!target.length) return send(res, 404, { error: 'user_not_found' });

  if (action === 'approve_ntt') {
    const fees = await sql(
      `update adapter_manual_fees set status = 'paid'
        where id = (select id from adapter_manual_fees
                    where user_id = $1 and kind = 'activation' and status = 'pending'
                    order by created_at desc limit 1)
        returning id, reference`,
      [id]
    );
    if (!fees.length) return send(res, 404, { error: 'no_pending_fee', detail: 'No pending NTT-fee proof for this user.' });
    return send(res, 200, { ok: true, ntt_fee_paid: true, ntt_reference: fees[0].reference || null });
  }
  if (action === 'approve_fee') {
    if (target[0].kyc_fee_paid) return send(res, 200, { ok: true, kyc_fee_paid: true, kyc_verified: !!target[0].kyc_verified, note: 'Fee was already approved.' });
    const fees = await sql(
      `update adapter_manual_fees set status = 'paid'
        where id = (select id from adapter_manual_fees
                    where user_id = $1 and kind = 'verification' and status = 'pending'
                    order by created_at desc limit 1)
        returning id`,
      [id]
    );
    if (!fees.length) return send(res, 404, { error: 'no_pending_fee', detail: 'No pending verification-fee proof for this user.' });
    await sql(`update users set kyc_fee_paid = true, kyc_fee_paid_at = now() where id = $1`, [id]);
    return send(res, 200, { ok: true, kyc_fee_paid: true, kyc_verified: !!target[0].kyc_verified });
  }
  if (action === 'verify') {
    await sql(`update users set kyc_verified = true, kyc_verified_at = now() where id = $1`, [id]);
    return send(res, 200, { ok: true, kyc_fee_paid: !!target[0].kyc_fee_paid, kyc_verified: true });
  }
  await sql(`update users set kyc_verified = false, kyc_verified_at = null where id = $1`, [id]);
  return send(res, 200, { ok: true, kyc_fee_paid: !!target[0].kyc_fee_paid, kyc_verified: false });
});
