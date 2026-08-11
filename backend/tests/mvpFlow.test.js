// The MVP loop, end to end, as a reader and admin actually experience it:
//
//   admin prices a chapter → reader buys credits with PayPal → credits land →
//   reader spends them on that chapter → reader reads it, now and forever.
//
// Every step here already has unit coverage elsewhere. What this file protects
// is the *seams* between them, which is where this path has broken before: a
// price an admin sets that the pricing resolver never reads, a capture that
// credits nothing, an unlock that does not survive a second request.

const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');
const settingsService = require('../src/services/settingsService');
const paypalService = require('../src/services/paypalService');
const Currency = require('../src/models/Currency');
const CreditPack = require('../src/models/CreditPack');
const Order = require('../src/models/Order');
const Wallet = require('../src/models/Wallet');
const Chapter = require('../src/models/Chapter');
const ChapterAccess = require('../src/models/ChapterAccess');
const { ORDER_STATUS, PAYPAL_EVENTS } = require('../src/config/constants');

jest.mock('../src/services/paypalService', () => {
  const actual = jest.requireActual('../src/services/paypalService');
  return {
    ...actual,
    isConfigured: jest.fn().mockResolvedValue(true),
    credentials: jest.fn(),
    createOrder: jest.fn(),
    captureOrder: jest.fn(),
    verifyWebhookSignature: jest.fn().mockResolvedValue({ verified: true, reason: 'SUCCESS' }),
  };
});

let reader;
let readerToken;
let adminToken;
let novel;
let pack;

const asReader = (req) => req.set('Authorization', `Bearer ${readerToken}`);
const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

