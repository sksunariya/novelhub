// Chapter save hooks and the access-service helpers that the HTTP tests only
// reach indirectly.

const settingsService = require('../src/services/settingsService');
const accessService = require('../src/services/accessService');
const creditService = require('../src/services/creditService');
const contentGuard = require('../src/services/contentGuardService');
const Chapter = require('../src/models/Chapter');
const ChapterAccess = require('../src/models/ChapterAccess');
const PricingRule = require('../src/models/PricingRule');
const Wallet = require('../src/models/Wallet');
const { createUser, createNovel, createChapter } = require('./helpers');

let novel;

beforeEach(async () => {
  settingsService.clearCache();
  novel = await createNovel({ slug: 'lifecycle' });
});

describe('publishedAt stamping', () => {
  it('stamps on creation of a published chapter', async () => {
    const chapter = await createChapter(novel, { number: 1 });
    expect(chapter.publishedAt).toBeInstanceOf(Date);
  });

  it('leaves a draft unstamped', async () => {
    const chapter = await createChapter(novel, { number: 1, published: false });
    expect(chapter.publishedAt).toBeNull();
  });

  it('stamps on the draft to published transition', async () => {
    const chapter = await createChapter(novel, { number: 1, published: false });
    chapter.published = true;
    await chapter.save();
    expect(chapter.publishedAt).toBeInstanceOf(Date);
  });

  it('never re-stamps, so unpublishing and republishing cannot reset the clock', async () => {
    // Timed-release pricing depends on this date being the first publication.
    const chapter = await createChapter(novel, { number: 1 });
    const original = chapter.publishedAt;

    chapter.published = false;
    await chapter.save();
    chapter.published = true;
    await chapter.save();

    expect(chapter.publishedAt).toEqual(original);
  });
});

describe('originalNumber and word count', () => {
  it('records the number a chapter was created with', async () => {
    const chapter = await createChapter(novel, { number: 12 });
    expect(chapter.originalNumber).toBe(12);
  });

  it('keeps the original after a renumber', async () => {
    const chapter = await createChapter(novel, { number: 12 });
    chapter.number = 3;
    await chapter.save();
    expect(chapter.number).toBe(3);
    expect(chapter.originalNumber).toBe(12);
  });

  it('counts words on creation', async () => {
    const chapter = await createChapter(novel, { number: 1, content: '<p>one two three four</p>' });
    expect(chapter.wordCount).toBe(4);
  });

  it('recounts when the content changes', async () => {
    const chapter = await createChapter(novel, { number: 1, content: '<p>one two</p>' });
    chapter.content = '<p>one two three four five</p>';
    await chapter.save();
    expect(chapter.wordCount).toBe(5);
  });

  it('does not recount when only the title changes', async () => {
    const chapter = await createChapter(novel, { number: 1, content: '<p>one two</p>' });
    const before = chapter.wordCount;
    chapter.title = 'Renamed';
    await chapter.save();
    expect(chapter.wordCount).toBe(before);
  });
});

describe('ownedChapterIds', () => {
  it('returns an empty set for a signed-out reader', async () => {
    expect((await accessService.ownedChapterIds(null, novel._id)).size).toBe(0);
  });

  it('lists what a reader owns in one novel', async () => {
    const { user } = await createUser();
    const a = await createChapter(novel, { number: 1 });
    await createChapter(novel, { number: 2 });
    await ChapterAccess.create({ user: user._id, chapter: a._id, novel: novel._id });

    const owned = await accessService.ownedChapterIds(user._id, novel._id);
    expect(owned.size).toBe(1);
    expect(owned.has(String(a._id))).toBe(true);
  });

  it('excludes a lapsed rental', async () => {
    const { user } = await createUser();
    const chapter = await createChapter(novel, { number: 1 });
    await ChapterAccess.create({
      user: user._id, chapter: chapter._id, novel: novel._id, expiresAt: new Date(Date.now() - 1000),
    });
    expect((await accessService.ownedChapterIds(user._id, novel._id)).size).toBe(0);
  });

  it('includes a live rental', async () => {
    const { user } = await createUser();
    const chapter = await createChapter(novel, { number: 1 });
    await ChapterAccess.create({
      user: user._id, chapter: chapter._id, novel: novel._id, expiresAt: new Date(Date.now() + 3600e3),
    });
    expect((await accessService.ownedChapterIds(user._id, novel._id)).size).toBe(1);
  });

  it('does not leak ownership across novels', async () => {
    const { user } = await createUser();
    const other = await createNovel({ slug: 'other' });
    const chapter = await createChapter(other, { number: 1 });
    await ChapterAccess.create({ user: user._id, chapter: chapter._id, novel: other._id });
    expect((await accessService.ownedChapterIds(user._id, novel._id)).size).toBe(0);
  });
});

