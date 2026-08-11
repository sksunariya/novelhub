const { api, createAdmin, createUser } = require('./helpers');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const CreditPack = require('../src/models/CreditPack');
const Currency = require('../src/models/Currency');
const PricingRule = require('../src/models/PricingRule');
const Wallet = require('../src/models/Wallet');
const AdminAuditLog = require('../src/models/AdminAuditLog');
const Notification = require('../src/models/Notification');

let adminToken;

beforeEach(async () => {
  settingsService.clearCache();
  ({ token: adminToken } = await createAdmin());
  await settingsService.update({ 'monetization.enabled': true, 'store.enabled': true });
  settingsService.clearCache();
});

const auth = (req) => req.set('Authorization', `Bearer ${adminToken}`);

describe('credit packs', () => {
  it('creates a pack and makes the store non-empty', async () => {
    await Currency.create({ code: 'USD', symbol: '$', enabled: true, autoRate: 1, isDefault: true });

    // Before: nothing to sell.
    expect((await api().get('/api/store/packs').expect(200)).body.packs).toHaveLength(0);

    await auth(api().post('/api/admin/monetization/packs'))
      .send({ name: 'Starter', credits: 1000, bonusCredits: 200, priceUsdCents: 999 })
      .expect(201);

    const store = await api().get('/api/store/packs').expect(200);
    expect(store.body.packs).toHaveLength(1);
    expect(store.body.packs[0].totalCredits).toBe(1200);
  });

  it('validates required fields', async () => {
    await auth(api().post('/api/admin/monetization/packs')).send({ name: 'Broken' }).expect(400);
  });

  it('shows the effective credits-per-dollar so tiers can be compared', async () => {
    await auth(api().post('/api/admin/monetization/packs'))
      .send({ name: 'Bulk', credits: 1000, bonusCredits: 200, priceUsdCents: 999 })
      .expect(201);
    const res = await auth(api().get('/api/admin/monetization/packs')).expect(200);
    // 1200 credits for $9.99 is ~120/USD against a 100/USD baseline.
    expect(res.body.packs[0].effectiveCreditsPerUsd).toBeCloseTo(120.1, 0);
    expect(res.body.packs[0].baselineCreditsPerUsd).toBe(100);
  });

  it('updates and audits a price change', async () => {
    const created = await auth(api().post('/api/admin/monetization/packs'))
      .send({ name: 'Starter', credits: 500, priceUsdCents: 499 })
      .expect(201);

    const res = await auth(api().put(`/api/admin/monetization/packs/${created.body.pack._id}`))
      .send({ priceUsdCents: 599 })
      .expect(200);
    expect(res.body.pack.priceUsdCents).toBe(599);

    const entry = await AdminAuditLog.findOne({ action: 'pack.update' });
    expect(entry.changes[0]).toMatchObject({ key: 'priceUsdCents', before: 499, after: 599 });
  });

  it('soft-deletes so existing orders still resolve', async () => {
    const created = await auth(api().post('/api/admin/monetization/packs'))
      .send({ name: 'Gone', credits: 100, priceUsdCents: 199 })
      .expect(201);
    await auth(api().delete(`/api/admin/monetization/packs/${created.body.pack._id}`)).expect(200);

    expect(await CreditPack.countDocuments()).toBe(0);
    expect(await CreditPack.countDocuments().setOptions({ withDeleted: true })).toBe(1);
  });

  it('reorders packs', async () => {
    const a = await auth(api().post('/api/admin/monetization/packs')).send({ name: 'A', credits: 1, priceUsdCents: 100 });
    const b = await auth(api().post('/api/admin/monetization/packs')).send({ name: 'B', credits: 2, priceUsdCents: 200 });
    await auth(api().put('/api/admin/monetization/packs/reorder'))
      .send({ order: [b.body.pack._id, a.body.pack._id] })
      .expect(200);
    expect((await CreditPack.findById(b.body.pack._id)).sortOrder).toBe(0);
  });
});

