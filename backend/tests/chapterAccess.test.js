const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const accessService = require('../src/services/accessService');
const ChapterAccess = require('../src/models/ChapterAccess');
const CreditTransaction = require('../src/models/CreditTransaction');
const Wallet = require('../src/models/Wallet');
const Chapter = require('../src/models/Chapter');
const { CREDIT_TRANSACTION_TYPES, CREDIT_SOURCES, GATE_REASONS } = require('../src/config/constants');

let novel;
let user;
let token;

const enableMonetization = () =>
  settingsService
    .update({
      'monetization.enabled': true,
      'pricing.defaultChapterCredits': 10,
      'pricing.defaultFreeChapterCount': 2,
    })
    .then(() => settingsService.clearCache());

const giveCredits = (amount, cash = 0) =>
  creditService.credit({
    user,
    amount,
    type: cash ? CREDIT_TRANSACTION_TYPES.PURCHASE : CREDIT_TRANSACTION_TYPES.GRANT,
    source: cash ? CREDIT_SOURCES.PURCHASE : CREDIT_SOURCES.GRANT,
    costUsdCents: cash,
    idempotencyKey: `seed:${Date.now()}:${Math.random()}`,
  });

beforeEach(async () => {
  settingsService.clearCache();
  novel = await createNovel({ slug: 'gate-novel' });
  ({ user, token } = await createUser());
  for (let n = 1; n <= 6; n += 1) {
    await createChapter(novel, { number: n, title: `Chapter ${n}` });
  }
  await enableMonetization();
});

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

describe('reading a gated chapter', () => {
  it('serves free chapters within the quota', async () => {
    const res = await api().get('/api/novels/gate-novel/chapters/1').expect(200);
    expect(res.body.chapter.content).toBeDefined();
  });

  it('withholds content and quotes a price on a paid chapter', async () => {
    const res = await api().get('/api/novels/gate-novel/chapters/3').expect(403);
    expect(res.body.gate).toMatchObject({ locked: true, reason: GATE_REASONS.CREDITS, priceCredits: 10 });
    expect(res.body.chapter.content).toBeUndefined();
  });

  it('reports affordability for a signed-in reader', async () => {
    await giveCredits(50);
    const res = await auth(api().get('/api/novels/gate-novel/chapters/3')).expect(403);
    expect(res.body.gate).toMatchObject({ balance: 50, canAfford: true });
  });

  it('serves the chapter once unlocked', async () => {
    await giveCredits(50);
    await auth(api().post('/api/novels/gate-novel/chapters/3/unlock')).expect(201);
    const res = await auth(api().get('/api/novels/gate-novel/chapters/3')).expect(200);
    expect(res.body.chapter.content).toBeDefined();
  });

  it('frees everything when the kill switch is off', async () => {
    await settingsService.update({ 'monetization.enabled': false });
    settingsService.clearCache();
    const res = await api().get('/api/novels/gate-novel/chapters/6').expect(200);
    expect(res.body.chapter.content).toBeDefined();
  });

  it('blocks a chapter inside its early-access window without quoting a price', async () => {
    await Chapter.updateOne(
      { novel: novel._id, number: 4 },
      { earlyAccessUntil: new Date(Date.now() + 60 * 60 * 1000) }
    );
    const res = await auth(api().get('/api/novels/gate-novel/chapters/4')).expect(403);
    expect(res.body.gate.reason).toBe(GATE_REASONS.EARLY_ACCESS);
    expect(res.body.gate.availableAt).toBeDefined();
  });

  it('never ships the private source file key', async () => {
    await Chapter.updateOne(
      { novel: novel._id, number: 1 },
      { sourceFile: { key: 'private/secret-key.docx', name: 'ch1.docx' } }
    );
    const res = await api().get('/api/novels/gate-novel/chapters/1').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('private/secret-key.docx');
    expect(res.body.chapter.sourceFile).toBeUndefined();
  });
});