describe('loadRules', () => {
  it('returns only active rules, highest priority first', async () => {
    await PricingRule.create({ name: 'off', active: false, priority: 99 });
    await PricingRule.create({ name: 'low', active: true, priority: 1 });
    await PricingRule.create({ name: 'high', active: true, priority: 9 });

    const rules = await accessService.loadRules();
    expect(rules.map((r) => r.name)).toEqual(['high', 'low']);
  });
});

describe('resolveAccess', () => {
  const enable = () =>
    settingsService
      .update({
        'monetization.enabled': true,
        'pricing.defaultChapterCredits': 10,
        'pricing.defaultFreeChapterCount': 2,
      })
      .then(() => settingsService.clearCache());

  it('reports everything free while monetization is off', async () => {
    const chapter = await createChapter(novel, { number: 9 });
    const access = await accessService.resolveAccess({ novel, chapter, user: null });
    expect(access).toMatchObject({ locked: false, free: true, reason: 'monetization_off' });
  });

  it('reports a free chapter inside the quota', async () => {
    await enable();
    const chapter = await createChapter(novel, { number: 1 });
    expect(await accessService.resolveAccess({ novel, chapter, user: null })).toMatchObject({ locked: false });
  });

  it('quotes a price for a signed-out reader without a balance', async () => {
    await enable();
    const chapter = await createChapter(novel, { number: 5 });
    const access = await accessService.resolveAccess({ novel, chapter, user: null });
    expect(access).toMatchObject({ locked: true, reason: 'credits', priceCredits: 10, balance: 0, canAfford: false });
  });

  it('reports affordability for a signed-in reader', async () => {
    await enable();
    const { user } = await createUser();
    await creditService.credit({ user, amount: 50, idempotencyKey: 'seed' });
    const chapter = await createChapter(novel, { number: 5 });
    expect(await accessService.resolveAccess({ novel, chapter, user })).toMatchObject({
      canAfford: true, balance: 50,
    });
  });

  it('reports an owned chapter as unlocked', async () => {
    await enable();
    const { user } = await createUser();
    const chapter = await createChapter(novel, { number: 5 });
    await ChapterAccess.create({ user: user._id, chapter: chapter._id, novel: novel._id });
    expect(await accessService.resolveAccess({ novel, chapter, user })).toMatchObject({
      locked: false, owned: true, reason: 'owned',
    });
  });

  it('blocks an early-access chapter before quoting a price', async () => {
    await enable();
    const chapter = await createChapter(novel, {
      number: 5, earlyAccessUntil: new Date(Date.now() + 3600e3),
    });
    const access = await accessService.resolveAccess({ novel, chapter, user: null });
    expect(access.reason).toBe('early_access');
    expect(access.priceCredits).toBe(0);
  });

  it('quotes normally once the early-access window has passed', async () => {
    await enable();
    const chapter = await createChapter(novel, {
      number: 5, earlyAccessUntil: new Date(Date.now() - 1000),
    });
    expect((await accessService.resolveAccess({ novel, chapter, user: null })).reason).toBe('credits');
  });
});

