const crypto = require('crypto');
const { sql, readBody, send, guard, requireAuth, alphapayConfig, alphapayFetch, alphapayNetworkFor, detectNetwork, ensurePaymentTables, ensureAdminTables, getSettings, currencyOfPhone, moneyRules, depositFloorFor, maintenanceBlocked } = require('../../_lib');

// Instant deposit (AlphaPay Softpay, Prince 2026-11-23) — the second
// instant gateway on Oddaroa next to OpusTack. The customer stays on
// the site: AlphaPay sends a USSD/push prompt to their phone and they
// approve it with their MoMo PIN. No redirect, no checkout page.
//   GHS: MTN (mtn_gh) / Telecel (vodafone_gh) / AirtelTigo (tigo_gh).
//   NGN: MTN (mtn_ng) / Airtel (airtel_ng).
// This handler NEVER credits the wallet — settlement happens through
// the shared settleAlphaPayAttempt in _lib.js, driven by the webhook
// first and by the deposit-alphapay-status reconciler as the safety
// net. Some operators ask for an OTP as well: the initiate answer
// then comes back phase 'otp' and the client posts the code to
// deposit-alphapay-otp.
// Amounts: AlphaPay speaks integer SMALLEST units (pesewas / kobo);
// the engine keeps major units on the attempt and converts at the
// edge. Oddaroa charges NO deposit fee, so the wallet is credited
// exactly the requested amount for GHS; for NGN the wallet is
// GHS-denominated, so the raw naira converts at fx_ngn_per_ghs
// at settlement (see settleAlphaPayAttempt).
// References are letters, digits and hyphens ONLY (AlphaPay rule —
// no underscores), so the reference is 'apay-' + 32 hex chars.
// Without ALPHAPAY_SECRET_KEY this answers 503 provider_not_configured
// and the deposit page falls back to the OpusTack panel.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  const maint = await maintenanceBlocked(auth);
  if (maint) return send(res, 503, { error: 'maintenance_mode', detail: maint });
  if (!alphapayConfig().secretKey) return send(res, 503, { error: 'provider_not_configured' });
  await ensureAdminTables();
  const settings = await getSettings(['gateway_enabled', 'deposit_min_ghs', 'deposit_min_ngn']);
  if (settings.gateway_enabled === '0') return send(res, 503, { error: 'gateway_disabled', detail: 'Instant deposits are switched off right now. Please use Manual transfer.' });

  const users = await sql('select phone, role, email, display_name from users where id = $1', [auth.uid]);
  if (!users.length) return send(res, 404, { error: 'user_not_found' });
  const user = users[0];
  const currency = currencyOfPhone(user.phone);
  if (currency !== 'GHS' && currency !== 'NGN') return send(res, 400, { error: 'wrong_currency', detail: 'AlphaPay deposits are for Ghana and Nigeria accounts.' });

  const rules = moneyRules(currency);
  const { amount_ghs, phone, network } = await readBody(req);
  const amount = Number(amount_ghs);
  // Floor is per-currency (depositFloorFor: GHS 210, NGN 25,000;
  // admin-tier accounts in Nigeria may deposit from ₦10 to test).
  const floor = depositFloorFor(user, currency, settings);
  if (!(amount >= floor) || amount > rules.maxDeposit) {
    return send(res, 400, { error: 'invalid_amount', detail: `Enter an amount between ${rules.symbol}${floor.toLocaleString('en-GB')} and ${rules.symbol}${rules.maxDeposit.toLocaleString('en-GB')}.` });
  }
  const amountMinor = Math.round(amount * 100);
  if (Math.abs(amount * 100 - amountMinor) > 0.001) return send(res, 400, { error: 'invalid_amount', detail: 'Amount must be in whole minor units.' });

  // Normalise the phone to international form for the attempt row and
  // for AlphaPay (which accepts +233… / 233… / local, normalised
  // server-side — we always send the + form).
  const digits = String(phone || user.phone || '').replace(/\D/g, '');
  let intl = '';
  let local = '';
  if (currency === 'GHS') {
    local = digits.startsWith('233') ? '0' + digits.slice(3) : digits;
    if (!/^0\d{9}$/.test(local)) return send(res, 400, { error: 'invalid_phone', detail: 'Enter a valid Ghana phone number.' });
    intl = '233' + local.slice(1);
  } else {
    local = digits.startsWith('234') ? '0' + digits.slice(3) : digits;
    if (!/^0\d{10}$/.test(local)) return send(res, 400, { error: 'invalid_phone', detail: 'Enter a valid Nigerian phone number.' });
    intl = '234' + local.slice(1);
  }
  const label = String(network || '') || detectNetwork(local) || (currency === 'NGN' ? 'MTN' : 'MTN');
  const netCode = alphapayNetworkFor(label, currency);
  // AlphaPay requires a FULL customer object: email, first_name and
  // last_name are all mandatory — a 400 "Ce champ est obligatoire"
  // otherwise (Kilo's two tries + the QA retry, 2026-11-24). Split
  // the account display name; a single-word name repeats as the
  // last name. The email is the payer's own account email, sent to
  // the payment provider only — never shown on a page.
  const nameParts = String(user.display_name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || 'Oddaroa';
  const lastName = nameParts.slice(1).join(' ') || firstName;

  await ensurePaymentTables();
  // NO anti-storm guard here by Prince's order (2026-11-24): users
  // may retry as many times as they want, even while another payment
  // for this number is still awaiting. The old 10-minute in-flight
  // 409 and the 30-minute number_blocked 429 were removed — Kilo hit
  // the 409 on 2026-11-24 and Prince ordered the block off. Each try
  // still gets its own attempt row + unique reference, and approving
  // more than one live prompt charges each one separately.
  // One attempt row per try. Its reference is unique per merchant account.
  const reference = 'apay-' + crypto.randomUUID().replace(/-/g, '');
  const attemptRows = await sql(
    `insert into payment_attempts (user_id, provider, reference, amount_ghs, amount_minor, phone, network, currency, status)
     values ($1, 'alphapay', $2, $3, $4, $5, $6, $7, 'created') returning id`,
    [auth.uid, reference, amountMinor / 100, amountMinor, intl, netCode, currency]
  );
  const attemptId = attemptRows[0].id;

  let created;
  try {
    created = await alphapayFetch('/payments/softpay/', {
      method: 'POST',
      body: {
        amount: amountMinor,
        currency,
        // The official AlphaPay SDK sends country + a customer object
        // on every payin (its /payments/softpay/ docs page omits them,
        // and the live API 400s without them — Kilo 2026-11-24).
        country: currency === 'NGN' ? 'NG' : 'GH',
        phone: '+' + intl,
        customer: {
          email: user.email || (intl + '@phone.oddaroa.com'),
          first_name: firstName,
          last_name: lastName,
          phone: '+' + intl
        },
        network: netCode,
        reference,
        description: 'Oddaroa wallet deposit',
        metadata: { user_id: auth.uid, attempt_id: attemptId },
        callback_url: 'https://oddaroa.com/api/payments/alphapay-webhook'
      }
    });
  } catch (e) {
    // Network failure mid-create: the payment may or may not exist. Mark
    // the attempt unknown and tell the customer to wait — never blindly
    // create a second charge.
    await sql(`update payment_attempts set status = 'unknown' where id = $1`, [attemptId]);
    return send(res, 202, { reference, status: 'unknown', credit_ghs: amountMinor / 100, detail: 'We could not confirm the payment request. If a prompt arrives, approve it once — do not pay twice.' });
  }

  const d = created.data || {};
  // The live API nests the payment under data: {success, data: {id,
  // status, ...}, code} — a flat d.payment_id/d.id read misses it
  // (the 201 "Payment pushed successfully" on 2026-11-24 was marked
  // failed for exactly this). Read both shapes.
  const inner = (d.data && typeof d.data === 'object') ? d.data : {};
  const paymentId = String(d.payment_id || d.id || inner.payment_id || inner.id || '');
  if ((created.status === 202 || created.status === 200 || created.status === 201) && paymentId) {
    await sql(
      `update payment_attempts set intent_id = $2, status = 'awaiting' where id = $1`,
      [attemptId, paymentId]
    );
    // Some operators ask for an OTP after the prompt: the client shows
    // the code form and posts it to deposit-alphapay-otp.
    const otpRef = String(d.otp_reference || d.otpReference || inner.otp_reference || inner.otpReference || '');
    if (otpRef || d.requires_otp || d.otp_required || inner.requires_otp || inner.otp_required) {
      return send(res, 201, { reference, status: 'otp', payment_id: paymentId, otp_reference: otpRef, credit_ghs: amountMinor / 100 });
    }
    return send(res, 201, { reference, status: 'awaiting', payment_id: paymentId, credit_ghs: amountMinor / 100 });
  }

  const errObj = (d.error && typeof d.error === 'object') ? d.error : (inner.error && typeof inner.error === 'object' ? inner.error : {});
  let code = errObj.code || d.code || inner.code || 'payment_failed';
  const message = (typeof d.message === 'string' && d.message)
    || (typeof errObj.message === 'string' && errObj.message)
    || (typeof d.detail === 'string' && d.detail)
    || (typeof errObj.detail === 'string' && errObj.detail)
    || (typeof inner.message === 'string' && inner.message)
    || (typeof inner.detail === 'string' && inner.detail)
    || 'The payment could not be started.';
  // A 403 means live payments are paused for this AlphaPay account —
  // a configuration problem, not a customer problem.
  if (created.status === 403) code = 'live_paused';
  // Store the provider's raw error body (truncated) so a 400 can be
  // diagnosed from the DB instead of guessed — the body is the only
  // place AlphaPay says what it rejected. The plain 'number_blocked'
  // value is kept so the anti-storm guard still matches it.
  const rawBody = JSON.stringify(d || {}).slice(0, 400);
  const failReason = code === 'number_blocked' ? 'number_blocked' : created.status + ':' + rawBody;
  await sql(`update payment_attempts set status = 'failed', fail_reason = $2 where id = $1`, [attemptId, failReason]);
  if (created.status === 403) {
    return send(res, 502, { error: 'provider_config_error', detail: 'AlphaPay live payments are paused for this account. Please try again later.', reference });
  }
  return send(res, created.status >= 400 && created.status < 500 ? created.status : 402, { error: code, detail: message, reference });
});
