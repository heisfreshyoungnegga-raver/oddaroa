// /api/admin/settings — operator settings (VIP prices, WhatsApp, toggles).
// GET: any admin. POST {key, value}: SUPER ADMIN ONLY (Platform Control).
const { sql, readBody, send, requireAdmin, requireSuperAdmin, guard } = require('../../_lib');

const KEYS = ['vip_price_weekly', 'vip_price_monthly', 'vip_whatsapp', 'tips_enabled', 'vip_enabled', 'site_notice'];

module.exports = guard(async (req, res) => {
  if (req.method === 'GET') {
    const auth = requireAdmin(req, res); if (!auth) return;
    const rows = await sql('select key, value from operator_settings order by key');
    return send(res, 200, { settings: Object.fromEntries(rows.map(r => [r.key, r.value])) });
  }
  if (req.method === 'POST') {
    const auth = requireSuperAdmin(req, res); if (!auth) return;
    const b = await readBody(req);
    if (!KEYS.includes(b.key)) return send(res, 400, { error: 'unknown_setting' });
    await sql(
      'insert into operator_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value',
      [b.key, String(b.value).slice(0, 300)]
    );
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method_not_allowed' });
});
