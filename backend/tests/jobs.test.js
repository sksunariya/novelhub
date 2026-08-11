const {
  trendingReset,
  fxRefresh,
  expireOrders,
  expireCredits,
  warnExpiringCredits,
  expireRentals,
  runScheduledGrants,
  reconcileLedger,
} = require('../src/jobs');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const fxService = require('../src/services/fxService');
const Novel = require('../src/models/Novel');
const Order = require('../src/models/Order');
const Wallet = require('../src/models/Wallet');
const Currency = require('../src/models/Currency');
const CreditBucket = require('../src/models/CreditBucket');
const CreditTransaction = require('../src/models/CreditTransaction');
const ChapterAccess = require('../src/models/ChapterAccess');
const Notification = require('../src/models/Notification');
const GrantCampaign = require('../src/models/GrantCampaign');
const JobRun = require('../src/models/JobRun');
const { createUser, createNovel, createChapter, createAdmin } = require('./helpers');
const { ORDER_STATUS } = require('../src/config/constants');

beforeEach(async () => {
  settingsService.clearCache();
  await settingsService.update({ 'monetization.enabled': true });
  settingsService.clearCache();
});

describe('trending.reset', () => {
  it('zeroes the rolling counter that trending ranks on', async () => {
    // Nothing reset weeklyViews before this job existed, which made Trending
    // an all-time counter wearing a different name.
    await createNovel({ slug: 'hot', weeklyViews: 500 });
    await createNovel({ slug: 'warm', weeklyViews: 3 });
    await createNovel({ slug: 'cold', weeklyViews: 0 });

    const result = await trendingReset.run();
    expect(result.novelsReset).toBe(2);
    expect((await Novel.findOne({ slug: 'hot' })).weeklyViews).toBe(0);
    expect((await Novel.findOne({ slug: 'warm' })).weeklyViews).toBe(0);
  });

  it('leaves all-time views untouched', async () => {
    await createNovel({ slug: 'n', views: 900, weeklyViews: 100 });
    await trendingReset.run();
    expect((await Novel.findOne({ slug: 'n' })).views).toBe(900);
  });

  it('is safe to run twice', async () => {
    await createNovel({ slug: 'n', weeklyViews: 10 });
    await trendingReset.run();
    expect((await trendingReset.run()).novelsReset).toBe(0);
  });
});

describe('fx.refresh', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('updates rates from the provider', async () => {
    await Currency.create({ code: 'USD', enabled: true, autoRate: 1 });
    await Currency.create({ code: 'EUR', enabled: true, autoRate: 0 });
    global.fetch = async () => ({ ok: true, json: async () => ({ rates: { EUR: 0.92, GBP: 0.79 } }) });

    const result = await fxRefresh.run();
    expect(result.ok).toBe(true);
    const eur = await Currency.findOne({ code: 'EUR' });
    expect(eur.autoRate).toBe(0.92);
    expect(eur.lastRateAt).toBeInstanceOf(Date);
  });

  it('always pins USD to 1 regardless of the payload', async () => {
    await Currency.create({ code: 'USD', enabled: true, autoRate: 0 });
    global.fetch = async () => ({ ok: true, json: async () => ({ rates: { USD: 42 } }) });
    await fxRefresh.run();
    expect((await Currency.findOne({ code: 'USD' })).autoRate).toBe(1);
  });

  it('keeps the last known rate when the provider is down', async () => {
    const before = new Date(Date.now() - 3600e3);
    await Currency.create({ code: 'EUR', enabled: true, autoRate: 0.9, lastRateAt: before });
    global.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };

    const result = await fxRefresh.run();
    expect(result.ok).toBe(false);
    // A provider outage must never blank the rates and break the store.
    const eur = await Currency.findOne({ code: 'EUR' });
    expect(eur.autoRate).toBe(0.9);
  });

  it('rejects an unrecognised response shape rather than writing nonsense', async () => {
    await Currency.create({ code: 'EUR', enabled: true, autoRate: 0.9 });
    global.fetch = async () => ({ ok: true, json: async () => ({ unexpected: true }) });
    const result = await fxRefresh.run();
    expect(result.ok).toBe(false);
    expect((await Currency.findOne({ code: 'EUR' })).autoRate).toBe(0.9);
  });

  it('ignores a non-numeric or negative rate', async () => {
    await Currency.create({ code: 'EUR', enabled: true, autoRate: 0.9 });
    global.fetch = async () => ({ ok: true, json: async () => ({ rates: { EUR: -1 } }) });
    await fxRefresh.run();
    expect((await Currency.findOne({ code: 'EUR' })).autoRate).toBe(0.9);
  });

  it('accepts the conversion_rates shape some providers use', async () => {
    await Currency.create({ code: 'EUR', enabled: true, autoRate: 0 });
    global.fetch = async () => ({ ok: true, json: async () => ({ conversion_rates: { EUR: 0.88 } }) });
    await fxRefresh.run();
    expect((await Currency.findOne({ code: 'EUR' })).autoRate).toBe(0.88);
  });
});

