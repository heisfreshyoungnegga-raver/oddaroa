// Oddaroa on Railway (or any Node host): one tiny zero-dependency
// server that serves the static site AND mounts the same handlers the
// Vercel functions use, so both hosts run identical code.
// Ponytail note: no framework, no build step. node server.js and done.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

// API routes: exact files first, then the /api/<group>/<action> routers.
const exactRoutes = {
  '/api/matches': require('./api/matches'),
  // /api/match is the matches handler too: it delegates to the
  // single-match handler when an id query is present (the Vercel
  // side reaches it through the vercel.json rewrite).
  '/api/match': require('./api/matches'),
  '/api/support': require('./api/support'),
  '/api/maintenance': require('./api/maintenance'),
  '/api/tips': require('./api/_handlers/tips/list'),
  '/api/wallet': require('./api/_handlers/wallet/index'),
  '/api/payments/shinobipay-webhook': require('./api/payments/shinobipay-webhook'),
  '/api/payments/flutterwave-webhook': require('./api/payments/flutterwave-webhook'),
};
const groupRouters = {
  auth: require('./api/auth/[action]'),
  bets: require('./api/bets/[action]'),
  games: require('./api/games/[action]'),
  wallet: require('./api/wallet/[action]'),
  payments: require('./api/payments/[action]'),
  tips: require('./api/tips/[action]'),
  admin: require('./api/admin/[action]'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  // Map the URL onto the project folder, refusing anything outside it.
  let file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // The Vercel handlers read req.query; rebuild it from the URL.
  req.query = Object.fromEntries(url.searchParams);

  if (url.pathname.startsWith('/api/')) {
    const exact = exactRoutes[url.pathname];
    if (exact) return exact(req, res);
    const parts = url.pathname.split('/').filter(Boolean); // ['api','auth','login']
    const router = parts.length === 3 && groupRouters[parts[1]];
    if (router) { req.query.action = parts[2]; return router(req, res); }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'not_found' }));
  }
  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => console.log(`Oddaroa listening on ${PORT}`));
