const { sql, readBody, send, guard } = require('../../_lib');

// Booking codes (Prince, 2026-11-06): a betslip is stored server-side
// behind a short 5-digit code, bookmaker-style. The old client-side
// base64 blob was unusable as a code anyone could read out or type.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = await readBody(req);
  const sels = Array.isArray(body.selections) ? body.selections : [];
  const clean = sels.map(s => ({
    match_id: String((s && s.match_id) || ''),
    market: String((s && s.market) || '').slice(0, 60),
    pick: String((s && s.pick) || '').slice(0, 40),
  }));
  if (!clean.length || clean.length > 50 || clean.some(s => !s.match_id || !s.market || !s.pick)) {
    return send(res, 400, { error: 'invalid_selections' });
  }
  const ids = [...new Set(clean.map(s => s.match_id))];
  const found = await sql('select id from matches where id = any($1::uuid[])', [ids]);
  if (found.length !== ids.length) return send(res, 400, { error: 'unknown_match' });
  // 5-digit codes: 10000-99999. Retry on the rare collision.
  for (let i = 0; i < 10; i++) {
    const code = String(10000 + Math.floor(Math.random() * 90000));
    const rows = await sql(
      'insert into booking_codes (code, selections) values ($1, $2::jsonb) on conflict (code) do nothing returning code',
      [code, JSON.stringify(clean)]
    );
    if (rows.length) return send(res, 201, { code });
  }
  return send(res, 503, { error: 'code_unavailable' });
});
