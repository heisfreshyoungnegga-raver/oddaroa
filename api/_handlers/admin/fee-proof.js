const { sql, send, guard, requireSuperAdmin, ensureAdminTables } = require('../../_lib');

// Super admin only: view the latest fee proof a player submitted
// (verification or NTT) so the proof can be checked before approving
// it in the Users tab. GET /admin/fee-proof?user_id=<uuid>&kind=verification|activation
module.exports = guard(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireSuperAdmin(req, res);
  if (!auth) return;
  await ensureAdminTables();
  const userId = String((req.query && req.query.user_id) || '');
  const kind = String((req.query && req.query.kind) || '');
  if (!userId || (kind !== 'verification' && kind !== 'activation')) {
    return send(res, 400, { error: 'invalid_request' });
  }
  const rows = await sql(
    `select id, reference, kind, sender_name, proof_path, status, created_at
     from adapter_manual_fees where user_id = $1 and kind = $2
     order by created_at desc limit 1`,
    [userId, kind]
  );
  if (!rows.length) return send(res, 404, { error: 'no_fee_found' });
  const f = rows[0];
  send(res, 200, {
    id: f.id,
    reference: f.reference,
    kind: f.kind,
    sender_name: f.sender_name,
    proof_image: f.proof_path,
    status: f.status,
    created_at: f.created_at,
  });
});
