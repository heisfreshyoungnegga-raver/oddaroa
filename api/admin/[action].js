// Router for /api/admin/* — one Vercel function for the whole group.
const handlers = {
  stats: require('../_handlers/admin/stats'),
  tips: require('../_handlers/admin/tips'),
  users: require('../_handlers/admin/users'),
  block: require('../_handlers/admin/block'),
  vip: require('../_handlers/admin/vip'),
  promote: require('../_handlers/admin/promote'),
  invite: require('../_handlers/admin/invite'),
  settings: require('../_handlers/admin/settings'),
  'delete-user': require('../_handlers/admin/delete-user')
};
module.exports = (req, res) => {
  const action = (req.query && req.query.action) || String(req.url || '').split('?')[0].split('/').pop();
  const handler = handlers[action];
  if (!handler) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'not_found' })); }
  return handler(req, res);
};
