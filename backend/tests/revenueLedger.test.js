// Regression coverage for the revenue gaps.
//
// Each block here corresponds to a way the old code lost or invented money.
// They are written as "the money is still there afterwards" assertions rather
// than as unit tests of the fix, because the failure mode in every case was
// that the number looked fine until something else ran.

const rollupService = require('../src/services/rollupService');
const revenueService = require('../src/services/revenueService');
const revenueReportService = require('../src/services/revenueReportService');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const accessService = require('../src/services/accessService');
const orderService = require('../src/services/orderService');
const RevenueEvent = require('../src/models/RevenueEvent');
const ChapterAccess = require('../src/models/ChapterAccess');
const ChapterStatsDaily = require('../src/models/ChapterStatsDaily');
const NovelRevenueDaily = require('../src/models/NovelRevenueDaily');
const Novel = require('../src/models/Novel');
const Order = require('../src/models/Order');
const Chapter = require('../src/models/Chapter');
const ChapterRead = require('../src/models/ChapterRead');
const { createUser, createNovel, createChapter } = require('./helpers');

const today = () => new Date().toISOString().slice(0, 10);

/** `revenueLifetimeUsdMicros` is select:false, so it must be asked for. */
const lifetimeOf = async (chapterId) =>
  (await Chapter.findById(chapterId).select('+revenueLifetimeUsdMicros')).revenueLifetimeUsdMicros;

let novel;
let chapter;

const enable = () =>
  settingsService
    .update({
      'monetization.enabled': true,
      'pricing.defaultChapterCredits': 10,
      'pricing.defaultFreeChapterCount': 0,
      'credits.perUsd': 100,
    })
    .then(() => settingsService.clearCache());

/** A reader holding `credits` that cost `cash` cents. */
const buyer = async (credits = 1200, cash = 999) => {
  const { user } = await createUser();
  await creditService.credit({
    user,
    amount: credits,
    type: 'purchase',
    source: 'purchase',
    costUsdCents: cash,
    idempotencyKey: `pack:${user._id}:${Math.random()}`,
  });
  return user;
};

beforeEach(async () => {
  settingsService.clearCache();
  await enable();
  novel = await createNovel({ slug: `rev-${Date.now()}`, author: 'A. Writer' });
  chapter = await createChapter(novel, { number: 1 });
});

describe('face value is frozen at spend time', () => {
  it('does not move when credits.perUsd changes afterwards', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });

    await rollupService.rebuildChapterDay(today());
    const before = await ChapterStatsDaily.findOne({ day: today(), chapter: chapter._id });
    // 10 credits at 100/USD = $0.10.
    expect(before.faceValueUsdMicros).toBe(100000);

    // The admin re-prices credits. Nothing about a sale that already happened
    // should change — this used to restate every rebuilt day.
    await settingsService.update({ 'credits.perUsd': 20 });
    settingsService.clearCache();
    await rollupService.rebuildChapterDay(today());

    const after = await ChapterStatsDaily.findOne({ day: today(), chapter: chapter._id });
    expect(after.faceValueUsdMicros).toBe(100000);
    expect(after.attributedUsdMicros).toBe(before.attributedUsdMicros);
  });

  it('prices a later sale at the new rate', async () => {
    await settingsService.update({ 'credits.perUsd': 20 });
    settingsService.clearCache();
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });

    const event = await RevenueEvent.findOne({ chapter: chapter._id });
    // 10 credits at 20/USD = $0.50.
    expect(event.faceValueUsdMicros).toBe(500000);
    expect(event.creditsPerUsdAtEvent).toBe(20);
  });
});

