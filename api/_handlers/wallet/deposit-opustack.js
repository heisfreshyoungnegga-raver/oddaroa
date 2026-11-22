const crypto = require('crypto');
const { sql, readBody, send, guard, requireAuth, opustackConfig, opustackFetch, detectNetwork, ensurePaymentTables, ensureAdminTables, getSettings, currencyOfPhone, moneyRules, depositFloorFor, maintenanceBlocked } = require('../../_lib');

// Instant deposit (OpusTack hosted checkout, Prince 2026-11-22) —
// the instant gateway for BOTH currencies, replacing ShinobiPay for
// GHS (its provider side is failing with gateway_unavailable) and
// Flutterwave for NGN:
//   GHS: the customer is redirected to OpusTack's hosted checkout,
//        picks MTN / Telecel / AirtelTigo, approves the MoMo prompt
//        on their phone, and OpusTack calls our callback.
//   NGN: the customer is redirected to the same hosted checkout and
//        pays by card (Visa / Verve) — OpusTack lists NGN as a
//        supported currency, but names no Nigerian MoMo network, so
//        cards are the Nigeria route. No Ghana phone is required.
// This handler NEVER credits the wallet — settlement happens through
// the shared settleOpusTackAttempt in _lib.js, driven by the callback
// first and by the deposit-opustack-status reconciler as the safety
// net.
// Amounts: OpusTack speaks integer SMALLEST units (pesewas / kobo);
// the engine keeps major units on the attempt and converts at the
// edge. Oddaroa charges NO deposit fee, so the amount OpusTack
// charges is exactly the amount credited for GHS; for NGN the wallet
// is GHS-denominated, so the raw naira converts at fx_ngn_per_ghs
// at settlement (see settleOpusTackAttempt).
// Without OPUSTACK_SECRET_KEY this answers 503 provider_not_configured
// and the deposit page falls back to the ShinobiPay prompt.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  const maint = await maintenanceBlocked(auth);
  if (maint) return send(res, 503, { error: 'maintenance_mode', detail: maint });
  if (!opustackConfig().secretKey) return send(res, 503, { error: 'provider_not_configured' });
  await ensureAdminTables();
  const settings = await getSettings(['gateway_enabled', 'deposit_min_ghs', 'deposit_min_ngn']);
  if (settings.gateway_enabled === '0') return send(res, 503, { error: 'gateway_disabled', detail: 'Instant deposits are switched off right now. Please use Manual transfer.' });

  const users = await sql('select phone, role, email from users where id = $1', [auth.uid]);
  if (!users.length) return send(res, 404, { error: 'user_not_found' });
  const user = users[0];
  const currency = currencyOfPhone(user.phone);
  if (currency !== 'GHS' && currency !== 'NGN') return send(res, 400, { error: 'wrong_currency', detail: 'OpusTack deposits are for Ghana and Nigeria accounts.' });

  const rules = moneyRules(currency);
  const { amount_ghs, phone } = await readBody(req);
  const amount = Number(amount_ghs);
  // Floor is per-currency (depositFloorFor: GHS 210, NGN 25,000;
  // admin-tier accounts in Nigeria may deposit from ₦10 to test).
  const floor = depositFloorFor(user, currency, settings);
  if (!(amount >= floor) || amount > rules.maxDeposit) {
    return send(res, 400, { error: 'invalid_amount', detail: `Enter an amount between ${rules.symbol}${floor.toLocaleString('en-GB')} and ${rules.symbol}${rules.maxDeposit.toLocaleString('en-GB')}.` });
  }
  const amountMinor = Math.round(amount * 100);
  if (Math.abs(amount * 100 - amountMinor) > 0.001) return send(res, 400, { error: 'invalid_amount', detail: 'Amount must be in whole minor units.' });

  // Normalise the phone to international form for the attempt row.
  // GHS: a Ghana number (0XXXXXXXXX / 233XXXXXXXXX). NGN: a Nigerian
  // number (0XXXXXXXXXX / 234XXXXXXXXXX) — the checkout takes the
  // payment by card, so no network is needed and none is guessed.
  const digits = String(phone || user.phone || '').replace(/\D/g, '');
  let intl = '';
  let local = '';
  let net = '';
  if (currency === 'GHS') {
    local = digits.startsWith('233') ? '0' + digits.slice(3) : digits;
    if (!/^0\d{9}$/.test(local)) return send(res, 400, { error: 'invalid_phone', detail: 'Enter a valid Ghana phone number.' });
    intl = '233' + local.slice(1);
    net = detectNetwork(local) || '';
  } else {
    local = digits.startsWith('234') ? '0' + digits.slice(3) : digits;
    if (!/^0\d{10}$/.test(local)) return send(res, 400, { error: 'invalid_phone', detail: 'Enter a valid Nigerian phone number.' });
    intl = '234' + local.slice(1);
  }

  // OpusTack initialize needs a customer email. Prefer the account
  // email; accounts without one get a deterministic placeholder.
  const accountEmail = String(user.email || '').trim();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail) ? accountEmail : intl + '@phone.oddaroa.com';

  await ensurePaymentTables();
  // Anti-storm guard, scoped to OpusTack attempts for this number
  // (same rule as the ShinobiPay flow, Prince 2026-11-09): refuse
  // early, WITHOUT poking the provider, when an OpusTack payment is
  // already in flight or this number was blocked within the last
  // 30 minutes.
  const lastTry = await sql(
    `select status, fail_reason, created_at from payment_attempts
     where phone = $1 and provider = 'opustack' order by created_at desc limit 1`,
    [intl]
  );
  if (lastTry.length) {
    const ageMin = (Date.now() - new Date(lastTry[0].created_at).getTime()) / 60000;
    if ((lastTry[0].status === 'awaiting' || lastTry[0].status === 'created') && ageMin < 10) {
      return send(res, 409, { error: 'payment_in_progress', detail: 'A payment is already waiting for this number — approve it on the phone, or wait a few minutes for it to expire before trying again.' });
    }
    if (lastTry[0].fail_reason === 'number_blocked' && ageMin < 30) {
      return send(res, 429, { error: 'number_blocked', detail: 'This phone number is temporarily blocked by the payment provider. Please wait about 30 minutes before trying again — repeated tries can extend the block.' });
    }
  }
  // One attempt row per try. Its reference is unique per merchant account.
  const reference = 'ops_' + crypto.randomUUID().replace(/-/g, '');
  const attemptRows = await sql(
    `insert into payment_attempts (user_id, provider, reference, amount_ghs, amount_minor, phone, network, currency, status)
     values ($1, 'opustack', $2, $3, $4, $5, $6, $7, 'created') returning id`,
    [auth.uid, reference, amountMinor / 100, amountMinor, intl, net, currency]
  );
  const attemptId = attemptRows[0].id;

  let created;
  try {
    created = await opustackFetch('/v1/transactions/initialize', {
      method: 'POST',
      body: {
        email,
        amount: amountMinor,
        currency,
        reference,
        callback_url: opustackConfig().callbackUrl,
        metadata: { user_id: auth.uid, attempt_id: attemptId }
      }
    });
  } catch (e) {
    // Network failure mid-create: the payment may or may not exist. Mark
    // the attempt unknown and tell the customer to wait — never blindly
    // create a second charge.
    await sql(`update payment_attempts set status = 'unknown' where id = $1`, [attemptId]);
    return send(res, 202, { reference, status: 'unknown', credit_ghs: amountMinor / 100, detail: 'We could not confirm the payment request. If a prompt arrives, approve it once — do not pay twice.' });
  }

  const d = (created.data && created.data.data) || created.data || {};
  if ((created.status === 200 || created.status === 201) && d.authorization_url) {
    await sql(
      `update payment_attempts set intent_id = $2, status = 'awaiting' where id = $1`,
      [attemptId, String(d.access_code || d.reference || '')]
    );
    return send(res, 201, { reference, status: 'awaiting', credit_ghs: amountMinor / 100, link: d.authorization_url, checkout_url: d.authorization_url });
  }

  const errObj = (d.error && typeof d.error === 'object') ? d.error : {};
  let code = errObj.code || errObj.type || 'payment_failed';
  const message = (typeof d.message === 'string' && d.message) || 'The payment could not be started.';
  // A 403 means live payments are paused for this OpusTack account —
  // a configuration problem, not a customer problem.
  if (created.status === 403) code = 'live_paused';
  await sql(`update payment_attempts set status = 'failed', fail_reason = $2 where id = $1`, [attemptId, code]);
  if (created.status === 403) {
    return send(res, 502, { error: 'provider_config_error', detail: 'OpusTack live payments are paused for this account. Please try again later.', reference });
  }
  return send(res, created.status >= 400 && created.status < 500 ? created.status : 402, { error: code, detail: message, reference });
});
