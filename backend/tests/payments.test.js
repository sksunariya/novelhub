const { api, createUser } = require('./helpers');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const orderService = require('../src/services/orderService');
const fxService = require('../src/services/fxService');
const paypalService = require('../src/services/paypalService');
const Currency = require('../src/models/Currency');
const CreditPack = require('../src/models/CreditPack');
const Order = require('../src/models/Order');
const WebhookEvent = require('../src/models/WebhookEvent');
const Wallet = require('../src/models/Wallet');
const CreditTransaction = require('../src/models/CreditTransaction');
const { ORDER_STATUS, PAYPAL_EVENTS } = require('../src/config/constants');

let user;
let token;
let pack;

// PayPal is mocked at the service boundary — the one seam every call passes through.
jest.mock('../src/services/paypalService', () => {
  const actual = jest.requireActual('../src/services/paypalService');
  return {
    ...actual,
    isConfigured: jest.fn().mockResolvedValue(true),
    createOrder: jest.fn(),
    captureOrder: jest.fn(),
    verifyWebhookSignature: jest.fn().mockResolvedValue({ verified: true, reason: 'SUCCESS' }),
  };
});

// PayPal order ids must be unique per order: Order.paypalOrderId carries a
// unique index, so reusing one constant across several orders in a test would
// collide rather than exercise the path under test.
let paypalSeq = 0;
const nextPaypalOrderId = () => `PPORDER-${(paypalSeq += 1)}`;

const captureResponse = ({ value = '9.99', currency = 'USD', status = 'COMPLETED', id = 'CAP-1' } = {}) => ({
  id: 'PPORDER-1',
  status: 'COMPLETED',
  payer: { payer_id: 'PAYER1', email_address: 'buyer@test.com' },
  purchase_units: [
    {
      payments: {
        captures: [
          {
            id,
            status,
            amount: { value, currency_code: currency },
            seller_receivable_breakdown: {
              paypal_fee: { value: '0.64', currency_code: 'USD' },
              net_amount: { value: '9.35', currency_code: 'USD' },
            },
          },
        ],
      },
    },
  ],
});

beforeEach(async () => {
  settingsService.clearCache();
  jest.clearAllMocks();
  paypalSeq = 0;
  paypalService.createOrder.mockImplementation(async () => ({ id: nextPaypalOrderId(), status: 'CREATED' }));
  paypalService.captureOrder.mockImplementation(async () => captureResponse());
  paypalService.verifyWebhookSignature.mockResolvedValue({ verified: true, reason: 'SUCCESS' });

  ({ user, token } = await createUser());
  await Currency.create({ code: 'USD', name: 'US Dollar', symbol: '$', enabled: true, autoRate: 1, isDefault: true });
  pack = await CreditPack.create({
    name: 'Starter',
    slug: 'starter',
    credits: 1000,
    bonusCredits: 200,
    priceUsdCents: 999,
  });
  await settingsService.update({ 'monetization.enabled': true, 'store.enabled': true });
  settingsService.clearCache();
});

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