describe('revenue survives things that delete entitlements', () => {
  it('keeps a rental unlock after the rental lapses', async () => {
    const rental = await createNovel({
      slug: `rental-${Date.now()}`,
      monetization: { accessMode: 'rental', rentalHours: 1 },
    });
    const rentalChapter = await createChapter(rental, { number: 1 });
    const user = await buyer();
    await accessService.unlockChapter({ user, novel: rental, chapter: rentalChapter });

    // The rental sweeper hard-deletes access rows. Rebuilding revenue from
    // ChapterAccess therefore erased the sale entirely.
    await ChapterAccess.deleteMany({ chapter: rentalChapter._id });
    await rollupService.rebuildChapterDay(today());

    const row = await ChapterStatsDaily.findOne({ day: today(), chapter: rentalChapter._id });
    expect(row.attributedUsdMicros).toBeGreaterThan(0);
    expect(row.unlocks).toBe(1);
  });

  it('keeps subscription cycle attribution across a rebuild', async () => {
    await revenueService.record({
      chapter: chapter._id,
      novel: novel._id,
      chapterNumber: 1,
      kind: 'subscription_cycle',
      creditsSpent: 0,
      attributedUsdMicros: 250000,
      idempotencyKey: `sub-cycle-test:${chapter._id}`,
    });

    // No ChapterAccess row exists for an unmetered subscriber, so the old
    // rebuild wiped this within the trailing window.
    await rollupService.rebuildChapterDay(today());
    const row = await ChapterStatsDaily.findOne({ day: today(), chapter: chapter._id });
    expect(row.attributedUsdMicros).toBe(250000);
  });
});

describe('refunds reverse recognized revenue', () => {
  it('takes chapter revenue back down when an order is refunded', async () => {
    const { user } = await createUser();
    const order = await Order.create({
      user: user._id,
      orderNumber: `TEST-${Date.now()}`,
      status: 'captured',
      credits: 1200,
      totalCredits: 1200,
      baseUsdCents: 999,
      netUsdCents: 999,
      chargeCurrency: 'USD',
      chargeAmountMinor: 999,
      creditedAt: new Date(),
    });
    await creditService.credit({
      user,
      amount: 1200,
      type: 'purchase',
      source: 'purchase',
      costUsdCents: 999,
      refType: 'order',
      refId: order._id,
      sourceRef: order._id,
      idempotencyKey: `order:${order._id}:capture`,
    });

    await accessService.unlockChapter({ user, novel, chapter });
    const recognized = (await lifetimeOf(chapter._id));
    expect(recognized).toBeGreaterThan(0);

    await orderService.clawbackOrder(order, { source: 'admin' });

    // The negative event nets the chapter back to zero, and the lifetime
    // counter follows it. Previously the money stayed in author earnings.
    expect(await lifetimeOf(chapter._id)).toBe(0);

    await rollupService.rebuildChapterDay(today());
    const row = await ChapterStatsDaily.findOne({ day: today(), chapter: chapter._id });
    expect(row.attributedUsdMicros).toBe(0);
    expect(row.refundedUsdMicros).toBe(recognized);
  });
});

describe('novel-level uniques are distinct, not summed', () => {
  it('counts one reader of three chapters as one reader', async () => {
    const two = await createChapter(novel, { number: 2 });
    const three = await createChapter(novel, { number: 3 });
    for (const target of [chapter, two, three]) {
      await ChapterRead.create({
        readerKey: 'u:reader-1',
        chapter: target._id,
        novel: novel._id,
        chapterNumber: target.number,
        readCount: 1,
      });
    }

    await rollupService.rebuildChapterDay(today());
    await rollupService.rebuildNovelDay(today());

    const row = await NovelRevenueDaily.findOne({ day: today(), novel: novel._id });
    // Summing per-chapter uniques reported 3.
    expect(row.readers).toBe(1);
    expect(row.reads).toBe(3);
  });
});

describe('author attribution survives the novel being binned', () => {
  it('still reports earnings for a soft-deleted novel', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });
    await Novel.updateOne({ _id: novel._id }, { deletedAt: new Date() });

    await rollupService.rebuildChapterDay(today());
    await rollupService.rebuildNovelDay(today());

    const row = await NovelRevenueDaily.findOne({ day: today(), novel: novel._id });
    // The lookup used to miss the binned novel and blank the author, moving
    // history into "(unattributed)".
    expect(row.authorName).toBe('A. Writer');
    expect(row.attributedUsdMicros).toBeGreaterThan(0);
  });
});

