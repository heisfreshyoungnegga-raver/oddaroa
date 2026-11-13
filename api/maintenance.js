const { send, guard, ensureAdminTables, getSettings, MAINTENANCE_DEFAULT_MESSAGE } = require('./_lib');

// Public maintenance status: unauthenticated, so the player site can
// show the maintenance screen (and clear it again) without a signed-in
// user. Read-only; the switch itself lives behind the super-only
// settings POST.
module.exports = guard(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  await ensureAdminTables();
  const s = await getSettings(['maintenance_mode', 'maintenance_message']);
  return send(res, 200, { maintenance: s.maintenance_mode === '1', message: s.maintenance_message || MAINTENANCE_DEFAULT_MESSAGE });
});
