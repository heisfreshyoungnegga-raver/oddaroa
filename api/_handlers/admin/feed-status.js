const { send, guard, requireSuperAdmin } = require('../../_lib');

// API-Football account status (Prince, 2026-11-10): how much of the
// daily request quota the sync has used, straight from API-Sports.
// The key never leaves the server — only the counts come back.
module.exports = guard(async (req, res) => {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return send(res, 200, { configured: false });
  try {
    const r = await fetch('https://v3.football.api-sports.io/status', { headers: { 'x-apisports-key': key } });
    const d = await r.json();
    const sub = (d && d.response && d.response.subscription) || {};
    const reqs = (d && d.response && d.response.requests) || {};
    return send(res, 200, {
      configured: true,
      plan: sub.plan || null,
      active: !!sub.active,
      ends: sub.end || null,
      used: typeof reqs.current === 'number' ? reqs.current : null,
      limit: typeof reqs.limit_day === 'number' ? reqs.limit_day : null
    });
  } catch (e) {
    return send(res, 200, { configured: true, error: 'status_unreachable' });
  }
});
