// Analytics queries.
//
// The headline one is the novel retention curve: unique readers per chapter
// alongside revenue per chapter, with the paywall boundary marked. The cliff at
// the paywall is what tells an admin their free-chapter count is wrong, and no
// table shows it as clearly.

const mongoose = require('mongoose');
const ChapterRead = require('../models/ChapterRead');
const GateImpression = require('../models/GateImpression');
const ChapterAccess = require('../models/ChapterAccess');
const Chapter = require('../models/Chapter');
const Novel = require('../models/Novel');
const accessService = require('./accessService');
const settingsService = require('./settingsService');
const { resolveChapterPrice } = require('../utils/chapterPricing');
const { MICROS_PER_CENT } = require('../config/constants');

const oid = (value) => new mongoose.Types.ObjectId(String(value));

const toMap = (rows, key = '_id') => new Map(rows.map((row) => [String(row[key]), row]));

/**
 * Per-chapter readership, revenue and conversion for one novel.
 *
 * Everything is keyed on chapter id and assembled in one pass so a 3000-chapter
 * novel is four aggregations, not four per chapter.
 */
const novelChapterPerformance = async (novelId) => {
  const novel = await Novel.findById(novelId);
  if (!novel) throw Object.assign(new Error('Novel not found'), { status: 404 });

  const [chapters, config, rules] = await Promise.all([
    Chapter.find({ novel: novel._id, published: true })
      .select('number title publishedAt wordCount accessType priceCredits freeAfterDays earlyAccessUntil originalNumber revenueLifetimeUsdMicros createdAt')
      .sort({ number: 1 }),
    accessService.pricingConfig(),
    accessService.loadRules(),
  ]);

  const [reads, impressions, unlocks] = await Promise.all([
    ChapterRead.aggregate([
      { $match: { novel: oid(novelId) } },
      { $group: { _id: '$chapter', readers: { $sum: 1 }, totalReads: { $sum: '$readCount' } } },
    ]),
    GateImpression.aggregate([
      { $match: { novel: oid(novelId) } },
      {
        $group: {
          _id: '$chapter',
          impressions: { $sum: 1 },
          uniqueBlocked: { $addToSet: '$readerKey' },
          couldAfford: { $sum: { $cond: ['$couldAfford', 1, 0] } },
        },
      },
      {
        $project: {
          impressions: 1,
          couldAfford: 1,
          uniqueBlocked: { $size: '$uniqueBlocked' },
        },
      },
    ]),
    ChapterAccess.aggregate([
      { $match: { novel: oid(novelId) } },
      {
        $group: {
          _id: '$chapter',
          unlocks: { $sum: 1 },
          credits: { $sum: '$creditsSpent' },
          micros: { $sum: '$attributedUsdMicros' },
        },
      },
    ]),
  ]);

  const readMap = toMap(reads);
  const gateMap = toMap(impressions);
  const unlockMap = toMap(unlocks);

  let peakReaders = 0;
  const rows = chapters.map((chapter) => {
    const key = String(chapter._id);
    const read = readMap.get(key);
    const gate = gateMap.get(key);
    const unlock = unlockMap.get(key);
    const priced = resolveChapterPrice({ novel, chapter, rules, config });

    const readers = read ? read.readers : 0;
    peakReaders = Math.max(peakReaders, readers);
    const blocked = gate ? gate.uniqueBlocked : 0;
    const unlockCount = unlock ? unlock.unlocks : 0;

    return {
      chapterId: chapter._id,
      number: chapter.number,
      title: chapter.title,
      publishedAt: chapter.publishedAt || chapter.createdAt,
      wordCount: chapter.wordCount,
      free: priced.free,
      priceCredits: priced.priceCredits,
      priceReason: priced.reason,
      readers,
      totalReads: read ? read.totalReads : 0,
      gateImpressions: gate ? gate.impressions : 0,
      uniqueBlocked: blocked,
      couldAffordButDidNot: gate ? Math.max(0, gate.couldAfford - unlockCount) : 0,
      unlocks: unlockCount,
      creditsEarned: unlock ? unlock.credits : 0,
      revenueUsdCents: unlock ? Math.round(unlock.micros / MICROS_PER_CENT) : 0,
      // Of the readers who were shown the wall, how many paid.
      conversionPct: blocked + unlockCount > 0 ? +((unlockCount / (blocked + unlockCount)) * 100).toFixed(1) : null,
    };
  });

  // Retention as a share of the novel's best-read chapter, so the curve is
  // comparable across novels of different sizes.
  rows.forEach((row) => {
    row.retentionPct = peakReaders ? +((row.readers / peakReaders) * 100).toFixed(1) : 0;
  });

  const firstPaid = rows.find((row) => !row.free);
  const lastFreeBefore = firstPaid ? rows.filter((r) => r.free && r.number < firstPaid.number).pop() : null;

  return {
    novel: { id: novel._id, title: novel.title, slug: novel.slug, chapterCount: chapters.length },
    paywall: firstPaid
      ? {
          firstPaidChapter: firstPaid.number,
          readersBefore: lastFreeBefore ? lastFreeBefore.readers : null,
          readersAfter: firstPaid.readers,
          // The single number that says whether the paywall sits too early.
          dropOffPct:
            lastFreeBefore && lastFreeBefore.readers
              ? +(((lastFreeBefore.readers - firstPaid.readers) / lastFreeBefore.readers) * 100).toFixed(1)
              : null,
          conversionPct: firstPaid.conversionPct,
        }
      : null,
    totals: {
      readers: rows.reduce((sum, row) => sum + row.readers, 0),
      unlocks: rows.reduce((sum, row) => sum + row.unlocks, 0),
      creditsEarned: rows.reduce((sum, row) => sum + row.creditsEarned, 0),
      revenueUsdCents: rows.reduce((sum, row) => sum + row.revenueUsdCents, 0),
      freeChapters: rows.filter((row) => row.free).length,
      paidChapters: rows.filter((row) => !row.free).length,
    },
    chapters: rows,
  };
};

