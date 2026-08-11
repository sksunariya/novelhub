const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const ChapterRead = require('../src/models/ChapterRead');
const GateImpression = require('../src/models/GateImpression');
const ChapterStatsDaily = require('../src/models/ChapterStatsDaily');
const { isBot, dayKey, COOKIE_NAME } = require('../src/utils/readerIdentity');

let novel;
let user;
let token;

beforeEach(async () => {
  settingsService.clearCache();
  novel = await createNovel({ slug: 'tracked' });
  ({ user, token } = await createUser());
  for (let n = 1; n <= 6; n += 1) await createChapter(novel, { number: n, title: `Chapter ${n}` });
  await settingsService.update({
    'monetization.enabled': true,
    'pricing.defaultChapterCredits': 10,
    'pricing.defaultFreeChapterCount': 2,
  });
  settingsService.clearCache();
});

const auth = (req) => req.set('Authorization', `Bearer ${token}`);
const read = (n) => api().get(`/api/novels/tracked/chapters/${n}`);

describe('bot detection', () => {
  it('recognises common crawlers', () => {
    ['Googlebot/2.1', 'facebookexternalhit/1.1', 'python-requests/2.31', 'curl/8.4', 'HeadlessChrome/120']
      .forEach((ua) => expect(isBot(ua)).toBe(true));
  });

  it('treats real browsers as readers', () => {
    expect(isBot('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe(false);
    expect(isBot('Mozilla/5.0 (iPhone) Version/17.0 Mobile Safari/604.1')).toBe(false);
  });

  it('treats a missing user agent as a bot', () => {
    expect(isBot(undefined)).toBe(true);
  });
});

describe('recording reads', () => {
  const BROWSER = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36';

  it('records a read for a signed-in reader', async () => {
    await auth(read(1)).set('User-Agent', BROWSER).expect(200);
    const row = await ChapterRead.findOne({ user: user._id });
    expect(row.chapterNumber).toBe(1);
    expect(row.readCount).toBe(1);
    expect(row.readerKey).toBe(`u:${user._id}`);
  });

  it('counts a re-read once but bumps the counter', async () => {
    await auth(read(1)).set('User-Agent', BROWSER).expect(200);
    await auth(read(1)).set('User-Agent', BROWSER).expect(200);

    expect(await ChapterRead.countDocuments({ user: user._id })).toBe(1);
    expect((await ChapterRead.findOne({ user: user._id })).readCount).toBe(2);
  });

  it('survives beyond the 30-minute view dedup window', async () => {
    // The whole point: ViewEvent expires, this does not.
    await auth(read(1)).set('User-Agent', BROWSER).expect(200);
    const ViewEvent = require('../src/models/ViewEvent');
    await ViewEvent.deleteMany({}); // simulate the TTL firing
    expect(await ChapterRead.countDocuments()).toBe(1);
  });

  it('gives an anonymous reader a signed device cookie and counts them once', async () => {
    const first = await read(1).set('User-Agent', BROWSER).expect(200);
    const cookie = first.headers['set-cookie'].find((c) => c.startsWith(COOKIE_NAME));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');

    await read(1).set('User-Agent', BROWSER).set('Cookie', cookie.split(';')[0]).expect(200);
    expect(await ChapterRead.countDocuments()).toBe(1);
  });

  it('does not collapse two anonymous readers sharing an IP', async () => {
    // IP-based dedup would count these as one reader behind a CDN or carrier NAT.
    await read(1).set('User-Agent', BROWSER).expect(200);
    await read(1).set('User-Agent', BROWSER).expect(200);
    expect(await ChapterRead.countDocuments()).toBe(2);
  });

  it('rejects a tampered device cookie', async () => {
    await read(1).set('User-Agent', BROWSER).set('Cookie', `${COOKIE_NAME}=forged.signature`).expect(200);
    const row = await ChapterRead.findOne();
    expect(row.readerKey).not.toContain('forged');
  });

  it('excludes bots when filtering is on', async () => {
    await read(1).set('User-Agent', 'Googlebot/2.1').expect(200);
    expect(await ChapterRead.countDocuments()).toBe(0);
  });

  it('counts bots when filtering is turned off', async () => {
    await settingsService.update({ 'views.filterBots': false });
    settingsService.clearCache();
    await read(1).set('User-Agent', 'Googlebot/2.1').expect(200);
    expect(await ChapterRead.countDocuments()).toBe(1);
  });

  it('can be configured to ignore anonymous readers', async () => {
    await settingsService.update({ 'views.countAnonymous': false });
    settingsService.clearCache();
    await read(1).set('User-Agent', BROWSER).expect(200);
    expect(await ChapterRead.countDocuments()).toBe(0);

    await auth(read(1)).set('User-Agent', BROWSER).expect(200);
    expect(await ChapterRead.countDocuments()).toBe(1);
  });

  it('keeps a daily rollup alongside the raw rows', async () => {
    await auth(read(1)).set('User-Agent', BROWSER).expect(200);
    await auth(read(1)).set('User-Agent', BROWSER).expect(200);

    const stats = await ChapterStatsDaily.findOne({ day: dayKey() });
    expect(stats.reads).toBe(2);
    expect(stats.uniqueReaders).toBe(1);
  });
});

describe('gate impressions', () => {
  const BROWSER = 'Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36';

  it('records a reader hitting the paywall', async () => {
    await auth(read(3)).set('User-Agent', BROWSER).expect(403);
    const row = await GateImpression.findOne({ user: user._id });
    expect(row).toMatchObject({ reason: 'credits', priceCredits: 10, chapterNumber: 3, couldAfford: false });
  });

  it('notes when the reader could have afforded it', async () => {
    await creditService.credit({ user, amount: 50, idempotencyKey: 'seed' });
    await auth(read(3)).set('User-Agent', BROWSER).expect(403);
    expect((await GateImpression.findOne({ user: user._id })).couldAfford).toBe(true);
  });

  it('deduplicates refreshes within a day', async () => {
    await auth(read(3)).set('User-Agent', BROWSER).expect(403);
    await auth(read(3)).set('User-Agent', BROWSER).expect(403);
    await auth(read(3)).set('User-Agent', BROWSER).expect(403);
    expect(await GateImpression.countDocuments({ user: user._id })).toBe(1);
  });

  it('records nothing once the chapter is unlocked', async () => {
    await creditService.credit({ user, amount: 50, idempotencyKey: 'seed' });
    await auth(api().post('/api/novels/tracked/chapters/3/unlock')).expect(201);
    await auth(read(3)).set('User-Agent', BROWSER).expect(200);
    expect(await GateImpression.countDocuments()).toBe(0);
  });

  it('does not record a read when the chapter is locked', async () => {
    await auth(read(3)).set('User-Agent', BROWSER).expect(403);
    expect(await ChapterRead.countDocuments()).toBe(0);
  });
});

describe('novel performance analytics', () => {
  const BROWSER = 'Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36';
  let adminToken;

  const simulateReaders = async (count, upToChapter) => {
    for (let i = 0; i < count; i += 1) {
      const { token: readerToken } = await createUser();
      for (let n = 1; n <= upToChapter; n += 1) {
        await api()
          .get(`/api/novels/tracked/chapters/${n}`)
          .set('Authorization', `Bearer ${readerToken}`)
          .set('User-Agent', BROWSER);
      }
    }
  };

  beforeEach(async () => {
    ({ token: adminToken } = await createAdmin());
  });

  it('produces the retention curve with a paywall drop-off', async () => {
    // Five readers reach the free chapters; only the paying one goes further.
    await simulateReaders(5, 2);
    await creditService.credit({ user, amount: 100, idempotencyKey: 'buyer' });
    await auth(read(1)).set('User-Agent', BROWSER);
    await auth(read(2)).set('User-Agent', BROWSER);
    await auth(api().post('/api/novels/tracked/chapters/3/unlock')).expect(201);
    await auth(read(3)).set('User-Agent', BROWSER).expect(200);

    const res = await api()
      .get(`/api/admin/analytics/novels/${novel._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const byNumber = Object.fromEntries(res.body.chapters.map((c) => [c.number, c]));
    expect(byNumber[1].readers).toBe(6);
    expect(byNumber[2].readers).toBe(6);
    expect(byNumber[3].readers).toBe(1);
    expect(byNumber[1].free).toBe(true);
    expect(byNumber[3].free).toBe(false);

    expect(res.body.paywall).toMatchObject({ firstPaidChapter: 3, readersBefore: 6, readersAfter: 1 });
    expect(res.body.paywall.dropOffPct).toBeCloseTo(83.3, 0);
  });

  it('reports revenue and conversion per chapter', async () => {
    await creditService.credit({
      user,
      amount: 1200,
      type: 'purchase',
      source: 'purchase',
      costUsdCents: 999,
      idempotencyKey: 'pack',
    });
    await auth(api().post('/api/novels/tracked/chapters/3/unlock')).expect(201);

    const res = await api()
      .get(`/api/admin/analytics/novels/${novel._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const chapter3 = res.body.chapters.find((c) => c.number === 3);
    expect(chapter3.unlocks).toBe(1);
    expect(chapter3.creditsEarned).toBe(10);
    expect(chapter3.revenueUsdCents).toBe(8); // 83,250 micros
    expect(res.body.totals.paidChapters).toBe(4);
    expect(res.body.totals.freeChapters).toBe(2);
  });

  it('ranks novels by attributed revenue', async () => {
    await creditService.credit({
      user, amount: 1200, type: 'purchase', source: 'purchase', costUsdCents: 999, idempotencyKey: 'pack',
    });
    await auth(api().post('/api/novels/tracked/chapters/3/unlock')).expect(201);

    const res = await api()
      .get('/api/admin/analytics/novels')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.novels[0]).toMatchObject({ title: 'Test Novel', unlocks: 1, payers: 1 });
  });

  it('builds the paywall funnel', async () => {
    await auth(read(3)).set('User-Agent', BROWSER).expect(403);
    await creditService.credit({ user, amount: 100, idempotencyKey: 'buyer' });
    await auth(api().post('/api/novels/tracked/chapters/4/unlock')).expect(201);

    const res = await api()
      .get('/api/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const stages = Object.fromEntries(res.body.stages.map((s) => [s.key, s.value]));
    expect(stages.gate_shown).toBe(1);
    expect(stages.unlocked).toBe(1);
  });

  it('summarises the credit economy including deferred liability', async () => {
    await creditService.credit({
      user, amount: 1200, type: 'purchase', source: 'purchase', costUsdCents: 999, idempotencyKey: 'pack',
    });
    await creditService.credit({ user, amount: 500, idempotencyKey: 'promo' });

    const res = await api()
      .get('/api/admin/analytics/economy')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.creditsPurchased).toBe(1200);
    expect(res.body.creditsGranted).toBe(500);
    // The grant added no cash, so liability reflects only the real purchase.
    expect(res.body.deferredUsdCents).toBe(999);
  });

  it('requires an admin', async () => {
    await api().get(`/api/admin/analytics/novels/${novel._id}`).expect(401);
  });
});
