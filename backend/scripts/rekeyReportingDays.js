/**
 * Re-key stored day buckets from UTC days to IST days.
 *
 *   node scripts/rekeyReportingDays.js            # dry run — reports, writes nothing
 *   node scripts/rekeyReportingDays.js --apply    # write
 *
 * Run once, after deploying the change that made utils/reportingDay the day
 * calendar. Safe to re-run: every step recomputes from source.
 *
 * WHAT IT DOES
 *
 * 1. RevenueEvent.day — recomputed from occurredAt. Only the denormalized key
 *    changes; amounts, signs and timestamps are untouched. This goes through the
 *    raw collection on purpose: the model blocks updates to keep the ledger
 *    append-only, and that guard is about money, not about a derived label.
 * 2. Revenue fields on ChapterStatsDaily and NovelRevenueDaily — zeroed, then
 *    re-summed from the ledger per IST day. Author earnings read these.
 * 3. RevenueDaily — deleted and rebuilt day by day. Every field in it is
 *    derived from Order / CreditTransaction / the step-2 rows, so nothing is lost.
 *
 * WHAT IT CANNOT DO
 *
 * Read counts, unique readers and gate impressions on the daily rows were
 * incremented live and cannot be re-bucketed: the per-hour detail is gone.
 * Historical rows keep their counts under the same date label, so a past
 * "2026-10-01" read figure still covers 05:30–05:30 IST rather than
 * 00:00–24:00. Revenue is exact; reads before the cutover are approximate.
 * They are deliberately NOT rebuilt from ChapterRead, which only remembers the
 * last day each reader came back and would overwrite real history with less.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

const RevenueEvent = require('../src/models/RevenueEvent');
const ChapterStatsDaily = require('../src/models/ChapterStatsDaily');
const NovelRevenueDaily = require('../src/models/NovelRevenueDaily');
const RevenueDaily = require('../src/models/RevenueDaily');
const Order = require('../src/models/Order');
const CreditTransaction = require('../src/models/CreditTransaction');
const { rebuildRevenueDay } = require('../src/services/rollupService');
const { REPORTING_TZ, dayKey, shiftDay } = require('../src/utils/reportingDay');

const APPLY = process.argv.includes('--apply');
const BATCH = 1000;

const CHAPTER_REVENUE_ZERO = {
  unlocks: 0,
  uniqueBuyers: 0,
  creditsSpent: 0,
  attributedUsdMicros: 0,
  faceValueUsdMicros: 0,
  grantFundedCredits: 0,
  refundedUsdMicros: 0,
};
const NOVEL_REVENUE_ZERO = {
  unlocks: 0,
  uniqueBuyers: 0,
  creditsEarned: 0,
  attributedUsdMicros: 0,
  faceValueUsdMicros: 0,
  grantFundedCredits: 0,
  refundedUsdMicros: 0,
};

// Day key of occurredAt in IST, computed inside Mongo so it matches dayKey().
const istDay = { $dateToString: { date: '$occurredAt', format: '%Y-%m-%d', timezone: REPORTING_TZ } };

const flush = async (collection, ops) => {
  if (!ops.length) return 0;
  if (APPLY) await collection.bulkWrite(ops.splice(0), { ordered: false });
  else ops.splice(0);
  return 0;
};

const rekeyEvents = async () => {
  let checked = 0;
  let changed = 0;
  const ops = [];
  const cursor = RevenueEvent.collection.find({}, { projection: { occurredAt: 1, day: 1 } });
  for await (const doc of cursor) {
    checked += 1;
    const next = dayKey(doc.occurredAt);
    if (next !== doc.day) {
      changed += 1;
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { day: next } } } });
      if (ops.length >= BATCH) await flush(RevenueEvent.collection, ops);
    }
  }
  await flush(RevenueEvent.collection, ops);
  console.log(`RevenueEvent: ${checked} checked, ${changed} day keys ${APPLY ? 'rewritten' : 'would change'}`);
};

const rebuildChapterRevenue = async () => {
  const rows = await RevenueEvent.aggregate([
    { $group: {
      _id: { day: istDay, chapter: '$chapter' },
      novel: { $first: '$novel' },
      chapterNumber: { $max: '$chapterNumber' },
      unlocks: { $sum: { $cond: [{ $gte: ['$attributedUsdMicros', 0] }, 1, 0] } },
      buyers: { $addToSet: { $cond: [{ $gt: ['$attributedUsdMicros', 0] }, '$user', '$$REMOVE'] } },
      creditsSpent: { $sum: '$creditsSpent' },
      attributedUsdMicros: { $sum: '$attributedUsdMicros' },
      faceValueUsdMicros: { $sum: '$faceValueUsdMicros' },
      grantFundedCredits: { $sum: '$grantFundedCredits' },
      refundedUsdMicros: { $sum: { $cond: [{ $lt: ['$attributedUsdMicros', 0] }, '$attributedUsdMicros', 0] } },
    } },
  ]).allowDiskUse(true);

  console.log(`ChapterStatsDaily: ${rows.length} chapter-days carry revenue in IST`);
  if (!APPLY) return;

  await ChapterStatsDaily.collection.updateMany({}, { $set: CHAPTER_REVENUE_ZERO });
  const ops = rows.map((row) => ({
    updateOne: {
      filter: { day: row._id.day, chapter: row._id.chapter },
      update: {
        $set: {
          unlocks: row.unlocks,
          uniqueBuyers: row.buyers.length,
          creditsSpent: row.creditsSpent,
          attributedUsdMicros: row.attributedUsdMicros,
          faceValueUsdMicros: row.faceValueUsdMicros,
          grantFundedCredits: row.grantFundedCredits,
          refundedUsdMicros: Math.abs(row.refundedUsdMicros),
        },
        $setOnInsert: {
          novel: row.novel,
          chapterNumber: row.chapterNumber || 0,
          reads: 0,
          uniqueReaders: 0,
          gateImpressions: 0,
          createdAt: new Date(),
        },
      },
      upsert: true,
    },
  }));
  for (let i = 0; i < ops.length; i += BATCH) {
    await ChapterStatsDaily.collection.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
  }
};

const rebuildNovelRevenue = async () => {
  const [sums, people] = await Promise.all([
    ChapterStatsDaily.aggregate([
      { $group: {
        _id: { day: '$day', novel: '$novel' },
        reads: { $sum: '$reads' },
        gateImpressions: { $sum: '$gateImpressions' },
        unlocks: { $sum: '$unlocks' },
        creditsEarned: { $sum: '$creditsSpent' },
        attributedUsdMicros: { $sum: '$attributedUsdMicros' },
        faceValueUsdMicros: { $sum: '$faceValueUsdMicros' },
        grantFundedCredits: { $sum: '$grantFundedCredits' },
        refundedUsdMicros: { $sum: '$refundedUsdMicros' },
        chaptersWithActivity: { $sum: 1 },
      } },
      { $match: { $or: [{ unlocks: { $ne: 0 } }, { attributedUsdMicros: { $ne: 0 } }, { creditsEarned: { $ne: 0 } }] } },
    ]).allowDiskUse(true),
    RevenueEvent.aggregate([
      { $sort: { occurredAt: -1 } },
      { $group: {
        _id: { day: istDay, novel: '$novel' },
        buyers: { $addToSet: { $cond: [{ $gt: ['$attributedUsdMicros', 0] }, '$user', '$$REMOVE'] } },
        author: { $first: '$author' },
        authorName: { $first: '$authorName' },
      } },
    ]).allowDiskUse(true),
  ]);

  const key = (id) => `${id.day}|${id.novel}`;
  const byKey = new Map(people.map((row) => [key(row._id), row]));
  console.log(`NovelRevenueDaily: ${sums.length} novel-days carry revenue in IST`);
  if (!APPLY) return;

  await NovelRevenueDaily.collection.updateMany({}, { $set: NOVEL_REVENUE_ZERO });
  const ops = sums.map((row) => {
    const who = byKey.get(key(row._id));
    const set = {
      unlocks: row.unlocks,
      uniqueBuyers: who?.buyers.length || 0,
      creditsEarned: row.creditsEarned,
      attributedUsdMicros: row.attributedUsdMicros,
      faceValueUsdMicros: row.faceValueUsdMicros,
      grantFundedCredits: row.grantFundedCredits,
      refundedUsdMicros: row.refundedUsdMicros,
    };
    // Author as captured on the sale. Rows that already had one keep it when
    // the ledger has none for this day.
    if (who?.author) set.author = who.author;
    if (who?.authorName) set.authorName = who.authorName;
    return {
      updateOne: {
        filter: { day: row._id.day, novel: row._id.novel },
        update: {
          $set: set,
          $setOnInsert: {
            ...(who?.author ? {} : { author: null }),
            ...(who?.authorName ? {} : { authorName: '' }),
            readers: 0,
            reads: row.reads,
            gateImpressions: row.gateImpressions,
            chaptersWithActivity: row.chaptersWithActivity,
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    };
  });
  for (let i = 0; i < ops.length; i += BATCH) {
    await NovelRevenueDaily.collection.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
  }
};

const rebuildPlatformDays = async () => {
  const firsts = await Promise.all([
    Order.findOne().sort({ createdAt: 1 }).select('createdAt').lean(),
    CreditTransaction.findOne().sort({ createdAt: 1 }).select('createdAt').lean(),
    RevenueEvent.findOne().sort({ occurredAt: 1 }).select('occurredAt').lean(),
  ]);
  const dates = firsts.filter(Boolean).map((d) => d.createdAt || d.occurredAt);
  if (!dates.length) {
    console.log('RevenueDaily: nothing to rebuild');
    return;
  }
  const start = dayKey(new Date(Math.min(...dates.map((d) => d.getTime()))));
  const today = dayKey();
  const days = [];
  for (let d = start; d <= today; d = shiftDay(d, 1)) days.push(d);
  console.log(`RevenueDaily: ${days.length} days to rebuild (${start} → ${today})`);
  if (!APPLY) return;

  await RevenueDaily.deleteMany({});
  for (const day of days) await rebuildRevenueDay(day);
};

const main = async () => {
  await connectDB(process.env.MONGO_URI);
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — re-keying day buckets to ${REPORTING_TZ}\n`);
  try {
    await rekeyEvents();
    await rebuildChapterRevenue();
    await rebuildNovelRevenue();
    await rebuildPlatformDays();
    console.log(APPLY ? '\nDone.' : '\nDry run only. Re-run with --apply to write.');
  } finally {
    await mongoose.connection.close();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
