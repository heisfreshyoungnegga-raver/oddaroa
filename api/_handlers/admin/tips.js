// /api/admin/tips — admin tip manager (replaces the old localStorage demo).
// GET: all recent tips. POST {match, league?, market, pick, odd, tier?}: create.
// PATCH {id, result}: settle a tip (won/lost/void/pending). DELETE ?id=: remove.
const { sql, readBody, send, requireAdmin, guard } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAdmin(req, res); if (!auth) return;

  if (req.method === 'GET') {
    const tips = await sql('select * from tips order by play_date desc, created_at desc limit 200');
    return send(res, 200, { tips });
  }
  if (req.method === 'POST') {
    const b = await readBody(req);
    const tip = {
      match: String(b.match || '').trim(), league: String(b.league || '').trim() || null,
      market: String(b.market || '').trim(), pick: String(b.pick || '').trim(),
      odd: Number(b.odd), tier: b.tier === 'vip' ? 'vip' : 'free'
    };
    if (!tip.match || !tip.market || !tip.pick || !(tip.odd > 1)) return send(res, 400, { error: 'invalid_tip' });
    const rows = await sql(
      'insert into tips (match, league, market, pick, odd, tier, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *',
      [tip.match, tip.league, tip.market, tip.pick, tip.odd, tip.tier, auth.uid]
    );
    return send(res, 201, { tip: rows[0] });
  }
  if (req.method === 'PATCH') {
    const b = await readBody(req);
    if (!['pending', 'won', 'lost', 'void'].includes(b.result)) return send(res, 400, { error: 'invalid_result' });
    await sql('update tips set result = $1 where id = $2', [b.result, String(b.id || '')]);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'DELETE') {
    const id = (req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id');
    await sql('delete from tips where id = $1', [String(id || '')]);
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method_not_allowed' });
});