/** Novel leaderboard for the analytics landing page. */
const novelLeaderboard = async ({ limit = 50 } = {}) => {
  const [revenue, readers] = await Promise.all([
    ChapterAccess.aggregate([
      {
        $group: {
          _id: '$novel',
          unlocks: { $sum: 1 },
          credits: { $sum: '$creditsSpent' },
          micros: { $sum: '$attributedUsdMicros' },
          payers: { $addToSet: '$user' },
        },
      },
      { $project: { unlocks: 1, credits: 1, micros: 1, payers: { $size: '$payers' } } },
      { $sort: { micros: -1 } },
      { $limit: limit },
    ]),
    ChapterRead.aggregate([{ $group: { _id: '$novel', readers: { $addToSet: '$readerKey' } } }, { $project: { readers: { $size: '$readers' } } }]),
  ]);

  const readerMap = toMap(readers);
  const novels = await Novel.find({ _id: { $in: revenue.map((row) => row._id) } }).select('title slug coverUrl author');
  const novelMap = toMap(novels, '_id');

  return revenue.map((row) => {
    const novel = novelMap.get(String(row._id));
    const readerRow = readerMap.get(String(row._id));
    const uniqueReaders = readerRow ? readerRow.readers : 0;
    return {
      novelId: row._id,
      title: novel ? novel.title : '(removed)',
      slug: novel ? novel.slug : null,
      coverUrl: novel ? novel.coverUrl : '',
      unlocks: row.unlocks,
      creditsEarned: row.credits,
      revenueUsdCents: Math.round(row.micros / MICROS_PER_CENT),
      payers: row.payers,
      readers: uniqueReaders,
      // The actionable ratio: high readers, low conversion means an
      // under-monetized novel.
      readerToPayerPct: uniqueReaders ? +((row.payers / uniqueReaders) * 100).toFixed(1) : null,
      arppuUsdCents: row.payers ? Math.round(row.micros / MICROS_PER_CENT / row.payers) : 0,
    };
  });
};

