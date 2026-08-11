// PayPal REST client.
//
// Native fetch on Node 18+, consistent with the codebase's dependency-light
// style. Every call goes through `request`, which is the single seam tests mock.

const settingsService = require('./settingsService');
const { formatForPaypal } = require('../utils/money');

const LIVE = 'https://api-m.paypal.com';
const SANDBOX = 'https://api-m.sandbox.paypal.com';

let tokenCache = null; // { token, expiresAt, key }

const paypalError = (message, status = 502, details = null) =>
  Object.assign(new Error(message), { status, details });

const credentials = async () => {
  const snapshot = await settingsService.snapshot();
  const environment = snapshot.get('paypal.environment');
  return {
    base: process.env.PAYPAL_API_BASE || (environment === 'live' ? LIVE : SANDBOX),
    clientId: process.env.PAYPAL_CLIENT_ID || snapshot.get('paypal.clientId'),
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
    environment,
    brandName: snapshot.get('paypal.brandName'),
  };
};

const isConfigured = async () => {
  const { clientId, clientSecret } = await credentials();
  return Boolean(clientId && clientSecret);
};

/** OAuth token, cached until shortly before it expires. */
const accessToken = async () => {
  const { base, clientId, clientSecret } = await credentials();
  if (!clientId || !clientSecret) throw paypalError('PayPal is not configured', 503);

  const key = `${base}:${clientId}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw paypalError(`PayPal auth failed: ${body.error_description || response.status}`);

  tokenCache = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000, key };
  return tokenCache.token;
};

const request = async (method, path, body = null, extraHeaders = {}) => {
  const { base } = await credentials();
  const token = await accessToken();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    // PayPal's `message` is generic ("Request is not well-formed…"); the
    // actionable part is in `details`, which names the offending field. Losing
    // it turns a one-line fix into a guessing game, so it is logged and folded
    // into the thrown message.
    const detail = (payload.details || [])
      .map((entry) => [entry.field, entry.issue, entry.description].filter(Boolean).join(' '))
      .join('; ');
    console.error(
      `[paypal] ${method} ${path} -> ${response.status}`,
      payload.name || '',
      payload.message || '',
      detail ? `\n  details: ${detail}` : '',
      payload.debug_id ? `\n  debug_id: ${payload.debug_id}` : ''
    );
    throw paypalError(
      [payload.message || `PayPal ${method} ${path} failed (${response.status})`, detail]
        .filter(Boolean)
        .join(' — '),
      502,
      payload
    );
  }
  return payload;
};

/**
 * Create an order.
 *
 * `custom_id` carries our order id back through the webhook. We deliberately do
 * NOT set `invoice_id`: PayPal enforces it as globally unique per merchant, so a
 * retried creation would fail with DUPLICATE_INVOICE_ID.
 */
const isAbsoluteUrl = (value) => typeof value === 'string' && /^https?:\/\/\S+$/.test(value);

const createOrder = async ({ order, description, returnUrl, cancelUrl }) => {
  const { brandName } = await credentials();
  const amount = formatForPaypal(order.chargeAmountMinor, order.chargeCurrency);

  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        custom_id: String(order._id),
        description: description.slice(0, 127),
        amount: { currency_code: order.chargeCurrency, value: amount },
      },
    ],
  };

  // `experience_context` is only sent when both URLs are real absolute URLs.
  //
  // Live PayPal rejects the block outright when return_url/cancel_url are
  // missing — "Request is not well-formed, syntactically incorrect, or
  // violates schema" — while sandbox accepts it happily. That difference is
  // why this passes locally and fails in production. The block is optional for
  // the JS SDK flow, so omitting it is safe; sending it half-populated is not.
  if (isAbsoluteUrl(returnUrl) && isAbsoluteUrl(cancelUrl)) {
    body.payment_source = {
      paypal: {
        experience_context: {
          brand_name: (brandName || 'NovelHub').slice(0, 127),
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    };
  }

  return request('POST', '/v2/checkout/orders', body);
};

const captureOrder = (paypalOrderId) =>
  // A PayPal-Request-Id makes the capture itself idempotent on their side.
  request('POST', `/v2/checkout/orders/${paypalOrderId}/capture`, {}, { 'PayPal-Request-Id': `cap-${paypalOrderId}` });

const getOrder = (paypalOrderId) => request('GET', `/v2/checkout/orders/${paypalOrderId}`);

// --- subscriptions --------------------------------------------------------

/** Catalog product — the thing a billing plan sells. Created once per plan. */
const createProduct = ({ name, description }) =>
  request('POST', '/v1/catalogs/products', {
    name: name.slice(0, 127),
    description: (description || name).slice(0, 256),
    type: 'SERVICE',
    category: 'ONLINE_SERVICES',
  });

/**
 * Billing plan.
 *
 * PayPal treats an active plan as immutable in every way that matters, so a
 * price change means a new plan and migrating subscribers — which is why the
 * caller records the price this plan was created for.
 */
const createBillingPlan = ({ productId, name, description, priceUsdCents, interval, intervalCount, trialDays }) => {
  const cycles = [];

  if (trialDays > 0) {
    cycles.push({
      frequency: { interval_unit: 'DAY', interval_count: trialDays },
      tenure_type: 'TRIAL',
      sequence: cycles.length + 1,
      total_cycles: 1,
      pricing_scheme: { fixed_price: { value: '0', currency_code: 'USD' } },
    });
  }

  cycles.push({
    frequency: {
      interval_unit: interval === 'year' ? 'YEAR' : 'MONTH',
      interval_count: intervalCount || 1,
    },
    tenure_type: 'REGULAR',
    sequence: cycles.length + 1,
    total_cycles: 0, // renew indefinitely
    pricing_scheme: {
      fixed_price: { value: (priceUsdCents / 100).toFixed(2), currency_code: 'USD' },
    },
  });

  return request('POST', '/v1/billing/plans', {
    product_id: productId,
    name: name.slice(0, 127),
    description: (description || name).slice(0, 127),
    status: 'ACTIVE',
    billing_cycles: cycles,
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: 'CANCEL',
      // PayPal gives up after this many failures; the grace period setting
      // governs what access looks like meanwhile.
      payment_failure_threshold: 3,
    },
  });
};

const deactivateBillingPlan = (planId) => request('POST', `/v1/billing/plans/${planId}/deactivate`, {});

const createSubscription = ({ planId, subscriptionId, returnUrl, cancelUrl, brandName }) =>
  request('POST', '/v1/billing/subscriptions', {
    plan_id: planId,
    // Carried back on every webhook, the same role custom_id plays for orders.
    custom_id: String(subscriptionId),
    application_context: {
      brand_name: (brandName || 'NovelHub').slice(0, 127),
      shipping_preference: 'NO_SHIPPING',
      user_action: 'SUBSCRIBE_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  });

const getSubscription = (id) => request('GET', `/v1/billing/subscriptions/${id}`);

const cancelSubscription = (id, reason = 'Cancelled by the subscriber') =>
  request('POST', `/v1/billing/subscriptions/${id}/cancel`, { reason: reason.slice(0, 127) });

const refundCapture = (captureId, { amountMinor, currency, note } = {}) =>
  request(
    'POST',
    `/v2/payments/captures/${captureId}/refund`,
    amountMinor
      ? { amount: { value: formatForPaypal(amountMinor, currency), currency_code: currency }, note_to_payer: note }
      : {}
  );

/**
 * Verify a webhook came from PayPal.
 *
 * Uses PayPal's verification endpoint rather than local certificate-chain
 * validation, which would mean downloading certs and handling their rotation
 * ourselves. PayPal recommends this approach.
 */
const verifyWebhookSignature = async (headers, event) => {
  const { webhookId } = await credentials();
  if (!webhookId) return { verified: false, reason: 'no webhook id configured' };

  const payload = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookId,
    webhook_event: event,
  };
  if (!payload.transmission_id || !payload.transmission_sig) {
    return { verified: false, reason: 'missing signature headers' };
  }

  try {
    const result = await request('POST', '/v1/notifications/verify-webhook-signature', payload);
    return { verified: result.verification_status === 'SUCCESS', reason: result.verification_status };
  } catch (error) {
    return { verified: false, reason: error.message };
  }
};

/** Admin "test connection" button. */
const testConnection = async () => {
  try {
    await accessToken();
    const { environment, base } = await credentials();
    return { ok: true, environment, base };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

const resetTokenCache = () => {
  tokenCache = null;
};

module.exports = {
  isConfigured,
  credentials,
  createOrder,
  captureOrder,
  getOrder,
  createProduct,
  createBillingPlan,
  deactivateBillingPlan,
  createSubscription,
  getSubscription,
  cancelSubscription,
  refundCapture,
  verifyWebhookSignature,
  testConnection,
  resetTokenCache,
  request,
};
