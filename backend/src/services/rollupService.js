// Daily rollups.
//
// Analytics previously aggregated raw ChapterAccess and ChapterRead on every
// request. Correct, but it scans the whole history each time — fine at a
// thousand unlocks, not at a hundred thousand. These pre-aggregate once per day.
//
// Rebuild is idempotent: recomputing a day from source overwrites it, so a
// crashed run or a late-arriving webhook self-heals on the next pass rather
// than double-counting.

const mongoose = require('mongoose');
const ChapterAccess = require('../models/ChapterAccess');
const ChapterRead = require('../models/ChapterRead');
const GateImpression = require('../models/GateImpression');
const ChapterStatsDaily = require('../models/ChapterStatsDaily');
const NovelRevenueDaily = require('../models/NovelRevenueDaily');
const RevenueDaily = require('../models/RevenueDaily');
const CreditTransaction = require('../models/CreditTransaction');
const CreditBucket = require('../models/CreditBucket');
const Order = require('../models/Order');
const Novel = require('../models/Novel');
const settingsService = require('./settingsService');
const { MICROS_PER_CENT, ORDER_STATUS, CREDIT_TRANSACTION_TYPES } = require('../config/constants');

const dayBounds = (day) => ({
  from: new Date(`${day}T00:00:00.000Z`),
  to: new Date(`${day}T23:59:59.999Z`),
});

const dayKey = (date) => date.toISOString().slice(0, 10);

/** Days from `back` days ago through today, oldest first. */
const recentDays = (back) => {
  const days = [];
  for (let i = back; i >= 0; i -= 1) {
    days.push(dayKey(new Date(Date.now() - i * 86400000)));
  }
  return days;
};

/**
 * Per-chapter counters for one day, rebuilt from source.
 *
 * Reads and gate impressions are already incremented live at request time;
 * this recomputes the revenue side and reconciles the rest, so a missed
 * increment does not persist forever.
 */