describe('currencies', () => {
  it('seeds a starting table', async () => {
    const res = await auth(api().post('/api/admin/monetization/currencies/seed')).expect(200);
    expect(res.body.created).toBeGreaterThan(5);
    expect(await Currency.countDocuments()).toBeGreaterThan(5);
  });

  it('explains why local settlement was refused for an unsupported currency', async () => {
    const res = await auth(api().put('/api/admin/monetization/currencies/INR'))
      .send({ name: 'Indian Rupee', symbol: '₹', enabled: true, settlementMode: 'local', manualRate: 83 })
      .expect(200);

    expect(res.body.currency.settlementMode).toBe('usd');
    expect(res.body.notes[0]).toMatch(/PayPal cannot settle in INR/);
  });

  it('accepts local settlement for a supported currency', async () => {
    const res = await auth(api().put('/api/admin/monetization/currencies/EUR'))
      .send({ name: 'Euro', symbol: '€', enabled: true, settlementMode: 'local' })
      .expect(200);
    expect(res.body.currency.settlementMode).toBe('local');
    expect(res.body.notes).toHaveLength(0);
  });

  it('forces zero decimals for JPY and says so', async () => {
    const res = await auth(api().put('/api/admin/monetization/currencies/JPY'))
      .send({ name: 'Yen', symbol: '¥', enabled: true, decimals: 2 })
      .expect(200);
    expect(res.body.currency.decimals).toBe(0);
    expect(res.body.notes.join(' ')).toMatch(/does not support decimal/);
  });

  it('rejects a malformed code', async () => {
    await auth(api().put('/api/admin/monetization/currencies/EUROS')).send({ name: 'x' }).expect(400);
  });

  it('previews what a pack costs in each currency', async () => {
    await auth(api().post('/api/admin/monetization/packs')).send({ name: 'P', credits: 100, priceUsdCents: 999 });
    await auth(api().put('/api/admin/monetization/currencies/EUR'))
      .send({ name: 'Euro', symbol: '€', enabled: true, rateSource: 'manual', manualRate: 0.92 });

    const res = await auth(api().get('/api/admin/monetization/currencies')).expect(200);
    const eur = res.body.currencies.find((c) => c.code === 'EUR');
    expect(eur.preview.formatted).toMatch(/€/);
    expect(res.body.samplePack).toBe('P');
  });

  it('keeps only one default currency', async () => {
    await auth(api().put('/api/admin/monetization/currencies/USD')).send({ name: 'USD', isDefault: true });
    await auth(api().put('/api/admin/monetization/currencies/EUR')).send({ name: 'EUR', isDefault: true });
    expect(await Currency.countDocuments({ isDefault: true })).toBe(1);
  });
});

describe('pricing rules', () => {
  it('creates a rule that changes resolved prices', async () => {
    await auth(api().post('/api/admin/monetization/pricing-rules'))
      .send({
        name: 'Old chapters half price',
        priority: 10,
        scope: 'global',
        conditions: { chapterAgeDaysFrom: 90 },
        action: { mode: 'multiply', multiplier: 0.5 },
      })
      .expect(201);
    expect(await PricingRule.countDocuments()).toBe(1);
  });

  it('lists rules by priority', async () => {
    await auth(api().post('/api/admin/monetization/pricing-rules')).send({ name: 'Low', priority: 1 });
    await auth(api().post('/api/admin/monetization/pricing-rules')).send({ name: 'High', priority: 9 });
    const res = await auth(api().get('/api/admin/monetization/pricing-rules')).expect(200);
    expect(res.body.rules[0].name).toBe('High');
  });

  it('deletes a rule', async () => {
    const created = await auth(api().post('/api/admin/monetization/pricing-rules')).send({ name: 'Temp' });
    await auth(api().delete(`/api/admin/monetization/pricing-rules/${created.body.rule._id}`)).expect(200);
    expect(await PricingRule.countDocuments()).toBe(0);
  });
});

