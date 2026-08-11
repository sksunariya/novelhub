const rollupService = require('../src/services/rollupService');
const analyticsService = require('../src/services/analyticsService');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const accessService = require('../src/services/accessService');
const Author = require('../src/models/Author');
const Novel = require('../src/models/Novel');
const ChapterStatsDaily = require('../src/models/ChapterStatsDaily');
const NovelRevenueDaily = require('../src/models/NovelRevenueDaily');
const RevenueDaily = require('../src/models/RevenueDaily');
const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');

const today = () => new Date().toISOString().slice(0, 10);

let novel;
let chapter;

const enable = () =>
  settingsService
    .update({
      'monetization.enabled': true,
      'pricing.defaultChapterCredits': 10,
      'pricing.defaultFreeChapterCount': 0,
    })
    .then(() => settingsService.clearCache());

const buyer = async (cash = 999) => {
  const { user } = await createUser();
  await creditService.credit({
    user,
    amount: 1200,
    type: 'purchase',
    source: 'purchase',
    costUsdCents: cash,
    idempotencyKey: `pack:${user._id}`,
  });
  return user;
};

beforeEach(async () => {
  settingsService.clearCache();
  await enable();
  novel = await createNovel({ slug: 'rollup-novel', author: 'A. Writer' });
  chapter = await createChapter(novel, { number: 1 });
});

describe('chapter rollup', () => {
  it('records unlocks, credits and attributed cash', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });

    await rollupService.rebuildChapterDay(today());
    const row = await ChapterStatsDaily.findOne({ day: today(), chapter: chapter._id });

    expect(row.unlocks).toBe(1);
    expect(row.uniqueBuyers).toBe(1);
    expect(row.creditsSpent).toBe(10);
    expect(row.attributedUsdMicros).toBe(83250);
  });

  it('separates face value from attributed cash', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });
    await rollupService.rebuildChapterDay(today());

    const row = await ChapterStatsDaily.findOne({ chapter: chapter._id });
    // 10 credits at 100/USD is $0.10 nominal, but the credits cost less than
    // face value because the pack carried a bonus.
    expect(row.faceValueUsdMicros).toBe(100000);
    expect(row.attributedUsdMicros).toBeLessThan(row.faceValueUsdMicros);
  });

  it('flags spending funded by granted credits', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 100, idempotencyKey: 'free' });
    await accessService.unlockChapter({ user, novel, chapter });

    await rollupService.rebuildChapterDay(today());
    const row = await ChapterStatsDaily.findOne({ chapter: chapter._id });

    expect(row.grantFundedCredits).toBe(10);
    expect(row.attributedUsdMicros).toBe(0);
  });

  it('is idempotent — rebuilding does not double-count', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });

    await rollupService.rebuildChapterDay(today());
    await rollupService.rebuildChapterDay(today());

    const rows = await ChapterStatsDaily.find({ chapter: chapter._id });
    expect(rows).toHaveLength(1);
    expect(rows[0].unlocks).toBe(1);
  });

  it('writes nothing for a day with no activity', async () => {
    expect(await rollupService.rebuildChapterDay('2020-01-01')).toBe(0);
  });
});

describe('novel rollup', () => {
  it('sums its chapters', async () => {
    const second = await createChapter(novel, { number: 2 });
    const a = await buyer();
    const b = await buyer();
    await accessService.unlockChapter({ user: a, novel, chapter });
    await accessService.unlockChapter({ user: b, novel, chapter: second });

    await rollupService.rebuildDay(today());
    const row = await NovelRevenueDaily.findOne({ day: today(), novel: novel._id });

    expect(row.unlocks).toBe(2);
    expect(row.creditsEarned).toBe(20);
    expect(row.chaptersWithActivity).toBe(2);
  });

  it('denormalizes the author so reports never join', async () => {
    const author = await Author.create({ name: 'Vera Blackwood' });
    await Novel.updateOne({ _id: novel._id }, { authorRef: author._id });

    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });
    await rollupService.rebuildDay(today());

    const row = await NovelRevenueDaily.findOne({ novel: novel._id });
    expect(String(row.author)).toBe(String(author._id));
    expect(row.authorName).toBe('Vera Blackwood');
  });

  it('falls back to the display string when no author is linked', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });
    await rollupService.rebuildDay(today());

    const row = await NovelRevenueDaily.findOne({ novel: novel._id });
    expect(row.author).toBeNull();
    expect(row.authorName).toBe('A. Writer');
  });
});