describe('orders.expire', () => {
  const makeOrder = (over = {}) =>
    Order.create({
      orderNumber: `NH-2026-${Math.random().toString().slice(2, 9)}`,
      user: over.user,
      credits: 100,
      totalCredits: 100,
      baseUsdCents: 999,
      netUsdCents: 999,
      chargeCurrency: 'USD',
      chargeAmountMinor: 999,
      status: ORDER_STATUS.CREATED,
      quoteExpiresAt: new Date(Date.now() - 1000),
      ...over,
    });

  it('expires orders past their price lock', async () => {
    const { user } = await createUser();
    await makeOrder({ user: user._id });
    expect((await expireOrders.run()).expired).toBe(1);
  });

  it('leaves a live quote alone', async () => {
    const { user } = await createUser();
    await makeOrder({ user: user._id, quoteExpiresAt: new Date(Date.now() + 60000) });
    expect((await expireOrders.run()).expired).toBe(0);
  });

  it('never touches a captured order', async () => {
    const { user } = await createUser();
    const order = await makeOrder({ user: user._id, status: ORDER_STATUS.CAPTURED });
    await expireOrders.run();
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS.CAPTURED);
  });
});

describe('credits.expire', () => {
  it('does nothing while expiry is switched off', async () => {
    expect((await expireCredits.run()).skipped).toBe(true);
  });

  it('zeroes lapsed tranches and debits the wallet', async () => {
    await settingsService.update({ 'expiry.enabled': true });
    settingsService.clearCache();
    const { user } = await createUser();
    await creditService.credit({
      user, amount: 100, idempotencyKey: 'g1', expiresAt: new Date(Date.now() - 1000),
    });

    const result = await expireCredits.run();
    expect(result).toMatchObject({ buckets: 1, credits: 100 });
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(0);
    expect((await Wallet.findOne({ user: user._id })).lifetimeExpired).toBe(100);
  });

  it('writes a ledger row so the balance stays reproducible', async () => {
    await settingsService.update({ 'expiry.enabled': true });
    settingsService.clearCache();
    const { user } = await createUser();
    await creditService.credit({ user, amount: 50, idempotencyKey: 'g', expiresAt: new Date(Date.now() - 1) });
    await expireCredits.run();

    const row = await CreditTransaction.findOne({ type: 'expire' });
    expect(row.amount).toBe(-50);
    expect((await creditService.reconcile()).drift).toHaveLength(0);
  });

  it('leaves unexpired and never-expiring credits alone', async () => {
    await settingsService.update({ 'expiry.enabled': true });
    settingsService.clearCache();
    const { user } = await createUser();
    await creditService.credit({ user, amount: 30, idempotencyKey: 'never' });
    await creditService.credit({ user, amount: 20, idempotencyKey: 'later', expiresAt: new Date(Date.now() + 864e5) });

    expect((await expireCredits.run()).credits).toBe(0);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(50);
  });

  it('reports forfeited cash separately from revenue', async () => {
    await settingsService.update({ 'expiry.enabled': true });
    settingsService.clearCache();
    const { user } = await createUser();
    // Paid credits that lapse are money kept with no content delivered.
    await creditService.credit({
      user, amount: 1200, type: 'purchase', source: 'purchase', costUsdCents: 999,
      idempotencyKey: 'p', expiresAt: new Date(Date.now() - 1),
    });
    const result = await expireCredits.run();
    expect(result.forfeitedUsdCents).toBe(999);
  });

  it('is idempotent across runs', async () => {
    await settingsService.update({ 'expiry.enabled': true });
    settingsService.clearCache();
    const { user } = await createUser();
    await creditService.credit({ user, amount: 40, idempotencyKey: 'g', expiresAt: new Date(Date.now() - 1) });
    await expireCredits.run();
    await expireCredits.run();
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(0);
    expect(await CreditTransaction.countDocuments({ type: 'expire' })).toBe(1);
  });
});

describe('credits.expiryWarning', () => {
  it('skips when expiry or warnings are off', async () => {
    expect((await warnExpiringCredits.run()).skipped).toBe(true);
    await settingsService.update({ 'expiry.enabled': true, 'expiry.warnDaysBefore': 0 });
    settingsService.clearCache();
    expect((await warnExpiringCredits.run()).skipped).toBe(true);
  });

  it('notifies holders of credits lapsing inside the window', async () => {
    await settingsService.update({ 'expiry.enabled': true, 'expiry.warnDaysBefore': 7 });
    settingsService.clearCache();
    const { user } = await createUser();
    await creditService.credit({
      user, amount: 60, idempotencyKey: 'soon', expiresAt: new Date(Date.now() + 3 * 864e5),
    });

    expect((await warnExpiringCredits.run()).notified).toBe(1);
    const note = await Notification.findOne({ user: user._id, type: 'credits_expiring' });
    expect(note.message).toContain('60');
  });

  it('ignores credits expiring beyond the window', async () => {
    await settingsService.update({ 'expiry.enabled': true, 'expiry.warnDaysBefore': 7 });
    settingsService.clearCache();
    const { user } = await createUser();
    await creditService.credit({
      user, amount: 60, idempotencyKey: 'far', expiresAt: new Date(Date.now() + 60 * 864e5),
    });
    expect((await warnExpiringCredits.run()).notified).toBe(0);
  });

  it('sums a user\'s expiring tranches into one warning', async () => {
    await settingsService.update({ 'expiry.enabled': true, 'expiry.warnDaysBefore': 7 });
    settingsService.clearCache();
    const { user } = await createUser();
    await creditService.credit({ user, amount: 10, idempotencyKey: 'a', expiresAt: new Date(Date.now() + 864e5) });
    await creditService.credit({ user, amount: 15, idempotencyKey: 'b', expiresAt: new Date(Date.now() + 2 * 864e5) });

    expect((await warnExpiringCredits.run()).notified).toBe(1);
    expect((await Notification.findOne({ type: 'credits_expiring' })).message).toContain('25');
  });
});