let seq = 0;
const captureResponse = (value = '9.99') => ({
  id: `PPORDER-${seq}`,
  status: 'COMPLETED',
  payer: { payer_id: 'PAYER1', email_address: 'buyer@test.com' },
  purchase_units: [
    {
      payments: {
        captures: [
          {
            id: `CAP-${seq}`,
            status: 'COMPLETED',
            amount: { value, currency_code: 'USD' },
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
  seq = 0;

  // Re-set on every test, not just declared in the module factory.
  // `jest.clearAllMocks()` clears call history but leaves implementations in
  // place, so a `mockResolvedValue(false)` in one test would otherwise leak
  // into every test after it.
  paypalService.isConfigured.mockResolvedValue(true);
  paypalService.testConnection = jest
    .fn()
    .mockResolvedValue({ ok: true, environment: 'sandbox', base: 'https://api-m.sandbox.paypal.com' });

  paypalService.credentials.mockResolvedValue({
    base: 'https://api-m.sandbox.paypal.com',
    clientId: 'TEST-CLIENT-ID',
    clientSecret: 'secret',
    webhookId: 'WH-1',
    environment: 'sandbox',
    brandName: 'NovelHub',
  });
  paypalService.createOrder.mockImplementation(async () => ({
    id: `PPORDER-${(seq += 1)}`,
    status: 'CREATED',
  }));
  paypalService.captureOrder.mockImplementation(async () => captureResponse());

  ({ token: readerToken, user: reader } = await createUser());
  ({ token: adminToken } = await createAdmin());

  novel = await createNovel({ slug: `mvp-novel-${Date.now()}` });
  await Currency.create({ code: 'USD', name: 'US Dollar', symbol: '$', enabled: true, autoRate: 1, isDefault: true });
  pack = await CreditPack.create({
    name: 'Starter',
    slug: `starter-${Date.now()}`,
    credits: 1000,
    bonusCredits: 0,
    priceUsdCents: 999,
  });

  await settingsService.update({
    'monetization.enabled': true,
    'store.enabled': true,
    // No free quota, so a chapter's price is entirely the admin's choice.
    'pricing.defaultFreeChapterCount': 0,
  });
  settingsService.clearCache();
});

/** Buy and capture one pack, the way the Store page does. */
const buyCredits = async () => {
  const created = await asReader(api().post('/api/store/orders')).send({ packId: pack._id });
  if (created.status !== 201) {
    throw new Error(`order create failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  await asReader(api().post(`/api/store/orders/${created.body.orderId}/capture`)).expect(200);
  return created.body.orderId;
};

describe('the MVP loop', () => {
  it('runs the whole path: price, pay, credit, unlock, read', async () => {
    // 1. The admin puts a price on a chapter.
    const created = await asAdmin(api().post(`/api/admin/novels/${novel._id}/chapters`)).send({
      title: 'The Locked One',
      content: '<p>Secrets within.</p>',
      number: 1,
      accessType: 'paid',
      priceCredits: 10,
    });
    expect(created.status).toBe(201);
    expect(created.body.chapter.priceCredits).toBe(10);

    const chapterNumber = created.body.chapter.number;

    // 2. The reader meets the paywall instead of the content.
    const blocked = await asReader(api().get(`/api/novels/${novel.slug}/chapters/${chapterNumber}`));
    expect(blocked.status).toBe(403);
    expect(blocked.body.gate.priceCredits).toBe(10);
    expect(blocked.body.chapter?.content).toBeUndefined();

    // 3. They buy credits.
    await buyCredits();
    const wallet = await Wallet.findOne({ user: reader._id });
    expect(wallet.balance).toBe(1000);

    // 4. They spend some on the chapter. A fresh unlock is a creation, hence 201.
    const unlocked = await asReader(
      api().post(`/api/novels/${novel.slug}/chapters/${chapterNumber}/unlock`)
    ).expect(201);
    expect(unlocked.body.spent).toBe(10);
    expect(unlocked.body.balance).toBe(990);

    // 5. And can now read it.
    const readable = await asReader(api().get(`/api/novels/${novel.slug}/chapters/${chapterNumber}`)).expect(200);
    expect(readable.body.chapter.content).toContain('Secrets within');
  });

  it('keeps access permanently, not just for the current session', async () => {
    const chapter = await createChapter(novel, { number: 2, accessType: 'paid', priceCredits: 5 });
    await buyCredits();
    await asReader(api().post(`/api/novels/${novel.slug}/chapters/2/unlock`)).expect(201);

    // Nothing about the unlock may expire: the row carries no expiry and the
    // rental sweeper must not touch it.
    const access = await ChapterAccess.findOne({ user: reader._id, chapter: chapter._id });
    expect(access.expiresAt).toBeNull();
    expect(access.isLive()).toBe(true);

    const { expireRentals } = require('../src/jobs');
    await expireRentals.run();

    await asReader(api().get(`/api/novels/${novel.slug}/chapters/2`)).expect(200);
    expect(await ChapterAccess.countDocuments({ user: reader._id })).toBe(1);
  });

  it('does not charge twice when the reader double-clicks unlock', async () => {
    await createChapter(novel, { number: 3, accessType: 'paid', priceCredits: 10 });
    await buyCredits();

    const [first, second] = await Promise.all([
      asReader(api().post(`/api/novels/${novel.slug}/chapters/3/unlock`)),
      asReader(api().post(`/api/novels/${novel.slug}/chapters/3/unlock`)),
    ]);

    // Whichever request loses the race answers 200 "already owned" rather than
    // failing, because the reader owns it either way.
    expect(first.status === 201 || first.status === 200).toBe(true);
    expect(second.status === 201 || second.status === 200).toBe(true);
    expect((await Wallet.findOne({ user: reader._id })).balance).toBe(990);
    expect(await ChapterAccess.countDocuments({ user: reader._id })).toBe(1);
  });

  it('refuses the unlock when the reader cannot afford it', async () => {
    await createChapter(novel, { number: 4, accessType: 'paid', priceCredits: 10 });
    const res = await asReader(api().post(`/api/novels/${novel.slug}/chapters/4/unlock`));
    expect(res.status).toBe(402);
    expect(await ChapterAccess.countDocuments({ user: reader._id })).toBe(0);
  });
});

describe('admin pricing controls', () => {
  it('marks a chapter free regardless of the site default', async () => {
    await settingsService.update({ 'pricing.defaultChapterCredits': 25 });
    settingsService.clearCache();

    const chapter = await createChapter(novel, { number: 5 });
    await asAdmin(api().put(`/api/admin/chapters/${chapter._id}`)).send({ accessType: 'free' }).expect(200);

    const res = await asReader(api().get(`/api/novels/${novel.slug}/chapters/5`)).expect(200);
    expect(res.body.chapter.content).toBeTruthy();
  });

  it('rejects a paid chapter priced at zero rather than giving it away', async () => {
    const chapter = await createChapter(novel, { number: 6 });
    const res = await asAdmin(api().put(`/api/admin/chapters/${chapter._id}`))
      .send({ accessType: 'paid', priceCredits: 0 })
      .expect(400);
    expect(res.body.message).toMatch(/cannot cost 0/i);
  });

  it('rejects a zero price against an already-paid chapter', async () => {
    // The payload alone looks harmless; only merging it with the stored
    // accessType reveals that it would give a paid chapter away.
    const chapter = await createChapter(novel, { number: 11, accessType: 'paid', priceCredits: 10 });
    await asAdmin(api().put(`/api/admin/chapters/${chapter._id}`)).send({ priceCredits: 0 }).expect(400);

    expect((await Chapter.findById(chapter._id)).priceCredits).toBe(10);
  });

  it('rejects a negative price', async () => {
    const chapter = await createChapter(novel, { number: 7 });
    await asAdmin(api().put(`/api/admin/chapters/${chapter._id}`))
      .send({ accessType: 'paid', priceCredits: -5 })
      .expect(400);
  });

  it('clears a price back to the default when sent null', async () => {
    const chapter = await createChapter(novel, { number: 8, accessType: 'paid', priceCredits: 30 });
    await asAdmin(api().put(`/api/admin/chapters/${chapter._id}`))
      .send({ accessType: 'inherit', priceCredits: null })
      .expect(200);

    const refreshed = await Chapter.findById(chapter._id);
    expect(refreshed.priceCredits).toBeNull();
    expect(refreshed.accessType).toBe('inherit');
  });

  it('prices a whole range of chapters at once', async () => {
    for (let number = 1; number <= 6; number += 1) {
      await createChapter(novel, { number, title: `Chapter ${number}` });
    }

    const res = await asAdmin(api().put(`/api/admin/novels/${novel._id}/chapters/pricing`))
      .send({ from: 3, to: 6, accessType: 'paid', priceCredits: 12 })
      .expect(200);

    expect(res.body.updated).toBe(4);

    const priced = await Chapter.find({ novel: novel._id, accessType: 'paid' }).sort({ number: 1 });
    expect(priced.map((chapter) => chapter.number)).toEqual([3, 4, 5, 6]);
    expect(priced.every((chapter) => chapter.priceCredits === 12)).toBe(true);

    // Chapters 1 and 2 were left alone.
    const free = await Chapter.find({ novel: novel._id, accessType: 'inherit' });
    expect(free).toHaveLength(2);
  });

  it('warns that a re-price does not revoke what readers already bought', async () => {
    const chapter = await createChapter(novel, { number: 9, accessType: 'paid', priceCredits: 10 });
    await buyCredits();
    await asReader(api().post(`/api/novels/${novel.slug}/chapters/9/unlock`)).expect(201);

    const res = await asAdmin(api().put(`/api/admin/novels/${novel._id}/chapters/pricing`))
      .send({ accessType: 'paid', priceCredits: 40 })
      .expect(200);
    expect(res.body.existingPurchases).toBe(1);

    // The reader keeps what they paid for, and the record still shows the old
    // price — a re-price must never reach backwards into a completed sale.
    await asReader(api().get(`/api/novels/${novel.slug}/chapters/9`)).expect(200);
    const access = await ChapterAccess.findOne({ user: reader._id, chapter: chapter._id });
    expect(access.creditsSpent).toBe(10);
    expect((await Chapter.findById(chapter._id)).priceCredits).toBe(40);
  });

  it('applies a novel-level price to its chapters', async () => {
    await asAdmin(api().put(`/api/admin/novels/${novel._id}`))
      .field(
        'monetization',
        JSON.stringify({ override: true, monetized: true, freeChapterCount: 2, defaultChapterPriceCredits: 7 })
      )
      .expect(200);

    await createChapter(novel, { number: 1 });
    await createChapter(novel, { number: 3 });

    const list = await api().get(`/api/novels/${novel.slug}/chapters`).expect(200);
    const byNumber = new Map(list.body.chapters.map((chapter) => [chapter.number, chapter]));

    expect(byNumber.get(1).locked).toBe(false);
    expect(byNumber.get(3).locked).toBe(true);
    expect(byNumber.get(3).priceCredits).toBe(7);
  });

  it('ignores novel pricing until the override switch is on', async () => {
    await asAdmin(api().put(`/api/admin/novels/${novel._id}`))
      .field(
        'monetization',
        JSON.stringify({ override: false, monetized: true, freeChapterCount: 0, defaultChapterPriceCredits: 99 })
      )
      .expect(200);

    await createChapter(novel, { number: 1 });
    const list = await api().get(`/api/novels/${novel.slug}/chapters`).expect(200);
    expect(list.body.chapters[0].priceCredits).not.toBe(99);
  });

  it('keeps chapter pricing away from non-admins', async () => {
    const chapter = await createChapter(novel, { number: 10 });
    await asReader(api().put(`/api/admin/chapters/${chapter._id}`))
      .send({ accessType: 'paid', priceCredits: 1 })
      .expect(403);
    await asReader(api().put(`/api/admin/novels/${novel._id}/chapters/pricing`))
      .send({ accessType: 'free' })
      .expect(403);
  });
});

describe('what the reader sees before clicking in', () => {
  it('shows lock state and price on the chapter list', async () => {
    await createChapter(novel, { number: 1, accessType: 'free' });
    await createChapter(novel, { number: 2, accessType: 'paid', priceCredits: 15 });

    const res = await asReader(api().get(`/api/novels/${novel.slug}/chapters`)).expect(200);
    const [first, second] = res.body.chapters;

    expect(first.locked).toBe(false);
    expect(second.locked).toBe(true);
    expect(second.priceCredits).toBe(15);
    expect(second.owned).toBe(false);
  });

  it('marks a chapter as owned once bought', async () => {
    await createChapter(novel, { number: 1, accessType: 'paid', priceCredits: 10 });
    await buyCredits();
    await asReader(api().post(`/api/novels/${novel.slug}/chapters/1/unlock`)).expect(201);

    const res = await asReader(api().get(`/api/novels/${novel.slug}/chapters`)).expect(200);
    expect(res.body.chapters[0].owned).toBe(true);
    expect(res.body.chapters[0].locked).toBe(false);
  });

  it('never leaks chapter content through the list', async () => {
    await createChapter(novel, { number: 1, accessType: 'paid', priceCredits: 10 });
    const res = await api().get(`/api/novels/${novel.slug}/chapters`).expect(200);
    expect(res.body.chapters[0].content).toBeUndefined();
  });
});

describe('store setup', () => {
  it('serves the admin-configured PayPal client ID so checkout can render', async () => {
    // The client ID used to come from a build-time env var, which meant the
    // admin portal setting silently did nothing.
    const res = await api().get('/api/store/config').expect(200);
    expect(res.body.paypalClientId).toBe('TEST-CLIENT-ID');
    expect(res.body.paypalEnvironment).toBe('sandbox');
    expect(res.body.enabled).toBe(true);
  });

  it('withholds the client ID when PayPal is not configured', async () => {
    paypalService.isConfigured.mockResolvedValue(false);
    const res = await api().get('/api/store/config').expect(200);
    expect(res.body.paypalClientId).toBe('');
    expect(res.body.paymentsConfigured).toBe(false);
  });

  it('never exposes the client secret', async () => {
    const res = await api().get('/api/store/config').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('lets an admin verify the credentials before a reader does', async () => {
    paypalService.testConnection = jest
      .fn()
      .mockResolvedValue({ ok: true, environment: 'sandbox', base: 'https://api-m.sandbox.paypal.com' });

    const res = await asAdmin(api().get('/api/admin/monetization/paypal/test')).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.environment).toBe('sandbox');
    // A hint, never the credential itself.
    expect(res.body.clientIdHint).toBe('TEST-C…T-ID');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('reports a credential failure instead of hiding it', async () => {
    paypalService.testConnection = jest
      .fn()
      .mockResolvedValue({ ok: false, error: 'PayPal auth failed: invalid_client' });

    const res = await asAdmin(api().get('/api/admin/monetization/paypal/test')).expect(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/invalid_client/);
  });

  it('keeps the connection test away from ordinary readers', async () => {
    await asReader(api().get('/api/admin/monetization/paypal/test')).expect(403);
  });

  it('tells the admin exactly what is blocking a purchase', async () => {
    await settingsService.update({ 'store.enabled': false });
    settingsService.clearCache();
    await CreditPack.deleteMany({});

    const res = await asAdmin(api().get('/api/admin/monetization/readiness')).expect(200);
    expect(res.body.ready).toBe(false);

    const failing = res.body.checks.filter((check) => !check.ok).map((check) => check.key);
    expect(failing).toContain('store');
    expect(failing).toContain('packs');
    // Each blocker names where to go, so it is not a guessing game.
    res.body.checks.filter((c) => !c.ok).forEach((check) => expect(check.fix).toBeTruthy());
  });

  it('reports ready once everything is in place', async () => {
    await createChapter(novel, { number: 20, accessType: 'paid', priceCredits: 10 });
    process.env.PAYPAL_WEBHOOK_ID = 'WH-TEST';

    try {
      const res = await asAdmin(api().get('/api/admin/monetization/readiness')).expect(200);
      expect(res.body.ready).toBe(true);
      expect(res.body.blockers).toBe(0);
      expect(res.body.checks.every((check) => check.ok)).toBe(true);
    } finally {
      // try/finally so a failing assertion cannot leak the variable into the
      // next test — exactly the class of bug this suite just caught.
      delete process.env.PAYPAL_WEBHOOK_ID;
    }
  });

  it('treats a missing webhook as a warning, not a blocker', async () => {
    delete process.env.PAYPAL_WEBHOOK_ID;
    await createChapter(novel, { number: 21, accessType: 'paid', priceCredits: 10 });

    const res = await asAdmin(api().get('/api/admin/monetization/readiness')).expect(200);
    const webhook = res.body.checks.find((check) => check.key === 'webhook');
    expect(webhook.ok).toBe(false);
    expect(webhook.warnOnly).toBe(true);
    // A purchase still completes without it; only the tab-closed case suffers.
    expect(res.body.ready).toBe(true);
  });

  it('sells in USD without any currency configuration', async () => {
    await Currency.deleteMany({});
    const res = await api().get('/api/store/packs').expect(200);
    expect(res.body.currency.code).toBe('USD');
    expect(res.body.packs).toHaveLength(1);
  });
});

describe('payment safety on the MVP path', () => {
  it('credits exactly once when the webhook arrives after the capture', async () => {
    const orderId = await buyCredits();
    expect((await Wallet.findOne({ user: reader._id })).balance).toBe(1000);

    await api()
      .post('/webhooks/paypal')
      .set('paypal-transmission-id', 'T1')
      .set('paypal-transmission-sig', 'S1')
      .send({
        id: 'EV-MVP-1',
        event_type: PAYPAL_EVENTS.CAPTURE_COMPLETED,
        resource: { id: 'CAP-1', custom_id: String(orderId) },
      })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // The safety net must not pay a second time.
    expect((await Wallet.findOne({ user: reader._id })).balance).toBe(1000);
  });

  it('credits from the webhook alone when the buyer closes the tab', async () => {
    const created = await asReader(api().post('/api/store/orders')).send({ packId: pack._id }).expect(201);
    const order = await Order.findById(created.body.orderId);

    await api()
      .post('/webhooks/paypal')
      .set('paypal-transmission-id', 'T1')
      .set('paypal-transmission-sig', 'S1')
      .send({
        id: 'EV-MVP-2',
        event_type: PAYPAL_EVENTS.CAPTURE_COMPLETED,
        resource: {
          id: 'CAP-WEBHOOK',
          custom_id: String(order._id),
          amount: { value: '9.99', currency_code: 'USD' },
          seller_receivable_breakdown: {
            paypal_fee: { value: '0.64', currency_code: 'USD' },
            net_amount: { value: '9.35', currency_code: 'USD' },
          },
        },
      })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect((await Wallet.findOne({ user: reader._id })).balance).toBe(1000);
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS.CAPTURED);
  });

  it('will not let one reader capture another reader’s order', async () => {
    const created = await asReader(api().post('/api/store/orders')).send({ packId: pack._id }).expect(201);
    const { token: otherToken } = await createUser();

    await api()
      .post(`/api/store/orders/${created.body.orderId}/capture`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });
});