describe('platform rollup', () => {
  it('records credits granted and spent', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 500, idempotencyKey: 'grant' });
    await accessService.unlockChapter({ user, novel, chapter });

    await rollupService.rebuildDay(today());
    const row = await RevenueDaily.findOne({ day: today() });

    expect(row.creditsGranted).toBe(500);
    expect(row.creditsSpent).toBe(10);
  });

  it('tracks deferred liability as a running balance', async () => {
    await buyer();
    await rollupService.rebuildDay(today());

    const row = await RevenueDaily.findOne({ day: today() });
    // Cash taken, no content delivered yet.
    expect(row.deferredUsdMicrosEnd).toBe(9990000);
  });

  it('is idempotent', async () => {
    await buyer();
    await rollupService.rebuildDay(today());
    await rollupService.rebuildDay(today());
    expect(await RevenueDaily.countDocuments({ day: today() })).toBe(1);
  });
});

describe('author earnings', () => {
  let adminToken;

  beforeEach(async () => {
    ({ token: adminToken } = await createAdmin());
  });

  const auth = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  it('groups earnings by linked author', async () => {
    const author = await Author.create({ name: 'Vera Blackwood' });
    const other = await createNovel({ slug: 'second-novel', author: 'Vera Blackwood' });
    const otherChapter = await createChapter(other, { number: 1 });
    await Novel.updateMany({ _id: { $in: [novel._id, other._id] } }, { authorRef: author._id });

    const a = await buyer();
    const b = await buyer();
    await accessService.unlockChapter({ user: a, novel, chapter });
    await accessService.unlockChapter({ user: b, novel: other, chapter: otherChapter });
    await rollupService.rebuildDay(today());

    const rows = await analyticsService.authorEarnings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ authorName: 'Vera Blackwood', novelCount: 2, unlocks: 2, linked: true });
    expect(rows[0].revenueUsdCents).toBe(16); // two unlocks at 83,250 micros
  });

  it('surfaces unlinked novels rather than dropping them', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });
    await rollupService.rebuildDay(today());

    const rows = await analyticsService.authorEarnings();
    expect(rows[0].linked).toBe(false);
    expect(rows[0].authorName).toBe('A. Writer');
  });

  it('reports how much reading was funded by free credits', async () => {
    const { user: freeReader } = await createUser();
    await creditService.credit({ user: freeReader, amount: 100, idempotencyKey: 'free' });
    const paying = await buyer();
    const second = await createChapter(novel, { number: 2 });

    await accessService.unlockChapter({ user: freeReader, novel, chapter });
    await accessService.unlockChapter({ user: paying, novel, chapter: second });
    await rollupService.rebuildDay(today());

    const [row] = await analyticsService.authorEarnings();
    // Half the credits spent on this author came from grants and earned nothing.
    expect(row.grantFundedCredits).toBe(10);
    expect(row.grantFundedPct).toBe(50);
  });

  it('breaks an author down by novel', async () => {
    const author = await Author.create({ name: 'Vera Blackwood' });
    await Novel.updateOne({ _id: novel._id }, { authorRef: author._id });
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });
    await rollupService.rebuildDay(today());

    const rows = await analyticsService.authorNovelBreakdown(author._id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: novel.title, unlocks: 1 });
  });

  it('serves the earnings table over the API', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });
    await rollupService.rebuildDay(today());

    const res = await auth(api().get('/api/admin/analytics/authors')).expect(200);
    expect(res.body.authors[0].authorName).toBe('A. Writer');
  });

  it('exports CSV with the numbers a negotiation needs', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });
    await rollupService.rebuildDay(today());

    const res = await auth(api().get('/api/admin/analytics/authors.csv')).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/author-earnings/);
    expect(res.text).toContain('Author,Novels,Readers,Unlocks');
    expect(res.text).toContain('A. Writer');
  });

  it('does not read authors.csv as an author id', async () => {
    // Static route must be registered before /authors/:id.
    const res = await auth(api().get('/api/admin/analytics/authors.csv')).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('requires an admin', async () => {
    const { token } = await createUser();
    await api().get('/api/admin/analytics/authors').set('Authorization', `Bearer ${token}`).expect(403);
  });
});

describe('rebuild window', () => {
  it('covers a trailing window so late refunds are picked up', async () => {
    const result = await rollupService.rebuildRecent(2);
    expect(result.days).toBe(3); // today plus two days back
  });

  it('is exposed to admins', async () => {
    const { token } = await createAdmin();
    const res = await api()
      .post('/api/admin/analytics/rebuild?days=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.days).toBe(2);
  });
});