describe('wallet administration', () => {
  it('lists wallets sorted by balance', async () => {
    const { user: rich } = await createUser();
    const { user: poor } = await createUser();
    await creditService.credit({ user: rich, amount: 900, idempotencyKey: 'a' });
    await creditService.credit({ user: poor, amount: 10, idempotencyKey: 'b' });

    const res = await auth(api().get('/api/admin/monetization/wallets')).expect(200);
    expect(res.body.wallets[0].balance).toBe(900);
    expect(res.body.wallets[0].user.username).toBeDefined();
  });

  it('shows a wallet with its ledger and unspent value', async () => {
    const { user } = await createUser();
    await creditService.credit({
      user, amount: 1200, type: 'purchase', source: 'purchase', costUsdCents: 999, idempotencyKey: 'pack',
    });

    const res = await auth(api().get(`/api/admin/monetization/wallets/${user._id}`)).expect(200);
    expect(res.body.wallet.balance).toBe(1200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.unspentValueUsdCents).toBe(999);
  });

  it('adjusts a balance up and notifies the user', async () => {
    const { user } = await createUser();
    const res = await auth(api().post(`/api/admin/monetization/wallets/${user._id}/adjust`))
      .send({ amount: 250, reason: 'goodwill after a support issue' })
      .expect(200);

    expect(res.body.balance).toBe(250);
    expect(await Notification.countDocuments({ user: user._id, type: 'credits_granted' })).toBe(1);
  });

  it('adjusts a balance down', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 100, idempotencyKey: 'seed' });
    const res = await auth(api().post(`/api/admin/monetization/wallets/${user._id}/adjust`))
      .send({ amount: -40, reason: 'correcting a duplicate grant' })
      .expect(200);
    expect(res.body.balance).toBe(60);
  });

  it('demands a reason', async () => {
    const { user } = await createUser();
    await auth(api().post(`/api/admin/monetization/wallets/${user._id}/adjust`))
      .send({ amount: 100 })
      .expect(400);
  });

  it('rejects a zero or fractional amount', async () => {
    const { user } = await createUser();
    await auth(api().post(`/api/admin/monetization/wallets/${user._id}/adjust`))
      .send({ amount: 0, reason: 'x' })
      .expect(400);
    await auth(api().post(`/api/admin/monetization/wallets/${user._id}/adjust`))
      .send({ amount: 1.5, reason: 'x' })
      .expect(400);
  });

  it('enforces the adjustment cap', async () => {
    await settingsService.update({ 'safety.maxManualAdjustmentCredits': 100 });
    settingsService.clearCache();
    const { user } = await createUser();
    await auth(api().post(`/api/admin/monetization/wallets/${user._id}/adjust`))
      .send({ amount: 5000, reason: 'too much' })
      .expect(403);
  });

  it('audits every adjustment with its reason', async () => {
    const { user } = await createUser();
    await auth(api().post(`/api/admin/monetization/wallets/${user._id}/adjust`))
      .send({ amount: 75, reason: 'compensation for downtime' })
      .expect(200);

    const entry = await AdminAuditLog.findOne({ action: 'wallet.adjust' });
    expect(entry.note).toBe('compensation for downtime');
    expect(entry.changes[0]).toMatchObject({ before: 0, after: 75 });
  });
});

describe('notification templates', () => {
  it('lists every credit event with its defaults', async () => {
    const res = await auth(api().get('/api/admin/monetization/templates')).expect(200);
    const granted = res.body.templates.find((t) => t.key === 'credits_granted');
    expect(granted.channels).toHaveLength(2);
    expect(granted.channels[0].isDefault).toBe(true);
    expect(granted.channels[0].subject).toContain('{{amount}}');
  });

  it('saves edited copy and switches a channel off', async () => {
    await auth(api().put('/api/admin/monetization/templates/credits_granted/email'))
      .send({ enabled: false, subject: 'Custom subject' })
      .expect(200);

    const res = await auth(api().get('/api/admin/monetization/templates')).expect(200);
    const email = res.body.templates
      .find((t) => t.key === 'credits_granted')
      .channels.find((c) => c.channel === 'email');
    expect(email.enabled).toBe(false);
    expect(email.subject).toBe('Custom subject');
    expect(email.isDefault).toBe(false);
  });
});

describe('access control', () => {
  it('blocks non-admins from every monetization route', async () => {
    const { token } = await createUser();
    const paths = [
      '/api/admin/monetization/packs',
      '/api/admin/monetization/currencies',
      '/api/admin/monetization/wallets',
      '/api/admin/monetization/orders',
      '/api/admin/monetization/grants',
    ];
    for (const path of paths) {
      await api().get(path).set('Authorization', `Bearer ${token}`).expect(403);
      await api().get(path).expect(401);
    }
  });
});