describe('quoteBulk', () => {
  beforeEach(async () => {
    await settingsService.update({
      'monetization.enabled': true,
      'pricing.defaultChapterCredits': 10,
      'pricing.defaultFreeChapterCount': 2,
      'pricing.bulkDiscountTiers': [{ minChapters: 3, discountPct: 20 }],
    });
    settingsService.clearCache();
    for (let n = 1; n <= 6; n += 1) await createChapter(novel, { number: n });
  });

  it('quotes only the payable chapters', async () => {
    const { user } = await createUser();
    const chapters = await Chapter.find({ novel: novel._id }).sort({ number: 1 });
    const quote = await accessService.quoteBulk({ user, novel, chapters });

    expect(quote.chapterCount).toBe(4); // 1 and 2 are free
    expect(quote.listTotal).toBe(40);
    expect(quote.discountPct).toBe(20);
    expect(quote.total).toBe(32);
  });

  it('reports affordability against the discounted total', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 35, idempotencyKey: 'seed' });
    const chapters = await Chapter.find({ novel: novel._id });
    const quote = await accessService.quoteBulk({ user, novel, chapters });
    expect(quote.canAfford).toBe(true); // 35 covers the discounted 32, not the 40 list
  });

  it('excludes chapters already owned', async () => {
    const { user } = await createUser();
    const chapters = await Chapter.find({ novel: novel._id }).sort({ number: 1 });
    await ChapterAccess.create({ user: user._id, chapter: chapters[2]._id, novel: novel._id });

    const quote = await accessService.quoteBulk({ user, novel, chapters });
    expect(quote.chapterCount).toBe(3);
  });

  it('quotes zero when everything is free or owned', async () => {
    const { user } = await createUser();
    const chapters = await Chapter.find({ novel: novel._id, number: { $lte: 2 } });
    const quote = await accessService.quoteBulk({ user, novel, chapters });
    expect(quote).toMatchObject({ chapterCount: 0, total: 0 });
  });

  it('does not commit anything', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 100, idempotencyKey: 'seed' });
    const chapters = await Chapter.find({ novel: novel._id });
    await accessService.quoteBulk({ user, novel, chapters });
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(100);
    expect(await ChapterAccess.countDocuments()).toBe(0);
  });
});

describe('purchaseSummary', () => {
  it('reports nothing for unpurchased chapters', async () => {
    const chapter = await createChapter(novel, { number: 1 });
    expect(await accessService.purchaseSummary([chapter._id])).toEqual({
      purchases: 0, credits: 0, usdCents: 0,
    });
  });

  it('totals purchases, credits and attributed cash', async () => {
    const chapter = await createChapter(novel, { number: 1 });
    const a = await createUser();
    const b = await createUser();
    await ChapterAccess.create({
      user: a.user._id, chapter: chapter._id, novel: novel._id, creditsSpent: 10, attributedUsdMicros: 83250,
    });
    await ChapterAccess.create({
      user: b.user._id, chapter: chapter._id, novel: novel._id, creditsSpent: 10, attributedUsdMicros: 83250,
    });

    expect(await accessService.purchaseSummary([chapter._id])).toEqual({
      purchases: 2, credits: 20, usdCents: 17,
    });
  });

  it('ignores free unlocks', async () => {
    const chapter = await createChapter(novel, { number: 1 });
    const { user } = await createUser();
    await ChapterAccess.create({
      user: user._id, chapter: chapter._id, novel: novel._id, creditsSpent: 0, source: 'free',
    });
    expect((await accessService.purchaseSummary([chapter._id])).purchases).toBe(0);
  });
});

describe('content guard refunds', () => {
  it('refunds every purchaser exactly once, even if re-run', async () => {
    await settingsService.update({ 'monetization.enabled': true });
    settingsService.clearCache();
    const chapter = await createChapter(novel, { number: 1 });
    const { user } = await createUser();
    await creditService.credit({ user, amount: 100, idempotencyKey: 'seed' });
    await creditService.debit({ user, amount: 10, idempotencyKey: 'spend' });
    await ChapterAccess.create({
      user: user._id, chapter: chapter._id, novel: novel._id, creditsSpent: 10,
    });

    const first = await contentGuard.refundPurchasers({ chapterIds: [chapter._id], reason: 'removed' });
    expect(first).toEqual({ refunded: 1, credits: 10 });
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(100);

    // Access rows are gone, so a second pass finds nothing to refund.
    const second = await contentGuard.refundPurchasers({ chapterIds: [chapter._id], reason: 'removed' });
    expect(second.refunded).toBe(0);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(100);
  });
});