// PayPal's live API rejects an order whose experience block is present without
// return_url/cancel_url — sandbox accepts it, which is why this only ever
// showed up in production.
describe('paypal order payload', () => {
  const buildPayload = async (headers = {}) => {
    let request = auth(api().post('/api/store/orders'));
    Object.entries(headers).forEach(([name, value]) => {
      request = request.set(name, value);
    });
    await request.send({ packId: pack._id }).expect(201);
    return paypalService.createOrder.mock.calls.at(-1)[0];
  };

  it('sends absolute return and cancel URLs derived from the origin', async () => {
    const args = await buildPayload({ Origin: 'https://apexnovelhub.com' });
    expect(args.returnUrl).toBe('https://apexnovelhub.com/store?paypal=return');
    expect(args.cancelUrl).toBe('https://apexnovelhub.com/store?paypal=cancel');
  });

  it('does not depend on the client sending them', async () => {
    // The store page never has; the server must fill them in regardless.
    const args = await buildPayload({ Origin: 'https://apexnovelhub.com' });
    expect(args.returnUrl).toMatch(/^https:\/\//);
  });

  it('falls back to CLIENT_URL when there is no Origin header', async () => {
    process.env.CLIENT_URL = 'https://fallback.example';
    try {
      const args = await buildPayload();
      expect(args.returnUrl).toBe('https://fallback.example/store?paypal=return');
    } finally {
      delete process.env.CLIENT_URL;
    }
  });
});

// Surfaces the server's message on failure. A bare .expect(201) reports only
// the status code, which turns any setup problem into an unreadable failure.
const placeOrder = async () => {
  const res = await auth(api().post('/api/store/orders')).send({ packId: pack._id });
  if (res.status !== 201) {
    throw new Error(`order create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return Order.findById(res.body.orderId);
};

const webhook = (eventType, resource, id = `EVT-${Date.now()}-${Math.random()}`) =>
  api()
    .post('/webhooks/paypal')
    .set('paypal-transmission-id', 'T1')
    .set('paypal-transmission-sig', 'S1')
    .send({ id, event_type: eventType, resource });

describe('currency model guards', () => {
  it('refuses local settlement for a currency PayPal cannot settle', async () => {
    const inr = await Currency.create({ code: 'INR', symbol: '₹', settlementMode: 'local', autoRate: 83 });
    expect(inr.paypalSupported).toBe(false);
    expect(inr.settlementMode).toBe('usd');
  });

  it('allows local settlement for a supported currency', async () => {
    const eur = await Currency.create({ code: 'EUR', symbol: '€', settlementMode: 'local', autoRate: 0.92 });
    expect(eur.paypalSupported).toBe(true);
    expect(eur.settlementMode).toBe('local');
  });

  it('forces zero decimals and drops charm rounding for JPY', async () => {
    const jpy = await Currency.create({ code: 'JPY', symbol: '¥', rounding: 'charm_99', autoRate: 152 });
    expect(jpy.decimals).toBe(0);
    expect(jpy.rounding).toBe('nearest_int');
  });
});

describe('currency quoting', () => {
  it('settles locally in a supported currency', async () => {
    const eur = await Currency.create({
      code: 'EUR', symbol: '€', enabled: true, settlementMode: 'local',
      autoRate: 0.92, lastRateAt: new Date(), rounding: 'charm_99',
    });
    const quote = await fxService.quote(999, eur);
    expect(quote.settle.currency).toBe('EUR');
    expect(quote.isEstimate).toBe(false);
  });

  it('shows an estimate and charges USD for an unsupported currency', async () => {
    const inr = await Currency.create({
      code: 'INR', symbol: '₹', enabled: true, autoRate: 83.2,
      lastRateAt: new Date(), rounding: 'nearest_10', markupPct: 3,
    });
    const quote = await fxService.quote(999, inr);
    expect(quote.display.code).toBe('INR');
    expect(quote.settle).toMatchObject({ currency: 'USD', amountMinor: 999 });
    expect(quote.isEstimate).toBe(true);
  });

  it('keeps JPY amounts whole', async () => {
    const jpy = await Currency.create({
      code: 'JPY', symbol: '¥', enabled: true, settlementMode: 'local',
      autoRate: 152, lastRateAt: new Date(),
    });
    const quote = await fxService.quote(999, jpy);
    expect(quote.display.decimals).toBe(0);
    expect(Number.isInteger(quote.settle.amountMinor)).toBe(true);
  });

  describe('stale rates', () => {
    const staleCurrency = () =>
      Currency.create({
        code: 'EUR', symbol: '€', enabled: true, settlementMode: 'local', autoRate: 0.92,
        lastRateAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      });

    it('falls back to USD by default', async () => {
      const quote = await fxService.quote(999, await staleCurrency());
      expect(quote.settle.currency).toBe('USD');
      expect(quote.stale).toBe(true);
    });

    it('can be configured to block purchases', async () => {
      await settingsService.update({ 'fx.onStaleRates': 'block_purchases' });
      settingsService.clearCache();
      await expect(fxService.quote(999, await staleCurrency())).rejects.toMatchObject({ status: 503 });
    });

    it('can be configured to keep using the last known rate', async () => {
      await settingsService.update({ 'fx.onStaleRates': 'use_last_known' });
      settingsService.clearCache();
      const quote = await fxService.quote(999, await staleCurrency());
      expect(quote.display.code).toBe('EUR');
      expect(quote.stale).toBe(true);
    });
  });
});

describe('creating an order', () => {
  it('locks the price and returns the PayPal order', async () => {
    const res = await auth(api().post('/api/store/orders')).send({ packId: pack._id });
    expect({ status: res.status, body: res.body }).toMatchObject({ status: 201 });
    expect(res.body).toMatchObject({ paypalOrderId: 'PPORDER-1', totalCredits: 1200 });
    expect(res.body.orderNumber).toMatch(/^NH-\d{4}-\d{7}$/);

    const order = await Order.findById(res.body.orderId);
    expect(order.netUsdCents).toBe(999);
    expect(order.chargeAmountMinor).toBe(999);
    expect(order.quoteExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('ignores any price the client sends', async () => {
    const res = await auth(api().post('/api/store/orders'))
      .send({ packId: pack._id, priceUsdCents: 1, amount: 1, totalCredits: 999999 });
    expect({ status: res.status, body: res.body }).toMatchObject({ status: 201 });
    const order = await Order.findById(res.body.orderId);
    expect(order.netUsdCents).toBe(999);
    expect(order.totalCredits).toBe(1200);
  });

  it('issues sequential order numbers under concurrency', async () => {
    const results = await Promise.all([placeOrder(), placeOrder(), placeOrder()]);
    const numbers = results.map((order) => order.orderNumber);
    expect(new Set(numbers).size).toBe(3);
  });

  it('requires authentication', async () => {
    await api().post('/api/store/orders').send({ packId: pack._id }).expect(401);
  });

  it('refuses when the store is closed', async () => {
    await settingsService.update({ 'store.enabled': false });
    settingsService.clearCache();
    await auth(api().post('/api/store/orders')).send({ packId: pack._id }).expect(503);
  });

  it('refuses in read-only mode', async () => {
    await settingsService.update({ 'monetization.readOnlyMode': true });
    settingsService.clearCache();
    await auth(api().post('/api/store/orders')).send({ packId: pack._id }).expect(503);
  });

  it('refuses from a restricted country', async () => {
    await settingsService.update({ 'geo.restrictedCountries': ['KP'] });
    settingsService.clearCache();
    await auth(api().post('/api/store/orders'))
      .set('CF-IPCountry', 'KP')
      .send({ packId: pack._id })
      .expect(403);
  });
});

describe('capturing', () => {
  it('credits the buyer including bonus credits', async () => {
    const order = await placeOrder();
    const res = await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(200);
    expect(res.body).toMatchObject({ creditsAdded: 1200, balance: 1200 });

    const updated = await Order.findById(order._id);
    expect(updated.status).toBe(ORDER_STATUS.CAPTURED);
    expect(updated.creditedAt).not.toBeNull();
    expect(updated.paypalFeeUsdCents).toBe(64);
  });

  it('sets the cost basis from the net amount so bonus credits dilute it', async () => {
    const order = await placeOrder();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(200);

    // $9.35 net over 1200 credits, then a 10-credit unlock.
    const spend = await creditService.debit({ user, amount: 10 });
    expect(spend.attributedUsdMicros).toBe(Math.floor((935 * 10000 * 10) / 1200));
  });

  it('credits once when captured twice', async () => {
    const order = await placeOrder();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(200);
    const again = await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(200);
    expect(again.body.alreadyCredited).toBe(true);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(1200);
  });

  it('refuses to credit when the captured amount does not match', async () => {
    paypalService.captureOrder.mockResolvedValue(captureResponse({ value: '0.01' }));
    const order = await placeOrder();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(409);

    const updated = await Order.findById(order._id);
    expect(updated.status).toBe(ORDER_STATUS.DISPUTED);
    expect(updated.creditedAt).toBeNull();
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(0);
  });

  it('refuses to credit when the captured currency does not match', async () => {
    paypalService.captureOrder.mockResolvedValue(captureResponse({ currency: 'EUR' }));
    const order = await placeOrder();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(409);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(0);
  });

  it('marks the order failed when PayPal declines', async () => {
    paypalService.captureOrder.mockResolvedValue(captureResponse({ status: 'DECLINED' }));
    const order = await placeOrder();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(402);
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS.FAILED);
  });

  it('will not capture another user\'s order', async () => {
    const order = await placeOrder();
    const { token: other } = await createUser();
    await api()
      .post(`/api/store/orders/${order._id}/capture`)
      .set('Authorization', `Bearer ${other}`)
      .expect(404);
  });
});

describe('webhooks', () => {
  it('is reachable outside /api so maintenance mode cannot block it', async () => {
    await settingsService.update({ 'monetization.enabled': true });
    const SiteSettings = require('../src/models/SiteSettings');
    const settings = await SiteSettings.getSettings();
    settings.maintenanceMode = true;
    await settings.save();

    // /api is 503 during maintenance...
    await api().get('/api/novels').expect(503);
    // ...but PayPal still gets through.
    await webhook(PAYPAL_EVENTS.ORDER_APPROVED, { id: 'PPORDER-1' }).expect(200);
  });

  it('credits when the buyer never returns to the site', async () => {
    const order = await placeOrder();
    await webhook(PAYPAL_EVENTS.CAPTURE_COMPLETED, {
      id: 'CAP-1',
      custom_id: String(order._id),
      amount: { value: '9.99', currency_code: 'USD' },
    }).expect(200);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(1200);
    expect((await Order.findById(order._id)).creditedAt).not.toBeNull();
  });

  it('ignores a replayed event id', async () => {
    const order = await placeOrder();
    const resource = { id: 'CAP-1', custom_id: String(order._id) };
    await webhook(PAYPAL_EVENTS.CAPTURE_COMPLETED, resource, 'EVT-SAME').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const res = await webhook(PAYPAL_EVENTS.CAPTURE_COMPLETED, resource, 'EVT-SAME').expect(200);
    expect(res.body.duplicate).toBe(true);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(1200);
    expect(await WebhookEvent.countDocuments({ eventId: 'EVT-SAME' })).toBe(1);
  });

  it('converges with the client capture path instead of double-crediting', async () => {
    const order = await placeOrder();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(200);
    await webhook(PAYPAL_EVENTS.CAPTURE_COMPLETED, {
      id: 'CAP-1',
      custom_id: String(order._id),
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect((await Wallet.findOne({ user: user._id })).balance).toBe(1200);
    const purchases = await CreditTransaction.countDocuments({ user: user._id, type: 'purchase' });
    expect(purchases).toBe(1);
  });

  it('rejects an unverified signature without processing it', async () => {
    paypalService.verifyWebhookSignature.mockResolvedValue({ verified: false, reason: 'BAD' });
    const order = await placeOrder();
    const res = await webhook(PAYPAL_EVENTS.CAPTURE_COMPLETED, {
      id: 'CAP-1',
      custom_id: String(order._id),
    }).expect(200);

    expect(res.body.verified).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(0);
  });

  it('rejects a malformed payload', async () => {
    await api().post('/webhooks/paypal').send({ nonsense: true }).expect(400);
  });

  it('claws credits back on a refund', async () => {
    const order = await placeOrder();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(200);

    await webhook(PAYPAL_EVENTS.CAPTURE_REFUNDED, {
      id: 'CAP-1',
      custom_id: String(order._id),
      amount: { value: '9.99', currency_code: 'USD' },
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect((await Wallet.findOne({ user: user._id })).balance).toBe(0);
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS.REFUNDED);
  });

  it('claws back only what is left when credits were already spent', async () => {
    const order = await placeOrder();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(200);
    await creditService.debit({ user, amount: 500, idempotencyKey: 'spent-some' });

    await orderService.clawbackOrder(await Order.findById(order._id));
    const wallet = await Wallet.findOne({ user: user._id });
    expect(wallet.balance).toBe(0); // 700 remaining taken, no negative
  });

  it('allows a negative balance when the admin permits it', async () => {
    await settingsService.update({ 'credits.allowNegativeBalance': true });
    settingsService.clearCache();
    const order = await placeOrder();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(200);
    await creditService.debit({ user, amount: 500, idempotencyKey: 'spent-some' });

    await orderService.clawbackOrder(await Order.findById(order._id));
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(-500);
  });

  it('flags a dispute', async () => {
    const order = await placeOrder();
    await webhook(PAYPAL_EVENTS.DISPUTE_CREATED, { id: 'PPORDER-1', custom_id: String(order._id) }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS.DISPUTED);
  });
});

describe('store listing', () => {
  it('prices packs in the requested currency', async () => {
    await Currency.create({
      code: 'INR', symbol: '₹', enabled: true, autoRate: 83.2,
      lastRateAt: new Date(), rounding: 'nearest_10',
    });
    const res = await api().get('/api/store/packs?currency=INR').expect(200);
    expect(res.body.packs[0].price.code).toBe('INR');
    expect(res.body.packs[0].isEstimate).toBe(true);
    expect(res.body.packs[0].chargedIn).toBe('USD');
  });

  it('hides everything when monetization is off', async () => {
    await settingsService.update({ 'monetization.enabled': false });
    settingsService.clearCache();
    const res = await api().get('/api/store/packs').expect(200);
    expect(res.body).toMatchObject({ enabled: false, packs: [] });
  });

  it('respects a per-user purchase limit', async () => {
    pack.limits.perUserTotal = 1;
    await pack.save();
    const order = await placeOrder();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(200);
    await auth(api().post('/api/store/orders')).send({ packId: pack._id }).expect(403);
  });

  it('excludes a pack blocked in the buyer\'s country', async () => {
    pack.visibility.blockedCountries = ['IN'];
    await pack.save();
    const res = await api().get('/api/store/packs').set('CF-IPCountry', 'IN').expect(200);
    expect(res.body.packs).toHaveLength(0);
  });
});

describe('order expiry', () => {
  it('expires orders past their price lock', async () => {
    const order = await placeOrder();
    order.quoteExpiresAt = new Date(Date.now() - 1000);
    await order.save();

    const result = await orderService.expireStaleOrders();
    expect(result.expired).toBe(1);
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS.EXPIRED);
  });

  it('refuses to capture an expired order', async () => {
    const order = await placeOrder();
    order.status = ORDER_STATUS.EXPIRED;
    await order.save();
    await auth(api().post(`/api/store/orders/${order._id}/capture`)).expect(409);
  });
});