describe('unlocking', () => {
  it('spends credits and records ownership', async () => {
    await giveCredits(50);
    const res = await auth(api().post('/api/novels/gate-novel/chapters/3/unlock')).expect(201);
    expect(res.body).toMatchObject({ alreadyOwned: false, spent: 10, balance: 40 });

    const chapter = await Chapter.findOne({ novel: novel._id, number: 3 });
    const access = await ChapterAccess.findOne({ user: user._id, chapter: chapter._id });
    expect(access.creditsSpent).toBe(10);
  });

  it('refuses when the balance is short', async () => {
    await giveCredits(5);
    await auth(api().post('/api/novels/gate-novel/chapters/3/unlock')).expect(402);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(5);
  });

  it('refuses to charge for a free chapter', async () => {
    await giveCredits(50);
    await auth(api().post('/api/novels/gate-novel/chapters/1/unlock')).expect(409);
  });

  it('is idempotent when called twice', async () => {
    await giveCredits(50);
    await auth(api().post('/api/novels/gate-novel/chapters/3/unlock')).expect(201);
    const again = await auth(api().post('/api/novels/gate-novel/chapters/3/unlock')).expect(200);
    expect(again.body.alreadyOwned).toBe(true);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(40);
  });

  it('charges once when unlocked concurrently', async () => {
    await giveCredits(50);
    await Promise.allSettled([
      auth(api().post('/api/novels/gate-novel/chapters/3/unlock')),
      auth(api().post('/api/novels/gate-novel/chapters/3/unlock')),
      auth(api().post('/api/novels/gate-novel/chapters/3/unlock')),
    ]);
    const chapter = await Chapter.findOne({ novel: novel._id, number: 3 });
    expect(await ChapterAccess.countDocuments({ user: user._id, chapter: chapter._id })).toBe(1);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(40);
  });

  it('requires authentication', async () => {
    await api().post('/api/novels/gate-novel/chapters/3/unlock').expect(401);
  });

  it('attributes real cash on a paid-credit unlock and nothing on a granted one', async () => {
    await giveCredits(1200, 999); // $9.99 pack
    await auth(api().post('/api/novels/gate-novel/chapters/3/unlock')).expect(201);
    const paid = await CreditTransaction.findOne({ user: user._id, type: CREDIT_TRANSACTION_TYPES.SPEND });
    expect(paid.attributedUsdMicros).toBe(83250);

    const { user: other, token: otherToken } = await createUser();
    await creditService.credit({ user: other, amount: 50, idempotencyKey: 'free-only' });
    await api()
      .post('/api/novels/gate-novel/chapters/3/unlock')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(201);
    const granted = await CreditTransaction.findOne({ user: other._id, type: CREDIT_TRANSACTION_TYPES.SPEND });
    expect(granted.attributedUsdMicros).toBe(0);
  });

  it('rolls lifetime revenue up to the chapter and novel', async () => {
    await giveCredits(1200, 999);
    await auth(api().post('/api/novels/gate-novel/chapters/3/unlock')).expect(201);
    // Earnings are select:false so they never reach a public response; an
    // admin-side read has to ask for them explicitly.
    const chapter = await Chapter.findOne({ novel: novel._id, number: 3 }).select(
      '+revenueLifetimeUsdMicros'
    );
    expect(chapter.revenueLifetimeUsdMicros).toBe(83250);
  });
});

describe('bulk unlock', () => {
  it('quotes without charging', async () => {
    await giveCredits(500);
    const res = await auth(api().post('/api/novels/gate-novel/unlock-bulk'))
      .send({ all: true })
      .expect(200);
    expect(res.body.chapterCount).toBe(4); // chapters 3-6; 1-2 are free
    expect(res.body.listTotal).toBe(40);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(500);
  });

  it('applies the discount tier and charges once', async () => {
    await settingsService.update({
      'pricing.bulkDiscountTiers': [{ minChapters: 4, discountPct: 25 }],
    });
    settingsService.clearCache();
    await giveCredits(500);

    const res = await auth(api().post('/api/novels/gate-novel/unlock-bulk'))
      .send({ all: true, commit: true })
      .expect(201);
    expect(res.body).toMatchObject({ unlocked: 4, listTotal: 40, discountPct: 25, spent: 30 });
    expect(res.body.balance).toBe(470);
    expect(await ChapterAccess.countDocuments({ user: user._id })).toBe(4);
  });

  it('splits attributed cash pro-rata so the parts sum to the debit', async () => {
    await giveCredits(1200, 999);
    await auth(api().post('/api/novels/gate-novel/unlock-bulk')).send({ all: true, commit: true }).expect(201);

    const spend = await CreditTransaction.findOne({ user: user._id, type: CREDIT_TRANSACTION_TYPES.SPEND });
    const rows = await ChapterAccess.find({ user: user._id });
    const summed = rows.reduce((total, row) => total + row.attributedUsdMicros, 0);
    expect(summed).toBe(spend.attributedUsdMicros);
  });

  it('rejects a selection with nothing payable', async () => {
    await giveCredits(500);
    await auth(api().post('/api/novels/gate-novel/unlock-bulk'))
      .send({ chapterNumbers: [1, 2], commit: true })
      .expect(409);
  });

  it('can be disabled by the admin', async () => {
    await settingsService.update({ 'pricing.allowBulkUnlock': false });
    settingsService.clearCache();
    await giveCredits(500);
    await auth(api().post('/api/novels/gate-novel/unlock-bulk')).send({ all: true, commit: true }).expect(403);
  });
});