/** Paywall funnel: shown a wall → could afford → unlocked. */
const paywallFunnel = async ({ novelId = null, since = null } = {}) => {
  const match = {};
  if (novelId) match.novel = oid(novelId);
  if (since) match.at = { $gte: since };

  const [gate] = await GateImpression.aggregate([
    { $match: { ...match, reason: 'credits' } },
    {
      $group: {
        _id: null,
        impressions: { $sum: 1 },
        uniqueReaders: { $addToSet: '$readerKey' },
        couldAfford: { $sum: { $cond: ['$couldAfford', 1, 0] } },
      },
    },
    { $project: { impressions: 1, couldAfford: 1, uniqueReaders: { $size: '$uniqueReaders' } } },
  ]);

  const unlockMatch = {};
  if (novelId) unlockMatch.novel = oid(novelId);
  if (since) unlockMatch.unlockedAt = { $gte: since };
  const [unlock] = await ChapterAccess.aggregate([
    { $match: { ...unlockMatch, creditsSpent: { $gt: 0 } } },
    { $group: { _id: null, unlocks: { $sum: 1 }, buyers: { $addToSet: '$user' } } },
    { $project: { unlocks: 1, buyers: { $size: '$buyers' } } },
  ]);

  const shown = gate ? gate.uniqueReaders : 0;
  const afford = gate ? gate.couldAfford : 0;
  const unlocks = unlock ? unlock.unlocks : 0;

  return {
    stages: [
      { key: 'gate_shown', label: 'Shown the paywall', value: shown },
      { key: 'could_afford', label: 'Had enough credits', value: afford },
      { key: 'unlocked', label: 'Unlocked a chapter', value: unlocks },
    ],
    dropOff: {
      insufficientBalancePct: shown ? +(((shown - afford) / shown) * 100).toFixed(1) : null,
      abandonedWithBalancePct: afford ? +(((afford - unlocks) / afford) * 100).toFixed(1) : null,
    },
    conversionPct: shown ? +((unlocks / shown) * 100).toFixed(1) : null,
  };
};

/** Platform-level credit economy summary. */
const creditEconomy = async () => {
  const creditService = require('./creditService');
  const CreditTransaction = require('../models/CreditTransaction');

  const [byType, deferred] = await Promise.all([
    CreditTransaction.aggregate([
      { $group: { _id: '$type', credits: { $sum: '$amount' }, micros: { $sum: '$attributedUsdMicros' } } },
    ]),
    creditService.getDeferredRevenueMicros(),
  ]);

  const map = toMap(byType);
  const get = (type) => (map.get(type) ? map.get(type).credits : 0);
  const recognized = byType
    .filter((row) => row._id === 'spend')
    .reduce((sum, row) => sum + row.micros, 0);
  const snapshot = await settingsService.snapshot();

  return {
    creditsPurchased: get('purchase'),
    creditsGranted: get('grant'),
    creditsSpent: Math.abs(get('spend')),
    creditsExpired: Math.abs(get('expire')),
    recognizedUsdCents: Math.round(recognized / MICROS_PER_CENT),
    // Cash taken but not yet earned in content. A real liability, and the
    // number a generous grant campaign quietly inflates.
    deferredUsdCents: Math.round(deferred / MICROS_PER_CENT),
    creditsPerUsd: snapshot.get('credits.perUsd'),
  };
};

/**
 * Earnings grouped by author, for negotiating deals.
 *
 * Reads the daily rollups rather than scanning ChapterAccess, so it stays fast
 * as the catalogue grows. Novels with no linked author fall back to their
 * display string and are grouped under it — visible rather than silently
 * dropped, so unlinked novels are obvious.
 */
