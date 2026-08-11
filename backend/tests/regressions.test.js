// Regressions found in review. Each test fails against the code as it was.

const creditService = require('../src/services/creditService');
const audienceResolver = require('../src/services/audienceResolver');
const settingsService = require('../src/services/settingsService');
const accessService = require('../src/services/accessService');
const Novel = require('../src/models/Novel');
const Chapter = require('../src/models/Chapter');
const ChapterAccess = require('../src/models/ChapterAccess');
const { api, createUser, createNovel, createChapter } = require('./helpers');

beforeEach(() => settingsService.clearCache());

describe('credit service always returns a wallet', () => {
  // accessService reads debited.wallet.balance for the low-balance nudge.
  // Omitting it on the replay path threw a TypeError *after* the chapter was
  // already unlocked and the revenue recorded — a 500 on a successful purchase.
  it('includes the wallet on a replayed debit', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 100, idempotencyKey: 'seed' });

    const first = await creditService.debit({ user, amount: 10, idempotencyKey: 'dup' });
    const replay = await creditService.debit({ user, amount: 10, idempotencyKey: 'dup' });

    expect(replay.replayed).toBe(true);
    expect(replay.wallet).toBeDefined();
    expect(replay.wallet.balance).toBe(first.wallet.balance);
  });

  it('includes the wallet on a replayed credit', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 50, idempotencyKey: 'grant' });
    const replay = await creditService.credit({ user, amount: 50, idempotencyKey: 'grant' });

    expect(replay.replayed).toBe(true);
    expect(replay.wallet.balance).toBe(50);
  });

  it('completes an unlock whose debit was already recorded', async () => {
    const { user, token } = await createUser();
    const novel = await createNovel({ slug: 'replay-novel' });
    const chapter = await createChapter(novel, { number: 3 });
    await settingsService.update({
      'monetization.enabled': true,
      'pricing.defaultChapterCredits': 10,
      'pricing.defaultFreeChapterCount': 0,
    });
    settingsService.clearCache();
    await creditService.credit({ user, amount: 100, idempotencyKey: 'seed' });

    // Simulate an attempt that wrote the ledger row but died before the access
    // row: the retry must succeed rather than 500.
    await creditService.debit({
      user,
      amount: 10,
      idempotencyKey: `unlock:${user._id}:${chapter._id}`,
      novel: novel._id,
      chapter: chapter._id,
    });

    const res = await api()
      .post('/api/novels/replay-novel/chapters/3/unlock')
      .set('Authorization', `Bearer ${token}`);

    expect([200, 201]).toContain(res.status);
    expect(await ChapterAccess.countDocuments({ user: user._id, chapter: chapter._id })).toBe(1);
  });
});

describe('audience limit is honoured across batches', () => {
  const seedUsers = async (n) => {
    for (let i = 0; i < n; i += 1) await createUser();
  };

  // The cursor re-ran the pipeline per batch, so a `limit` was re-applied to a
  // shrinking candidate set — a campaign capped at N could pay far more than N.
  it('never yields more than the limit in total', async () => {
    await seedUsers(12);
    const rule = { mode: 'all', limit: 5 };

    const seen = new Set();
    let afterId = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const rows = await audienceResolver.batch(rule, { afterId, size: 2 });
      if (!rows.length) break;
      rows.forEach((row) => seen.add(String(row._id)));
      afterId = rows[rows.length - 1]._id;
    }

    expect(seen.size).toBe(5);
    expect(await audienceResolver.count(rule)).toBe(5);
  });

  it('walks the whole audience when there is no limit', async () => {
    await seedUsers(7);
    const rule = { mode: 'all' };

    const seen = new Set();
    let afterId = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const rows = await audienceResolver.batch(rule, { afterId, size: 3 });
      if (!rows.length) break;
      rows.forEach((row) => seen.add(String(row._id)));
      afterId = rows[rows.length - 1]._id;
    }

    expect(seen.size).toBe(7);
  });

  it('does not skip high-ranked users when ordering by spend', async () => {
    await seedUsers(6);
    const rule = { mode: 'query', query: {}, orderBy: 'lifetimeSpend', limit: 4 };
    const seen = new Set();
    let afterId = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const rows = await audienceResolver.batch(rule, { afterId, size: 2 });
      if (!rows.length) break;
      rows.forEach((row) => seen.add(String(row._id)));
      afterId = rows[rows.length - 1]._id;
    }
    expect(seen.size).toBe(4);
  });
});

