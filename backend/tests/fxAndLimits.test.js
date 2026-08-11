const fxService = require('../src/services/fxService');
const settingsService = require('../src/services/settingsService');
const rateLimit = require('../src/middlewares/rateLimit');
const Currency = require('../src/models/Currency');
const FxRateSnapshot = require('../src/models/FxRateSnapshot');
const { api, createUser, createAdmin } = require('./helpers');

beforeEach(async () => {
  settingsService.clearCache();
  rateLimit._buckets.clear();
});

describe('currency resolution', () => {
  beforeEach(async () => {
    await Currency.create({ code: 'USD', symbol: '$', enabled: true, autoRate: 1, isDefault: true });
  });

  it('falls back to the configured default', async () => {
    const currency = await fxService.resolveCurrency({});
    expect(currency.code).toBe('USD');
  });

  it('honours an explicit request for an enabled currency', async () => {
    await Currency.create({ code: 'EUR', symbol: '€', enabled: true, autoRate: 0.92 });
    expect((await fxService.resolveCurrency({ requested: 'eur' })).code).toBe('EUR');
  });

  it('ignores a request for a currency that is not enabled', async () => {
    await Currency.create({ code: 'EUR', symbol: '€', enabled: false, autoRate: 0.92 });
    expect((await fxService.resolveCurrency({ requested: 'EUR' })).code).toBe('USD');
  });

  it('ignores a request for a currency that does not exist', async () => {
    expect((await fxService.resolveCurrency({ requested: 'ZZZ' })).code).toBe('USD');
  });

  it('ignores the request when overrides are disabled', async () => {
    await Currency.create({ code: 'EUR', symbol: '€', enabled: true, autoRate: 0.92 });
    await settingsService.update({ 'currency.allowUserOverride': false });
    settingsService.clearCache();
    expect((await fxService.resolveCurrency({ requested: 'EUR' })).code).toBe('USD');
  });

  it('detects from country when auto-detect is on', async () => {
    await Currency.create({ code: 'JPY', symbol: '¥', enabled: true, autoRate: 152 });
    expect((await fxService.resolveCurrency({ ipCountry: 'JP' })).code).toBe('JPY');
  });

  it('maps euro-zone countries to EUR', async () => {
    await Currency.create({ code: 'EUR', symbol: '€', enabled: true, autoRate: 0.92 });
    for (const country of ['DE', 'FR', 'ES', 'IE']) {
      expect((await fxService.resolveCurrency({ ipCountry: country })).code).toBe('EUR');
    }
  });

  it('falls back for an unmapped country', async () => {
    expect((await fxService.resolveCurrency({ ipCountry: 'AQ' })).code).toBe('USD');
  });

  it('prefers an explicit request over geo detection', async () => {
    await Currency.create({ code: 'EUR', symbol: '€', enabled: true, autoRate: 0.92 });
    await Currency.create({ code: 'JPY', symbol: '¥', enabled: true, autoRate: 152 });
    expect((await fxService.resolveCurrency({ requested: 'EUR', ipCountry: 'JP' })).code).toBe('EUR');
  });

  it('returns a usable USD even with no currency table at all', async () => {
    await Currency.deleteMany({});
    const currency = await fxService.resolveCurrency({});
    expect(currency.code).toBe('USD');
    expect(currency.effectiveRate()).toBe(1);
  });
});

describe('quoting', () => {
  it('applies both the per-currency and the global markup', async () => {
    const eur = await Currency.create({
      code: 'EUR', symbol: '€', enabled: true, autoRate: 1, markupPct: 10,
      rounding: 'none', lastRateAt: new Date(),
    });
    await settingsService.update({ 'currency.globalMarkupPct': 10 });
    settingsService.clearCache();

    // 1.00 * 1.10 * 1.10 = 1.21
    const quote = await fxService.quote(1000, eur);
    expect(quote.rateUsed).toBeCloseTo(1.21, 6);
    expect(quote.display.minor).toBe(1210);
  });

  it('enforces a per-currency minimum charge', async () => {
    const c = await Currency.create({
      code: 'PHP', symbol: '₱', enabled: true, autoRate: 1, rounding: 'none',
      minChargeMinor: 5000, lastRateAt: new Date(),
    });
    expect((await fxService.quote(100, c)).display.minor).toBe(5000);
  });

  it('quotes USD without touching the rate machinery', async () => {
    const usd = await Currency.create({ code: 'USD', symbol: '$', enabled: true, autoRate: 1 });
    const quote = await fxService.quote(999, usd);
    expect(quote).toMatchObject({ isEstimate: false, rateUsed: 1, stale: false });
    expect(quote.settle).toEqual({ currency: 'USD', amountMinor: 999, decimals: 2 });
  });

  it('formats the display string with the symbol', async () => {
    const eur = await Currency.create({
      code: 'EUR', symbol: '€', enabled: true, autoRate: 0.92, rounding: 'charm_99', lastRateAt: new Date(),
    });
    expect((await fxService.quote(999, eur)).display.formatted).toMatch(/^€/);
  });

  it('falls back to USD when the rate is zero or missing', async () => {
    const broken = await Currency.create({ code: 'EUR', symbol: '€', enabled: true, autoRate: 0, lastRateAt: new Date() });
    const quote = await fxService.quote(999, broken);
    expect(quote.settle.currency).toBe('USD');
  });
});

