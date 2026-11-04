const crypto = require('crypto');
const { sql, readBody, send, guard, requireAuth } = require('../../_lib');
const G = require('../../_games');

// Start a game round. The stake debit and the round row are one
// statement; instant games are resolved and settled in the same
// request, Aviator and Shootout stay open for cash-out play.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  await G.ensureGameTables();
  const { game, stake_ghs, config } = await readBody(req);
  if (!G.GAME_NAMES[game]) return send(res, 400, { error: 'unknown_game' });
  const stake = Number(stake_ghs);
  if (!(stake >= G.MIN_STAKE && stake <= G.MAX_STAKE) || G.money2(stake) !== stake) {
    return send(res, 400, { error: 'invalid_stake', detail: 'Stake must be between GHS 1 and GHS 1,000.' });
  }
  const cfg = G.validateConfig(game, config);
  if (!cfg) return send(res, 400, { error: 'invalid_config' });
  const fast = await sql(
    "select count(*) as n from game_rounds where user_id = $1 and created_at > now() - interval '10 seconds'",
    [auth.uid]
  );
  if (Number(fast[0].n) > 30) return send(res, 429, { error: 'too_fast', detail: 'Slow down a moment, then play again.' });

  if (game === 'aviator') {
    const seed = crypto.randomBytes(32).toString('hex');
    const state = {
      seed, seed_hash: crypto.createHash('sha256').update(seed).digest('hex'),
      crash: G.crashFromSeed(seed), started_at: new Date().toISOString(),
      auto_cashout: cfg.auto_cashout, config: cfg,
    };
    const round = await G.openRound(auth.uid, game, stake, state);
    if (!round) return send(res, 400, { error: 'insufficient_balance' });
    return send(res, 201, { round: G.publicRound(round), balance: await G.balanceOf(auth.uid), server_now: Date.now() });
  }
  if (game === 'shootout') {
    const round = await G.openRound(auth.uid, game, stake, { kicks: 0, goals: 0, history: [], config: cfg });
    if (!round) return send(res, 400, { error: 'insufficient_balance' });
    return send(res, 201, { round: G.publicRound(round), balance: await G.balanceOf(auth.uid) });
  }
  // Instant games: resolve first, then debit + open + settle.
  const outcome = G.resolveInstant(game, cfg);
  let round = await G.openRound(auth.uid, game, stake, { config: cfg, result: outcome.result });
  if (!round) return send(res, 400, { error: 'insufficient_balance' });
  const payout = G.money2(stake * outcome.mult);
  round = await G.closeRound(round, payout > 0 ? 'won' : 'lost', payout, {});
  return send(res, 201, { round: G.publicRound(round), balance: await G.balanceOf(auth.uid) });
});