describe('reversing a spend keeps its cost basis', () => {
  it('returns credits to the tranche they came from', async () => {
    const user = await buyer(100, 500); // 100 credits for $5
    const before = await creditService.getDeferredRevenueMicros(user._id);

    const debited = await creditService.debit({
      user,
      amount: 10,
      idempotencyKey: `spend:${user._id}`,
      reason: 'test',
    });
    expect(debited.attributedUsdMicros).toBe(500000);

    await creditService.reverseSpend({
      user,
      transaction: debited.transaction,
      idempotencyKey: `spend:${user._id}:reversal`,
      reason: 'test reversal',
    });

    // A plain credit would have minted a zero-cost tranche and the $0.50 would
    // be neither deferred nor recognized — it would simply be gone.
    expect(await creditService.getDeferredRevenueMicros(user._id)).toBe(before);
    expect(await creditService.getBalance(user)).toBe(100);
  });
});

describe('ranged reporting', () => {
  it('reports a window and its comparison', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });

    const result = await revenueReportService.summary({ days: 7, compare: true, granularity: 'day' });
    expect(result.totals.revenueUsdCents).toBeGreaterThan(0);
    expect(result.series).toHaveLength(7);
    expect(result.range.comparedTo).not.toBeNull();
    expect(result.totals.previous.revenueUsdCents).toBe(0);
  });

  it('breaks the window down by novel and by chapter', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });

    const novels = await revenueReportService.novelBreakdown({ days: 30 });
    expect(novels[0].novelId.toString()).toBe(novel._id.toString());
    expect(novels[0].unlocks).toBe(1);

    const chapters = await revenueReportService.chapterBreakdown(novel._id, { days: 30 });
    expect(chapters).toHaveLength(1);
    expect(chapters[0].revenueUsdCents).toBeGreaterThan(0);
  });

  it('excludes a window with no activity', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });

    const past = await revenueReportService.summary({ from: '2020-01-01', to: '2020-01-31' });
    expect(past.totals.revenueUsdCents).toBe(0);
    expect(past.totals.unlocks).toBe(0);
  });
});

describe('a chapter bought twice is earned from twice', () => {
  it('records a second sale after the first entitlement is gone', async () => {
    const rental = await createNovel({
      slug: `twice-${Date.now()}`,
      monetization: { accessMode: 'rental', rentalHours: 1 },
    });
    const target = await createChapter(rental, { number: 1 });
    const user = await buyer();

    await accessService.unlockChapter({ user, novel: rental, chapter: target });
    // The rental lapses and the sweeper removes the entitlement.
    await ChapterAccess.deleteMany({ chapter: target._id });
    await accessService.unlockChapter({ user, novel: rental, chapter: target });

    // Keying revenue on (user, chapter) swallowed the second sale as a
    // duplicate: real credits charged, no ledger row, money simply gone.
    const events = await RevenueEvent.find({ chapter: target._id });
    expect(events).toHaveLength(2);
    const total = events.reduce((sum, row) => sum + row.attributedUsdMicros, 0);
    expect((await lifetimeOf(target._id))).toBe(total);
  });
});

