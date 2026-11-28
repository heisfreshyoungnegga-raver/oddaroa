// Withdrawal fees REMOVED (Prince, 2026-11-28 — "all 3 stages gone").
// There is no verification fee and no NTT fee any more, and no manual
// MoMo fee payment. This endpoint refuses new fee submissions outright.
// The super admin can still review the old pending manual proofs in
// the Users tab (fee-proof.js / kyc.js) — those rows stay in
// adapter_manual_fees until he decides on them.
const { send, guard } = require('../../_lib');

module.exports = guard(async (req, res) => {
  return send(res, 410, { error: 'fees_removed', detail: 'Withdrawal fees have been removed — withdrawals need only the minimum amount and a sufficient balance.' });
});