const rebuildChapterDay = async (day) => {
  const { from, to } = dayBounds(day);
  const creditsPerUsd = await settingsService.get('credits.perUsd');

  const [unlocks, reads, impressions] = await Promise.all([
    ChapterAccess.aggregate([
      { $match: { unlockedAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: '$chapter',
          novel: { $first: '$novel' },
          unlocks: { $sum: 1 },
          buyers: { $addToSet: '$user' },
          creditsSpent: { $sum: '$creditsSpent' },
          attributedUsdMicros: { $sum: '$attributedUsdMicros' },
          // Credits spent with no cash behind them came from grants.
          grantFundedCredits: {
            $sum: { $cond: [{ $eq: ['$attributedUsdMicros', 0] }, '$creditsSpent', 0] },
          },
        },
      },
    ]),
    ChapterRead.aggregate([
      { $match: { lastReadAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$chapter', novel: { $first: '$novel' }, chapterNumber: { $first: '$chapterNumber' }, readers: { $sum: 1 }, reads: { $sum: '$readCount' } } },
    ]),
    GateImpression.aggregate([
      { $match: { at: { $gte: from, $lte: to } } },
      { $group: { _id: '$chapter', novel: { $first: '$novel' }, chapterNumber: { $first: '$chapterNumber' }, impressions: { $sum: 1 } } },
    ]),
  ]);

  const merged = new Map();
  const touch = (id, seed) => {
    const key = String(id);
    if (!merged.has(key)) merged.set(key, { chapter: id, ...seed });
    return merged.get(key);
  };

  reads.forEach((row) => {
    const entry = touch(row._id, { novel: row.novel, chapterNumber: row.chapterNumber });
    entry.reads = row.reads;
    entry.uniqueReaders = row.readers;
  });
  impressions.forEach((row) => {
    const entry = touch(row._id, { novel: row.novel, chapterNumber: row.chapterNumber });
    entry.gateImpressions = row.impressions;
  });
  unlocks.forEach((row) => {
    const entry = touch(row._id, { novel: row.novel, chapterNumber: 0 });
    entry.unlocks = row.unlocks;
    entry.uniqueBuyers = row.buyers.length;
    entry.creditsSpent = row.creditsSpent;
    entry.attributedUsdMicros = row.attributedUsdMicros;
    entry.grantFundedCredits = row.grantFundedCredits;
    entry.faceValueUsdMicros = creditsPerUsd
      ? Math.round((row.creditsSpent / creditsPerUsd) * 100 * MICROS_PER_CENT)
      : 0;
  });

  if (!merged.size) return 0;

  await ChapterStatsDaily.bulkWrite(
    [...merged.values()].map((entry) => ({
      updateOne: {
        filter: { day, chapter: entry.chapter },
        update: {
          $set: {
            novel: entry.novel,
            chapterNumber: entry.chapterNumber || 0,
            reads: entry.reads || 0,
            uniqueReaders: entry.uniqueReaders || 0,
            gateImpressions: entry.gateImpressions || 0,
            unlocks: entry.unlocks || 0,
            uniqueBuyers: entry.uniqueBuyers || 0,
            creditsSpent: entry.creditsSpent || 0,
            attributedUsdMicros: entry.attributedUsdMicros || 0,
            faceValueUsdMicros: entry.faceValueUsdMicros || 0,
            grantFundedCredits: entry.grantFundedCredits || 0,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  return merged.size;
};

/** Per-novel rollup for one day, summed from the chapter rows. */
const rebuildNovelDay = async (day) => {
  const rows = await ChapterStatsDaily.aggregate([
    { $match: { day } },
    {
      $group: {
        _id: '$novel',
        readers: { $sum: '$uniqueReaders' },
        reads: { $sum: '$reads' },
        gateImpressions: { $sum: '$gateImpressions' },
        unlocks: { $sum: '$unlocks' },
        uniqueBuyers: { $sum: '$uniqueBuyers' },
        creditsEarned: { $sum: '$creditsSpent' },
        attributedUsdMicros: { $sum: '$attributedUsdMicros' },
        faceValueUsdMicros: { $sum: '$faceValueUsdMicros' },
        grantFundedCredits: { $sum: '$grantFundedCredits' },
        chaptersWithActivity: { $sum: 1 },
      },
    },
  ]);
  if (!rows.length) return 0;

  // Attribution is denormalized so an earnings report never joins, and so the
  // history stays correct if a novel is later reassigned.
  const novels = await Novel.find({ _id: { $in: rows.map((r) => r._id) } })
    .select('author authorRef')
    .populate({ path: 'authorRef', select: 'name' });
  const byNovel = new Map(novels.map((novel) => [String(novel._id), novel]));

  await NovelRevenueDaily.bulkWrite(
    rows.map((row) => {
      const novel = byNovel.get(String(row._id));
      return {
        updateOne: {
          filter: { day, novel: row._id },
          update: {
            $set: {
              author: novel?.authorRef?._id || null,
              authorName: novel?.authorRef?.name || novel?.author || '',
              readers: row.readers,
              reads: row.reads,
              gateImpressions: row.gateImpressions,
              unlocks: row.unlocks,
              uniqueBuyers: row.uniqueBuyers,
              creditsEarned: row.creditsEarned,
              attributedUsdMicros: row.attributedUsdMicros,
              faceValueUsdMicros: row.faceValueUsdMicros,
              grantFundedCredits: row.grantFundedCredits,
              chaptersWithActivity: row.chaptersWithActivity,
            },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false }
  );

  return rows.length;
};

/** Platform totals for one day. Cash from orders, credits from the ledger. */
const rebuildRevenueDay = async (day) => {
  const { from, to } = dayBounds(day);

  const [orders, ledger, recognized, deferred] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: '$chargeCurrency',
          orders: { $sum: 1 },
          capturedOrders: { $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.CAPTURED] }, 1, 0] } },
          failedOrders: { $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.FAILED] }, 1, 0] } },
          grossUsdCents: { $sum: { $cond: [{ $ne: ['$creditedAt', null] }, '$baseUsdCents', 0] } },
          discountUsdCents: { $sum: '$discountUsdCents' },
          taxUsdCents: { $sum: '$taxUsdCents' },
          feeUsdCents: { $sum: '$paypalFeeUsdCents' },
          netUsdCents: { $sum: { $cond: [{ $ne: ['$creditedAt', null] }, '$netUsdCents', 0] } },
          refundUsdCents: { $sum: '$refundedUsdCents' },
          creditsIssued: { $sum: { $cond: [{ $ne: ['$creditedAt', null] }, '$totalCredits', 0] } },
        },
      },
    ]),
    CreditTransaction.aggregate([
      { $match: { createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$type', credits: { $sum: '$amount' }, micros: { $sum: '$attributedUsdMicros' } } },
    ]),
    ChapterStatsDaily.aggregate([
      { $match: { day } },
      { $group: { _id: null, micros: { $sum: '$attributedUsdMicros' } } },
    ]),
    // A running balance, so the liability line is meaningful on its own.
    CreditBucket.aggregate([
      { $match: { remaining: { $gt: 0 }, createdAt: { $lte: to } } },
      { $group: { _id: null, micros: { $sum: '$remainingCostMicros' } } },
    ]),
  ]);

  const byType = new Map(ledger.map((row) => [row._id, row]));
  const credits = (type) => Math.abs(byType.get(type)?.credits || 0);

  const shared = {
    creditsGranted: credits(CREDIT_TRANSACTION_TYPES.GRANT),
    creditsSpent: credits(CREDIT_TRANSACTION_TYPES.SPEND),
    creditsExpired: credits(CREDIT_TRANSACTION_TYPES.EXPIRE),
    recognizedUsdMicros: recognized[0]?.micros || 0,
    deferredUsdMicrosEnd: deferred[0]?.micros || 0,
  };

  // With no orders there is still a credit story worth recording.
  const rows = orders.length ? orders : [{ _id: 'USD' }];

  await RevenueDaily.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { day, currency: row._id || 'USD' },
        update: {
          $set: {
            orders: row.orders || 0,
            capturedOrders: row.capturedOrders || 0,
            failedOrders: row.failedOrders || 0,
            grossUsdCents: row.grossUsdCents || 0,
            discountUsdCents: row.discountUsdCents || 0,
            taxUsdCents: row.taxUsdCents || 0,
            feeUsdCents: row.feeUsdCents || 0,
            netUsdCents: row.netUsdCents || 0,
            refundUsdCents: row.refundUsdCents || 0,
            creditsIssued: row.creditsIssued || 0,
            // Shared figures are platform-wide, so they land on the first
            // currency row only rather than being counted once per currency.
            ...(row._id === (orders[0]?._id || 'USD') ? shared : {}),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  return rows.length;
};

/** Rebuild every level for one day. */
const rebuildDay = async (day) => {
  const chapters = await rebuildChapterDay(day);
  const novels = await rebuildNovelDay(day);
  const currencies = await rebuildRevenueDay(day);
  return { day, chapters, novels, currencies };
};

/**
 * Rebuild a trailing window.
 *
 * Covers late webhooks and refunds that land after the day they belong to —
 * yesterday's numbers can still change today, so recomputing only the current
 * day would leave them permanently wrong.
 */
const rebuildRecent = async (days = 3) => {
  const results = [];
  for (const day of recentDays(days)) {
    results.push(await rebuildDay(day));
  }
  return {
    days: results.length,
    chapters: results.reduce((sum, r) => sum + r.chapters, 0),
    novels: results.reduce((sum, r) => sum + r.novels, 0),
  };
};

module.exports = { rebuildDay, rebuildRecent, rebuildChapterDay, rebuildNovelDay, rebuildRevenueDay, dayKey, recentDays };
