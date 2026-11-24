// Router for /api/wallet/* — one Vercel function for the whole group.
const handlers = {
  index: require('../_handlers/wallet/index'),
  'deposit-manual': require('../_handlers/wallet/deposit-manual'),
  'deposit-momo': require('../_handlers/wallet/deposit-momo'),
  'deposit-status': require('../_handlers/wallet/deposit-status'),
  'deposit-otp': require('../_handlers/wallet/deposit-otp'),
  'deposit-flutterwave': require('../_handlers/wallet/deposit-flutterwave'),
  'deposit-flw-status': require('../_handlers/wallet/deposit-flw-status'),
  'deposit-opustack': require('../_handlers/wallet/deposit-opustack'),
  'deposit-opustack-status': require('../_handlers/wallet/deposit-opustack-status'),
  'deposit-alphapay': require('../_handlers/wallet/deposit-alphapay'),
  'deposit-alphapay-status': require('../_handlers/wallet/deposit-alphapay-status'),
  'deposit-alphapay-otp': require('../_handlers/wallet/deposit-alphapay-otp'),
  banks: require('../_handlers/wallet/banks'),
  'resolve-account': require('../_handlers/wallet/resolve-account'),
  withdraw: require('../_handlers/wallet/withdraw'),
  fee: require('../_handlers/wallet/fee'),
};
module.exports = (req, res) => {
  const action = (req.query && req.query.action) || String(req.url || '').split('?')[0].split('/').pop();
  const handler = handlers[action];
  if (!handler) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'not_found' })); }
  return handler(req, res);
};