describe('seeding and listing currencies', () => {
  it('seeds a starter table with USD enabled and nothing else', async () => {
    const { created } = await fxService.seedDefaults();
    expect(created).toBeGreaterThan(5);
    expect((await Currency.findOne({ code: 'USD' })).enabled).toBe(true);
    expect((await Currency.findOne({ code: 'INR' })).enabled).toBe(false);
  });

  it('sets settlement mode from real PayPal support', async () => {
    await fxService.seedDefaults();
    expect((await Currency.findOne({ code: 'EUR' })).settlementMode).toBe('local');
    expect((await Currency.findOne({ code: 'INR' })).settlementMode).toBe('usd');
    expect((await Currency.findOne({ code: 'IDR' })).paypalSupported).toBe(false);
  });

  it('is idempotent', async () => {
    await fxService.seedDefaults();
    expect((await fxService.seedDefaults()).created).toBe(0);
  });

  it('sanitizes an update that bypasses the document entirely', async () => {
    // A raw updateOne skips document validation, so the guards have to live on
    // the query too or an admin could persist a setting PayPal cannot honour.
    await Currency.create({ code: 'INR', symbol: '₹', enabled: true, autoRate: 83 });
    await Currency.updateOne({ code: 'INR' }, { settlementMode: 'local', decimals: 2 });

    const inr = await Currency.findOne({ code: 'INR' });
    expect(inr.settlementMode).toBe('usd');
    expect(inr.paypalSupported).toBe(false);
  });

  it('leaves a supported currency alone on update', async () => {
    await Currency.create({ code: 'EUR', symbol: '€', enabled: true, autoRate: 0.92 });
    await Currency.updateOne({ code: 'EUR' }, { settlementMode: 'local' });
    expect((await Currency.findOne({ code: 'EUR' })).settlementMode).toBe('local');
  });

  it('lists only enabled currencies with their settlement behaviour', async () => {
    await fxService.seedDefaults();
    await Currency.updateOne({ code: 'INR' }, { enabled: true });
    const list = await fxService.listEnabled();
    const codes = list.map((c) => c.code);
    expect(codes).toContain('USD');
    expect(codes).toContain('INR');
    expect(codes).not.toContain('EUR');
    expect(list.find((c) => c.code === 'INR').settlesLocally).toBe(false);
  });
});

describe('rate snapshots', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('records a successful fetch for the audit trail', async () => {
    await Currency.create({ code: 'EUR', enabled: true, autoRate: 0 });
    global.fetch = async () => ({ ok: true, json: async () => ({ rates: { EUR: 0.9 } }) });
    await fxService.refreshRates();

    const snap = await FxRateSnapshot.findOne({ ok: true });
    expect(snap.rates.get('EUR')).toBe(0.9);
  });

  it('records a failure with its reason', async () => {
    global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await fxService.refreshRates();
    const snap = await FxRateSnapshot.findOne({ ok: false });
    expect(snap.error).toContain('503');
  });
});

describe('rate limiting', () => {
  let token;
  let packId;

  beforeEach(async () => {
    ({ token } = await createUser());
    await Currency.create({ code: 'USD', symbol: '$', enabled: true, autoRate: 1, isDefault: true });
    const CreditPack = require('../src/models/CreditPack');
    const pack = await CreditPack.create({ name: 'P', slug: 'p', credits: 100, priceUsdCents: 999 });
    packId = pack._id;
    await settingsService.update({ 'monetization.enabled': true, 'store.enabled': true });
    settingsService.clearCache();
  });

  it('allows requests up to the configured limit then answers 429', async () => {
    await settingsService.update({ 'rateLimits.orderCreatePerMinute': 2 });
    settingsService.clearCache();

    // PayPal is unconfigured here, so order creation fails at the API call —
    // what matters is that the limiter counts attempts and eventually blocks.
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await api()
        .post('/api/store/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ packId });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 2).every((s) => s !== 429)).toBe(true);
  });

  it('returns a Retry-After header so a client can back off', async () => {
    await settingsService.update({ 'rateLimits.orderCreatePerMinute': 1 });
    settingsService.clearCache();
    await api().post('/api/store/orders').set('Authorization', `Bearer ${token}`).send({ packId });
    const blocked = await api()
      .post('/api/store/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ packId });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts each user separately', async () => {
    await settingsService.update({ 'rateLimits.orderCreatePerMinute': 1 });
    settingsService.clearCache();
    const other = (await createUser()).token;

    await api().post('/api/store/orders').set('Authorization', `Bearer ${token}`).send({ packId });
    const mine = await api().post('/api/store/orders').set('Authorization', `Bearer ${token}`).send({ packId });
    const theirs = await api().post('/api/store/orders').set('Authorization', `Bearer ${other}`).send({ packId });

    expect(mine.status).toBe(429);
    expect(theirs.status).not.toBe(429);
  });

  it('can be switched off entirely', async () => {
    await settingsService.update({ 'rateLimits.enabled': false, 'rateLimits.orderCreatePerMinute': 1 });
    settingsService.clearCache();
    for (let i = 0; i < 3; i += 1) {
      const res = await api().post('/api/store/orders').set('Authorization', `Bearer ${token}`).send({ packId });
      expect(res.status).not.toBe(429);
    }
  });

  it('never blocks traffic when settings cannot be read', async () => {
    const limiter = rateLimit.createLimiter('rateLimits.orderCreatePerMinute', 60000, 'probe');
    const snapshot = jest.spyOn(settingsService, 'snapshot').mockRejectedValue(new Error('db down'));
    const next = jest.fn();
    await limiter({ ip: '1.2.3.4', headers: {} }, {}, next);
    expect(next).toHaveBeenCalled();
    snapshot.mockRestore();
  });
});
