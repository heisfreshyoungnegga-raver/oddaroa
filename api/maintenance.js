const { send, guard, ensureAdminTables, getSettings, MAINTENANCE_DEFAULT_MESSAGE } = require('./_lib');

// Public maintenance status: unauthenticated, so the player site can
// show the maintenance screen (and clear it again) without a signed-in
// user. Read-only; the switch itself lives behind the super-only
// settings POST.
module.exports = guard(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  // Live status must never be served stale: browsers and edges cached
  // the OFF answer and kept showing it after the switch flipped ON
  // (Prince, 2026-11-13 — the notice appeared on load, then vanished).
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  await ensureAdminTables();
  const s = await getSettings(['maintenance_mode', 'maintenance_message']);
  return send(res, 200, { maintenance: s.maintenance_mode === '1', message: s.maintenance_message || MAINTENANCE_DEFAULT_MESSAGE });
});