describe('partial refunds', () => {
  const orderFor = async (user, credits = 1000, cents = 1000) => {
    const order = await Order.create({
      user: user._id,
      orderNumber: `PR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: 'captured',
      credits,
      totalCredits: credits,
      baseUsdCents: cents,
      netUsdCents: cents,
      chargeCurrency: 'USD',
      chargeAmountMinor: cents,
      creditedAt: new Date(),
    });
    await creditService.credit({
      user,
      amount: credits,
      type: 'purchase',
      source: 'purchase',
      costUsdCents: cents,
      refType: 'order',
      refId: order._id,
      sourceRef: order._id,
      idempotencyKey: `order:${order._id}:capture`,
    });
    return order;
  };

  it('does not reverse more than was refunded', async () => {
    const { user } = await createUser();
    const order = await orderFor(user);
    await accessService.unlockChapter({ user, novel, chapter });
    const recognized = (await lifetimeOf(chapter._id));

    await orderService.clawbackOrder(order, { refundedUsdCents: 500, source: 'admin' });

    // Half the money went back, so half the recognized revenue comes back —
    // and only half the credits are clawed. Reversing all the credits AND a
    // ratioed share of revenue took back more than the refund.
    const after = (await lifetimeOf(chapter._id));
    expect(after).toBe(recognized - Math.round(recognized * 0.5));
  });

  it('posts the difference when a partial refund is escalated to a full one', async () => {
    const { user } = await createUser();
    const order = await orderFor(user);
    await accessService.unlockChapter({ user, novel, chapter });
    const recognized = (await lifetimeOf(chapter._id));

    await orderService.clawbackOrder(order, { refundedUsdCents: 500, source: 'admin' });
    await orderService.clawbackOrder(order, { refundedUsdCents: 1000, source: 'admin' });

    // A key without a refund round collided on the second pass and silently
    // reversed nothing, leaving half the refunded revenue in author earnings.
    expect((await lifetimeOf(chapter._id))).toBe(0);
    const reversals = await RevenueEvent.find({ order: order._id, attributedUsdMicros: { $lt: 0 } });
    expect(reversals.reduce((sum, row) => sum + Math.abs(row.attributedUsdMicros), 0)).toBe(recognized);
  });

  it('is idempotent when the same webhook is replayed', async () => {
    const { user } = await createUser();
    const order = await orderFor(user);
    await accessService.unlockChapter({ user, novel, chapter });

    await orderService.clawbackOrder(order, { refundedUsdCents: 1000, source: 'admin' });
    const afterFirst = (await lifetimeOf(chapter._id));
    await orderService.clawbackOrder(order, { refundedUsdCents: 1000, source: 'admin' });

    expect((await lifetimeOf(chapter._id))).toBe(afterFirst);
  });
});

describe('removing paid content un-books its revenue', () => {
  it('reverses the chapter revenue when purchasers are refunded', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });
    expect((await lifetimeOf(chapter._id))).toBeGreaterThan(0);

    await require('../src/services/contentGuardService').refundPurchasers({
      chapterIds: [chapter._id],
      reason: 'content removed',
    });

    // Deleting the access rows used to be enough. Now that rollups rebuild
    // from the ledger, the reader would get their credits back while the
    // author kept the money.
    expect((await lifetimeOf(chapter._id))).toBe(0);
    await rollupService.rebuildChapterDay(today());
    const row = await ChapterStatsDaily.findOne({ day: today(), chapter: chapter._id });
    expect(row.attributedUsdMicros).toBe(0);
  });
});

describe('grant-funded share of a mixed spend', () => {
  it('counts only the credits that carried no cash', async () => {
    const { user } = await createUser();
    // 5 granted credits, then 5 bought. Expiry-first consumption drains the
    // granted tranche before the purchased one.
    await creditService.credit({
      user, amount: 5, type: 'grant', source: 'grant', idempotencyKey: `g:${user._id}`,
    });
    await creditService.credit({
      user, amount: 5, type: 'purchase', source: 'purchase', costUsdCents: 500,
      idempotencyKey: `p:${user._id}`,
    });

    await accessService.unlockChapter({ user, novel, chapter });

    const event = await RevenueEvent.findOne({ chapter: chapter._id });
    // Deriving this from "attributed === 0" reported 0% free-funded for any
    // spend that touched a paid tranche at all.
    expect(event.creditsSpent).toBe(10);
    expect(event.grantFundedCredits).toBe(5);
    expect(event.attributedUsdMicros).toBe(5000000);
  });
});

describe('reporting rows account for every dollar', () => {
  it('keeps a row for a chapter that sold and was then unpublished', async () => {
    const user = await buyer();
    await accessService.unlockChapter({ user, novel, chapter });
    await Chapter.updateOne({ _id: chapter._id }, { published: false });

    const rows = await revenueReportService.chapterBreakdown(novel._id, { days: 30 });
    const summary = await revenueReportService.summary({ days: 30, novelId: novel._id });

    // Otherwise the table silently sums to less than the header above it.
    expect(rows.reduce((sum, row) => sum + row.revenueUsdCents, 0)).toBe(summary.totals.revenueUsdCents);
    expect(rows.some((row) => row.unavailable)).toBe(true);
  });
});