describe('earnings are not publicly readable', () => {
  // serializeNovel was written but never wired, so the raw document was
  // returned — exposing negotiated author terms on a public endpoint.
  it('omits revenue share and lifetime revenue from a novel read', async () => {
    const novel = await createNovel({ slug: 'private-terms' });
    await Novel.updateOne(
      { _id: novel._id },
      {
        $set: {
          'monetization.override': true,
          'monetization.revenueShare.enabled': true,
          'monetization.revenueShare.sharePct': 70,
          revenueLifetimeUsdMicros: 12345678,
        },
      }
    );

    const res = await api().get('/api/novels/private-terms').expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('sharePct');
    expect(body).not.toContain('12345678');
  });

  it('omits chapter earnings from a chapter read', async () => {
    const novel = await createNovel({ slug: 'earnings-novel' });
    const chapter = await createChapter(novel, { number: 1 });
    await Chapter.updateOne({ _id: chapter._id }, { $set: { revenueLifetimeUsdMicros: 999999 } });

    const res = await api().get('/api/novels/earnings-novel/chapters/1').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('999999');
  });

  it('still lets an admin-side read ask for them explicitly', async () => {
    const novel = await createNovel({ slug: 'admin-read' });
    await Novel.updateOne({ _id: novel._id }, { $set: { revenueLifetimeUsdMicros: 4242 } });

    const withField = await Novel.findById(novel._id).select('+revenueLifetimeUsdMicros');
    expect(withField.revenueLifetimeUsdMicros).toBe(4242);

    const without = await Novel.findById(novel._id);
    expect(without.revenueLifetimeUsdMicros).toBeUndefined();
  });

  it('keeps recording revenue even though the field is excluded by default', async () => {
    // $inc does not need the field selected; the guard must not break writes.
    const { user } = await createUser();
    const novel = await createNovel({ slug: 'still-records' });
    const chapter = await createChapter(novel, { number: 3 });
    await settingsService.update({
      'monetization.enabled': true,
      'pricing.defaultChapterCredits': 10,
      'pricing.defaultFreeChapterCount': 0,
    });
    settingsService.clearCache();
    await creditService.credit({
      user, amount: 1200, type: 'purchase', source: 'purchase', costUsdCents: 999, idempotencyKey: 'p',
    });

    await accessService.unlockChapter({ user, novel, chapter });

    const fresh = await Chapter.findById(chapter._id).select('+revenueLifetimeUsdMicros');
    expect(fresh.revenueLifetimeUsdMicros).toBe(83250);
  });
});

describe('chapter list contract', () => {
  // The reader builds comment and review URLs from the chapter identifier;
  // the serializer emits `id`, and six call sites were still reading `_id`.
  it('serves chapters with an id the client can use', async () => {
    const novel = await createNovel({ slug: 'id-shape' });
    await createChapter(novel, { number: 1 });

    const read = await api().get('/api/novels/id-shape/chapters/1').expect(200);
    expect(read.body.chapter.id).toBeDefined();

    const list = await api().get('/api/novels/id-shape/chapters').expect(200);
    expect(list.body.chapters[0].id).toBeDefined();
    // Pagination metadata, so a long novel does not silently appear to end.
    expect(list.body.total).toBe(1);
    expect(list.body.pages).toBe(1);
  });
});