describe('rentals.expire', () => {
  it('removes lapsed rentals and keeps permanent unlocks', async () => {
    const { user } = await createUser();
    const novel = await createNovel({ slug: 'r' });
    const a = await createChapter(novel, { number: 1 });
    const b = await createChapter(novel, { number: 2 });

    await ChapterAccess.create({
      user: user._id, chapter: a._id, novel: novel._id, expiresAt: new Date(Date.now() - 1000),
    });
    await ChapterAccess.create({ user: user._id, chapter: b._id, novel: novel._id, expiresAt: null });

    expect((await expireRentals.run()).expired).toBe(1);
    expect(await ChapterAccess.countDocuments()).toBe(1);
    expect(await ChapterAccess.findOne({ chapter: b._id })).not.toBeNull();
  });

  it('keeps a rental that has not lapsed', async () => {
    const { user } = await createUser();
    const novel = await createNovel({ slug: 'r2' });
    const chapter = await createChapter(novel, { number: 1 });
    await ChapterAccess.create({
      user: user._id, chapter: chapter._id, novel: novel._id, expiresAt: new Date(Date.now() + 3600e3),
    });
    expect((await expireRentals.run()).expired).toBe(0);
  });
});

describe('grants.scheduled', () => {
  it('runs a campaign whose time has come', async () => {
    const { user: admin } = await createAdmin();
    const { user } = await createUser();
    await GrantCampaign.create({
      name: 'Scheduled gift',
      amount: 25,
      audience: { mode: 'all' },
      schedule: { mode: 'scheduled', runAt: new Date(Date.now() - 1000) },
      status: 'scheduled',
      notify: { enabled: false },
      createdBy: admin._id,
      // Scheduling a campaign implies it was reviewed; the dry-run gate is on
      // by default and would otherwise refuse to execute it.
      lastDryRunAt: new Date(),
    });

    const result = await runScheduledGrants.run();
    expect(result.due).toBe(1);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(25);
  });

  it('leaves a future campaign alone', async () => {
    const { user: admin } = await createAdmin();
    await GrantCampaign.create({
      name: 'Later',
      amount: 25,
      audience: { mode: 'all' },
      schedule: { mode: 'scheduled', runAt: new Date(Date.now() + 864e5) },
      status: 'scheduled',
      createdBy: admin._id,
    });
    expect((await runScheduledGrants.run()).due).toBe(0);
  });

  it('resumes a campaign a crashed instance left running', async () => {
    const { user: admin } = await createAdmin();
    const { user } = await createUser();
    const campaign = await GrantCampaign.create({
      name: 'Interrupted',
      amount: 40,
      audience: { mode: 'all' },
      status: 'running',
      notify: { enabled: false },
      createdBy: admin._id,
      lastDryRunAt: new Date(),
    });
    // Backdate so the stalled-campaign sweep picks it up.
    await GrantCampaign.collection.updateOne(
      { _id: campaign._id },
      { $set: { updatedAt: new Date(Date.now() - 20 * 60 * 1000) } }
    );

    const result = await runScheduledGrants.run();
    expect(result.resumed).toBe(1);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(40);
  });
});

describe('ledger.reconcile', () => {
  it('reports a clean ledger', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 100, idempotencyKey: 'a' });
    const result = await reconcileLedger.run();
    expect(result.driftCount).toBe(0);
  });

  it('detects a corrupted wallet without repairing it', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 100, idempotencyKey: 'a' });
    await Wallet.updateOne({ user: user._id }, { $set: { balance: 4242 } });

    const result = await reconcileLedger.run();
    expect(result.driftCount).toBe(1);
    expect(result.drift[0]).toMatchObject({ walletBalance: 4242, ledgerBalance: 100 });
    // Reporting, not silent self-correction — the cause matters.
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(4242);
  });
});

describe('job result recording', () => {
  it('stores the summary a job returns', async () => {
    const scheduler = require('../src/services/schedulerService');
    scheduler.registry.clear();
    scheduler.register(trendingReset);
    await createNovel({ slug: 'x', weeklyViews: 5 });

    await scheduler.runJob('trending.reset', { trigger: 'manual' });
    const run = await JobRun.findOne({ job: 'trending.reset' });
    expect(run.status).toBe('success');
    expect(run.result.novelsReset).toBe(1);
  });
});
