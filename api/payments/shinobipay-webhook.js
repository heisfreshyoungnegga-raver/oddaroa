// Exact route for POST /api/payments/shinobipay-webhook on Vercel.
// bodyParser stays OFF so the handler sees the raw bytes — the HMAC
// signature is computed over them and re-serialised JSON never matches.
const handler = require('../_handlers/payments/shinobipay-webhook');
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.verifySignature = handler.verifySignature;
