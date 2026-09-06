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
const RevenueEvent = require('../models/RevenueEvent');
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
const { ORDER_STATUS, CREDIT_TRANSACTION_TYPES } = require('../config/constants');

const dayBounds = (day) => ({
  from: new Date(`${day}T00:00:00.000Z`),
  to: new Date(`${day}T23:59:59.999Z`),
});

const dayKey = (date) => date.toISOString().slice(0, 10);

// Reserved `currency` value for the platform-wide totals row. Not a real
// currency, so it can never collide with a settlement currency.
const PLATFORM_ROW = '__ALL__';

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

  const [revenue, reads, impressions] = await Promise.all([
    // Revenue comes from the RevenueEvent ledger, NOT from ChapterAccess.
    //
    // ChapterAccess is an entitlement record: it is hard-deleted when a rental
    // lapses, never exists for an unmetered subscription cycle, and can fail to
    // insert while cash was still taken. Rebuilding revenue from it therefore
    // deleted money that had genuinely been earned, three days after the fact.
    // Events are append-only and signed, so refunds net out for free.
    RevenueEvent.aggregate([
      { $match: { occurredAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: '$chapter',
          novel: { $first: '$novel' },
          chapterNumber: { $max: '$chapterNumber' },
          unlocks: { $sum: { $cond: [{ $gt: ['$attributedUsdMicros', 0] }, 1, 0] } },
          zeroCashUnlocks: {
            $sum: { $cond: [{ $eq: ['$attributedUsdMicros', 0] }, 1, 0] },
          },
          buyers: { $addToSet: { $cond: [{ $gt: ['$attributedUsdMicros', 0] }, '$user', '$$REMOVE'] } },
          creditsSpent: { $sum: '$creditsSpent' },
          attributedUsdMicros: { $sum: '$attributedUsdMicros' },
          // Frozen at the rate in force when each event happened, so changing
          // credits.perUsd cannot restate a closed day.
          faceValueUsdMicros: { $sum: '$faceValueUsdMicros' },
          grantFundedCredits: { $sum: '$grantFundedCredits' },
          refundedUsdMicros: {
            $sum: { $cond: [{ $lt: ['$attributedUsdMicros', 0] }, '$attributedUsdMicros', 0] },
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
  revenue.forEach((row) => {
    const entry = touch(row._id, { novel: row.novel, chapterNumber: row.chapterNumber || 0 });
    if (!entry.chapterNumber && row.chapterNumber) entry.chapterNumber = row.chapterNumber;
    entry.unlocks = row.unlocks + row.zeroCashUnlocks;
    entry.uniqueBuyers = row.buyers.length;
    entry.creditsSpent = row.creditsSpent;
    entry.attributedUsdMicros = row.attributedUsdMicros;
    entry.faceValueUsdMicros = row.faceValueUsdMicros;
    entry.grantFundedCredits = row.grantFundedCredits;
    // Stored positive; the sign already netted out of attributedUsdMicros.
    entry.refundedUsdMicros = Math.abs(row.refundedUsdMicros);
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
            refundedUsdMicros: entry.refundedUsdMicros || 0,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  return merged.size;
};

/**
 * Per-novel rollup for one day.
 *
 * Counters sum from the chapter rows, but unique readers and buyers do NOT —
 * summing per-chapter uniques counts a reader once per chapter they opened, so
 * one person reading ten chapters arrived as ten readers. Those two figures are
 * therefore recomputed as true distinct counts over the day.
 */
const rebuildNovelDay = async (day) => {
  const { from, to } = dayBounds(day);

  const [rows, readerRows, buyerRows] = await Promise.all([
    ChapterStatsDaily.aggregate([
      { $match: { day } },
      {
        $group: {
          _id: '$novel',
          reads: { $sum: '$reads' },
          gateImpressions: { $sum: '$gateImpressions' },
          unlocks: { $sum: '$unlocks' },
          creditsEarned: { $sum: '$creditsSpent' },
          attributedUsdMicros: { $sum: '$attributedUsdMicros' },
          faceValueUsdMicros: { $sum: '$faceValueUsdMicros' },
          grantFundedCredits: { $sum: '$grantFundedCredits' },
          refundedUsdMicros: { $sum: '$refundedUsdMicros' },
          chaptersWithActivity: { $sum: 1 },
        },
      },
    ]),
    ChapterRead.aggregate([
      { $match: { lastReadAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$novel', readers: { $addToSet: '$readerKey' } } },
      { $project: { readers: { $size: '$readers' } } },
    ]),
    RevenueEvent.aggregate([
      { $match: { occurredAt: { $gte: from, $lte: to }, attributedUsdMicros: { $gt: 0 } } },
      { $group: { _id: '$novel', buyers: { $addToSet: '$user' } } },
      { $project: { buyers: { $size: '$buyers' } } },
    ]),
  ]);
  if (!rows.length) return 0;

  const readersByNovel = new Map(readerRows.map((row) => [String(row._id), row.readers]));
  const buyersByNovel = new Map(buyerRows.map((row) => [String(row._id), row.buyers]));

  // Attribution is denormalized so an earnings report never joins, and so the
  // history stays correct if a novel is later reassigned.
  //
  // Preferred source is the RevenueEvent rows themselves, which captured the
  // author at the moment the money was earned. The novel lookup is only a
  // fallback for days with reads but no revenue — and it passes withDeleted,
  // because a novel in the trash still earned what it earned and dropping its
  // author here silently moved historical earnings to "(unattributed)".
  const novelIds = rows.map((r) => r._id);
  const [eventAttribution, novels] = await Promise.all([
    RevenueEvent.aggregate([
      { $match: { occurredAt: { $gte: from, $lte: to }, novel: { $in: novelIds } } },
      { $sort: { occurredAt: -1 } },
      { $group: { _id: '$novel', author: { $first: '$author' }, authorName: { $first: '$authorName' } } },
    ]),
    Novel.find({ _id: { $in: novelIds } })
      .select('author authorRef')
      .populate({ path: 'authorRef', select: 'name' })
      .setOptions({ withDeleted: true }),
  ]);

  const fromEvents = new Map(eventAttribution.map((row) => [String(row._id), row]));
  const byNovel = new Map(novels.map((novel) => [String(novel._id), novel]));

  await NovelRevenueDaily.bulkWrite(
    rows.map((row) => {
      const key = String(row._id);
      const event = fromEvents.get(key);
      const novel = byNovel.get(key);
      return {
        updateOne: {
          filter: { day, novel: row._id },
          update: {
            $set: {
              author: event?.author || novel?.authorRef?._id || null,
              authorName: event?.authorName || novel?.authorRef?.name || novel?.author || '',
              readers: readersByNovel.get(key) || 0,
              reads: row.reads,
              gateImpressions: row.gateImpressions,
              unlocks: row.unlocks,
              uniqueBuyers: buyersByNovel.get(key) || 0,
              creditsEarned: row.creditsEarned,
              attributedUsdMicros: row.attributedUsdMicros,
              faceValueUsdMicros: row.faceValueUsdMicros,
              grantFundedCredits: row.grantFundedCredits,
              refundedUsdMicros: row.refundedUsdMicros,
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
      {
        $group: {
          _id: '$type',
          credits: { $sum: '$amount' },
          micros: { $sum: '$attributedUsdMicros' },
          // Expiry writes attributedUsdMicros: 0 (nothing was earned) but keeps
          // the tranche's unspent cost in the breakdown. That is the forfeit.
          forfeitMicros: { $sum: { $sum: '$bucketBreakdown.costMicros' } },
        },
      },
    ]),
    ChapterStatsDaily.aggregate([
      { $match: { day } },
      {
        $group: {
          _id: null,
          micros: { $sum: '$attributedUsdMicros' },
          reversed: { $sum: '$refundedUsdMicros' },
        },
      },
    ]),
    // A running balance, so the liability line is meaningful on its own.
    CreditBucket.aggregate([
      { $match: { remaining: { $gt: 0 }, createdAt: { $lte: to } } },
      { $group: { _id: null, micros: { $sum: '$remainingCostMicros' } } },
    ]),
  ]);

  const byType = new Map(ledger.map((row) => [row._id, row]));
  const credits = (type) => Math.abs(byType.get(type)?.credits || 0);

  // Expired credits release their unspent cost basis as forfeited revenue:
  // money kept with no content delivered. The sweeper records the tranche cost
  // on the EXPIRE ledger row, so it is recoverable per day rather than only
  // visible in that job's return value.
  const forfeited = byType.get(CREDIT_TRANSACTION_TYPES.EXPIRE);
  const forfeitedUsdMicros = forfeited
    ? (forfeited.forfeitMicros || 0)
    : 0;

  const shared = {
    creditsGranted: credits(CREDIT_TRANSACTION_TYPES.GRANT),
    creditsSpent: credits(CREDIT_TRANSACTION_TYPES.SPEND),
    creditsExpired: credits(CREDIT_TRANSACTION_TYPES.EXPIRE),
    recognizedUsdMicros: recognized[0]?.micros || 0,
    deferredUsdMicrosEnd: deferred[0]?.micros || 0,
    forfeitedUsdMicros,
    reversedUsdMicros: recognized[0]?.reversed || 0,
  };

  // With no orders there is still a credit story worth recording.
  const rows = orders.length ? orders : [];

  // Platform-wide figures live on their own row rather than riding along on
  // whichever currency happened to sort first. That previous arrangement left
  // stale shared totals on yesterday's leader when the day's currency mix
  // changed, so summing a day's rows double-counted recognized revenue.
  const writes = rows.map((row) => ({
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
          // Explicitly cleared: a currency row must never carry these, or a
          // row that held them under the old scheme keeps them forever.
          creditsGranted: 0,
          creditsSpent: 0,
          creditsExpired: 0,
          recognizedUsdMicros: 0,
          deferredUsdMicrosEnd: 0,
          forfeitedUsdMicros: 0,
          reversedUsdMicros: 0,
        },
      },
      upsert: true,
    },
  }));

  writes.push({
    updateOne: {
      filter: { day, currency: PLATFORM_ROW },
      update: { $set: shared },
      upsert: true,
    },
  });

  await RevenueDaily.bulkWrite(writes, { ordered: false });

  return writes.length;
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

module.exports = { PLATFORM_ROW, rebuildDay, rebuildRecent, rebuildChapterDay, rebuildNovelDay, rebuildRevenueDay, dayKey, recentDays };