describe('chapter list access state', () => {
  it('marks free, locked and owned chapters', async () => {
    await giveCredits(50);
    await auth(api().post('/api/novels/gate-novel/chapters/3/unlock')).expect(201);

    const res = await auth(api().get('/api/novels/gate-novel/chapters')).expect(200);
    const byNumber = Object.fromEntries(res.body.chapters.map((c) => [c.number, c]));
    expect(byNumber[1]).toMatchObject({ free: true, locked: false, priceCredits: 0 });
    expect(byNumber[3]).toMatchObject({ owned: true, locked: false });
    expect(byNumber[4]).toMatchObject({ locked: true, priceCredits: 10 });
  });

  it('is paginated', async () => {
    const res = await api().get('/api/novels/gate-novel/chapters?limit=2&page=1').expect(200);
    expect(res.body.chapters).toHaveLength(2);
    expect(res.body.total).toBe(6);
    expect(res.body.pages).toBe(3);
  });
});

describe('wallet endpoints', () => {
  it('returns the balance with the configured label', async () => {
    await settingsService.update({ 'credits.labelPlural': 'Gems' });
    settingsService.clearCache();
    await giveCredits(120);
    const res = await auth(api().get('/api/wallet')).expect(200);
    expect(res.body.wallet).toMatchObject({ balance: 120, label: 'Gems' });
  });

  it('lists transaction history', async () => {
    await giveCredits(50);
    await auth(api().post('/api/novels/gate-novel/chapters/3/unlock')).expect(201);
    const res = await auth(api().get('/api/wallet/transactions')).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.transactions[0].amount).toBe(-10);
    // internal cost basis is not exposed to the reader
    expect(res.body.transactions[0].attributedUsdMicros).toBeUndefined();
  });

  it('clamps auto-unlock to the admin ceiling', async () => {
    await settingsService.update({ 'pricing.autoUnlockMaxCredits': 25 });
    settingsService.clearCache();
    const res = await auth(api().put('/api/wallet/auto-unlock'))
      .send({ enabled: true, maxPriceCredits: 9999 })
      .expect(200);
    expect(res.body.autoUnlock.maxPriceCredits).toBe(25);
  });
});

describe('deleting purchased content', () => {
  let adminToken;

  beforeEach(async () => {
    ({ token: adminToken } = await createAdmin());
    await giveCredits(50);
    await auth(api().post('/api/novels/gate-novel/chapters/3/unlock')).expect(201);
  });

  it('refuses to delete a chapter someone paid for', async () => {
    const chapter = await Chapter.findOne({ novel: novel._id, number: 3 });
    const res = await api()
      .delete(`/api/admin/chapters/${chapter._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(res.body.message).toMatch(/1 purchase/);
    expect(await Chapter.findById(chapter._id)).not.toBeNull();
  });

  it('deletes an unpurchased chapter normally', async () => {
    const chapter = await Chapter.findOne({ novel: novel._id, number: 5 });
    await api()
      .delete(`/api/admin/chapters/${chapter._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('refunds purchasers when forced', async () => {
    const chapter = await Chapter.findOne({ novel: novel._id, number: 3 });
    const res = await api()
      .delete(`/api/admin/chapters/${chapter._id}?force=true`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.purchaseGuard.refund).toMatchObject({ refunded: 1, credits: 10 });
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(50);
    expect(await ChapterAccess.countDocuments({ chapter: chapter._id })).toBe(0);
  });

  it('refunds across a whole novel', async () => {
    const res = await api()
      .delete(`/api/admin/novels/${novel._id}?force=true`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.purchaseGuard.refund.refunded).toBe(1);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(50);
  });

  it('can be turned off by the admin setting', async () => {
    await settingsService.update({ 'safety.blockDeleteOfPurchasedChapters': false });
    settingsService.clearCache();
    const chapter = await Chapter.findOne({ novel: novel._id, number: 3 });
    await api()
      .delete(`/api/admin/chapters/${chapter._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});

describe('gate stacking', () => {
  it('lets engagement bypass the paywall when configured', async () => {
    await settingsService.update({ 'pricing.gateStacking': 'engagement_bypass_credits' });
    settingsService.clearCache();
    const config = await accessService.pricingConfig();
    expect(config.gateStacking).toBe('engagement_bypass_credits');
  });
});
