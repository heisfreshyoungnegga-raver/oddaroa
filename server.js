// Oddaroa on Railway (or any Node host): one tiny zero-dependency
// server that serves the static site AND mounts the same handlers the
// Vercel functions use, so both hosts run identical code (PrimeStake
// pattern). No framework, no build step: node server.js and done.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

const groupRouters = {
  auth: require('./api/auth/[action]'),
  admin: require('./api/admin/[action]'),
  tips: require('./api/tips/[action]')
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // Friendly 404 page for browser hits, plain for the rest.
      const nf = path.join(ROOT, '404.html');
      res.statusCode = 404;
      if (fs.existsSync(nf)) { res.setHeader('Content-Type', MIME['.html']); return fs.createReadStream(nf).pipe(res); }
      return res.end('not found');
    }
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'api' && parts[1] && groupRouters[parts[1]]) {
    req.query = Object.fromEntries(url.searchParams);
    if (parts[1] === 'tips' && parts.length === 2) req.query.action = 'list';
    return groupRouters[parts[1]](req, res);
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => console.log(`Oddaroa listening on ${PORT}`));