const authorEarnings = async ({ from = null, to = null } = {}) => {
  const NovelRevenueDaily = require('../models/NovelRevenueDaily');
  const match = {};
  if (from || to) {
    match.day = {};
    if (from) match.day.$gte = from;
    if (to) match.day.$lte = to;
  }

  const rows = await NovelRevenueDaily.aggregate([
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    {
      $group: {
        _id: { author: '$author', authorName: '$authorName' },
        novels: { $addToSet: '$novel' },
        unlocks: { $sum: '$unlocks' },
        creditsEarned: { $sum: '$creditsEarned' },
        attributedUsdMicros: { $sum: '$attributedUsdMicros' },
        faceValueUsdMicros: { $sum: '$faceValueUsdMicros' },
        grantFundedCredits: { $sum: '$grantFundedCredits' },
        readers: { $sum: '$readers' },
        refundedUsdMicros: { $sum: '$refundedUsdMicros' },
      },
    },
    { $sort: { attributedUsdMicros: -1 } },
  ]);

  return rows.map((row) => {
    const paidCredits = row.creditsEarned - row.grantFundedCredits;
    return {
      authorId: row._id.author,
      authorName: row._id.authorName || '(unattributed)',
      linked: Boolean(row._id.author),
      novelCount: row.novels.length,
      readers: row.readers,
      unlocks: row.unlocks,
      creditsEarned: row.creditsEarned,
      // Cash actually received for this author's chapters.
      revenueUsdCents: Math.round(row.attributedUsdMicros / MICROS_PER_CENT),
      // What credit face value would have claimed. The gap is bonus credits
      // and free grants, and it is worth showing before a negotiation.
      faceValueUsdCents: Math.round(row.faceValueUsdMicros / MICROS_PER_CENT),
      grantFundedCredits: row.grantFundedCredits,
      // Share of reading funded by credits the platform gave away. High here
      // means popular chapters that earned little — accurate, but it needs
      // explaining rather than defending.
      grantFundedPct: row.creditsEarned
        ? +((row.grantFundedCredits / row.creditsEarned) * 100).toFixed(1)
        : 0,
      paidCredits,
      refundedUsdCents: Math.round(row.refundedUsdMicros / MICROS_PER_CENT),
    };
  });
};

/** One author's novels, for the drill-down behind the earnings table. */
const authorNovelBreakdown = async (authorId, { from = null, to = null } = {}) => {
  const NovelRevenueDaily = require('../models/NovelRevenueDaily');
  const match = authorId === 'unattributed' ? { author: null } : { author: oid(authorId) };
  if (from || to) {
    match.day = {};
    if (from) match.day.$gte = from;
    if (to) match.day.$lte = to;
  }

  const rows = await NovelRevenueDaily.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$novel',
        unlocks: { $sum: '$unlocks' },
        creditsEarned: { $sum: '$creditsEarned' },
        attributedUsdMicros: { $sum: '$attributedUsdMicros' },
        grantFundedCredits: { $sum: '$grantFundedCredits' },
        readers: { $sum: '$readers' },
      },
    },
    { $sort: { attributedUsdMicros: -1 } },
  ]);

  const novels = await Novel.find({ _id: { $in: rows.map((r) => r._id) } }).select('title slug coverUrl');
  const byId = toMap(novels, '_id');

  return rows.map((row) => ({
    novelId: row._id,
    title: byId.get(String(row._id))?.title || '(removed)',
    slug: byId.get(String(row._id))?.slug || null,
    readers: row.readers,
    unlocks: row.unlocks,
    creditsEarned: row.creditsEarned,
    revenueUsdCents: Math.round(row.attributedUsdMicros / MICROS_PER_CENT),
    grantFundedCredits: row.grantFundedCredits,
  }));
};

module.exports = {
  novelChapterPerformance,
  novelLeaderboard,
  paywallFunnel,
  creditEconomy,
  authorEarnings,
  authorNovelBreakdown,
};
