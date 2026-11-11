const { sql, readBody, send, guard, requireAuth, ensureAdminTables, getSettings } = require('../../_lib');

// Manual-fee proofs for the withdrawal gates (Prince, 2026-11-11 —
// ported from ApexBet): Stage 2 verification fee (GHS 100, one-time)
// and Stage 3 NTT fee (GHS 500, per withdrawal). Both are paid by
// manual MoMo to the platform's configured number with a screenshot
// proof — they are NOT deposits (a fee paid as a deposit would just
// credit the player's own wallet). The proof is recorded in
// adapter_manual_fees as 'pending' for the super admin to approve in
// the Users tab; approval flips it to 'paid' and (for the
// verification fee) marks the user kyc_fee_paid.
//
// GET  /wallet/fee?kind=verification|activation&reference=<withdrawal id?>
//   -> { fee, manual: {network, number, name}, status }
// POST /wallet/fee { kind, reference?, sender_name, proof_image }
//   -> { ok: true, status: 'pending' }
module.exports = guard(async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  await ensureAdminTables();
  const kind = String((req.query && req.query.kind) || '');
  if (req.method === 'GET') {
    if (kind !== 'verification' && kind !== 'activation') {
      return send(res, 400, { error: 'invalid_kind' });
    }
    const reference = String((req.query && req.query.reference) || '');
    const gate = await getSettings(['verification_fee_ghs', 'ntt_enabled', 'ntt_fee_ghs']);
    const fee = kind === 'verification'
      ? (Number(gate.verification_fee_ghs) || 100)
      : (gate.ntt_enabled === '1' ? (Number(gate.ntt_fee_ghs) || 500) : 0);
    const rows = await sql(
      `select status from adapter_manual_fees
        where user_id = $1 and kind = $2 and ($3 = '' or reference = $3)
        order by created_at desc limit 1`,
      [auth.uid, kind, reference]
    );
    const manual = await sql("select key, value from operator_settings where key in ('manual_deposit_network', 'manual_deposit_number', 'manual_deposit_name')");
    const m = Object.fromEntries(manual.map(r => [r.key, r.value]));
    return send(res, 200, {
      fee,
      manual: { network: m.manual_deposit_network || '', number: m.manual_deposit_number || '', name: m.manual_deposit_name || '' },
      status: rows.length ? rows[0].status : 'none',
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = await readBody(req);
  const k = String(body.kind || '');
  if (k !== 'verification' && k !== 'activation') {
    return send(res, 400, { error: 'invalid_kind' });
  }
  const reference = body.reference ? String(body.reference) : null;
  const senderName = String(body.sender_name || '').trim().slice(0, 80);
  const proof = body.proof_image;
  if (typeof proof !== 'string' || !/^data:image\/(png|jpe?g|webp);base64,/.test(proof) || proof.length > 3800000) {
    return send(res, 400, { error: 'invalid_proof', detail: 'Attach a screenshot of the MoMo payment — a smaller image if it will not upload.' });
  }
  // One open proof per kind (+reference for activation): a re-submit
  // replaces the earlier pending one instead of stacking duplicates.
  await sql(
    `delete from adapter_manual_fees where user_id = $1 and kind = $2 and status = 'pending' and (($3::text is null and reference is null) or reference = $3)`,
    [auth.uid, k, reference]
  );
  const rows = await sql(
    `insert into adapter_manual_fees (user_id, reference, kind, sender_name, proof_path, status)
     values ($1, $2, $3, $4, $5, 'pending') returning id`,
    [auth.uid, reference, k, senderName || null, proof]
  );
  send(res, 201, { ok: true, status: 'pending', id: rows[0].id });
});
