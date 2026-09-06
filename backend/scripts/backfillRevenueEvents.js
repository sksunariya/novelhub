/**
 * Backfill the RevenueEvent ledger from historical records.
 *
 *   node scripts/backfillRevenueEvents.js              # dry run — reports, writes nothing
 *   node scripts/backfillRevenueEvents.js --apply      # write
 *   node scripts/backfillRevenueEvents.js --verify     # re-run the checks only
 *   node scripts/backfillRevenueEvents.js --apply --no-rollups   # skip the rollup rebuild
 *
 * WHY THIS EXISTS
 *
 * Revenue used to be derived from ChapterAccess at report time. It is now read
 * from RevenueEvent, an append-only ledger written at the moment of each sale.
 * That collection starts empty, so until it is seeded every revenue figure
 * reads zero. This reconstructs it.
 *
 * WHAT IT CAN AND CANNOT RECOVER
 *
 * ChapterAccess carries the per-chapter split (including a bulk unlock's
 * pro-rata allocation), so it is the primary source. But it is an entitlement
 * record: lapsed rentals and chapters removed under the refund policy were
 * hard-deleted from it. Those are recovered from CreditTransaction, which is
 * append-only and still holds the spend.
 *
 * Two things are genuinely lost and are reported rather than guessed:
 *   - a bulk unlock whose ChapterAccess rows are ALL gone cannot be split back
 *     across its chapters; the debit is known, the per-chapter share is not.
 *   - a novel reassigned to a different author since the sale is attributed to
 *     its CURRENT author. Only events written from now on capture the author as
 *     of the sale.
 *
 * Safe to re-run. Every row carries the same idempotency key the live code
 * would have written, so a second pass inserts nothing and the counters are
 * recomputed from the ledger rather than incremented.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

const ChapterAccess = require('../src/models/ChapterAccess');
const CreditTransaction = require('../src/models/CreditTransaction');
const RevenueEvent = require('../src/models/RevenueEvent');
const AdminAuditLog = require('../src/models/AdminAuditLog');
const ChapterRead = require('../src/models/ChapterRead');
const GateImpression = require('../src/models/GateImpression');
const Novel = require('../src/models/Novel');
const Author = require('../src/models/Author');
const User = require('../src/models/User');
const Chapter = require('../src/models/Chapter');
const Order = require('../src/models/Order');
const CreditBucket = require('../src/models/CreditBucket');

const settingsService = require('../src/services/settingsService');
const revenueService = require('../src/services/revenueService');
const rollupService = require('../src/services/rollupService');
const {
  MICROS_PER_CENT,
  REVENUE_EVENT_KINDS,
  ACCESS_SOURCES,
  CREDIT_TRANSACTION_TYPES,
} = require('../src/config/constants');

const APPLY = process.argv.includes('--apply');
const VERIFY_ONLY = process.argv.includes('--verify');
const SKIP_ROLLUPS = process.argv.includes('--no-rollups');
const BATCH = 1000;

const usd = (micros) => `$${(micros / 1000000).toFixed(4)}`;
const n = (value) => Number(value || 0).toLocaleString();
const dayOf = (date) => new Date(date).toISOString().slice(0, 10);

const heading = (text) => console.log(`\n${text}\n${'-'.repeat(text.length)}`);
const warn = (text) => console.log(`  ! ${text}`);

// ---------------------------------------------------------------- rate history

/**
 * When credits-per-USD changed, and to what.
 *
 * Face value has to be priced at the rate in force when the sale happened, or
 * the backfill bakes in today's rate and reproduces the very bug the ledger
 * exists to prevent. The settings audit log records before/after for every
 * change, which is enough to rebuild the timeline exactly.
 */
const buildRateTimeline = async (currentRate) => {
  const logs = await AdminAuditLog.find({ 'changes.key': 'credits.perUsd' })
    .sort({ createdAt: 1 })
    .lean();

  const points = [];
  for (const log of logs) {
    const change = (log.changes || []).find((entry) => entry.key === 'credits.perUsd');
    if (!change) continue;
    const after = Number(change.after);
    if (!Number.isFinite(after) || after <= 0) continue;
    points.push({ at: new Date(log.createdAt), before: Number(change.before), after });
  }

  // Before the first recorded change, the rate was that change's "before".
  const initial =
    points.length && Number.isFinite(points[0].before) && points[0].before > 0
      ? points[0].before
      : currentRate;

  return { initial, points, currentRate };
};

const rateAt = (timeline, date) => {
  let rate = timeline.initial;
  for (const point of timeline.points) {
    if (point.at <= date) rate = point.after;
    else break;
  }
  return rate;
};

// ------------------------------------------------------------ spend metadata

/**
 * Credits in a spend that carried no cash, per transaction.
 *
 * Taken from the tranches the debit actually drew on, not inferred from a zero
 * total — a spend that touched both a purchased and a granted tranche has cash
 * behind it and is still part-funded by a giveaway.
 */
const loadSpendMeta = async (transactionIds) => {
  const meta = new Map();
  for (let i = 0; i < transactionIds.length; i += BATCH) {
    const rows = await CreditTransaction.find({ _id: { $in: transactionIds.slice(i, i + BATCH) } })
      .select('_id amount bucketBreakdown createdAt')
      .lean();
    for (const row of rows) {
      meta.set(String(row._id), {
        credits: Math.abs(row.amount || 0),
        grantFunded: (row.bucketBreakdown || []).reduce(
          (sum, entry) => sum + (entry.costMicros === 0 ? entry.credits || 0 : 0),
          0
        ),
        createdAt: row.createdAt,
      });
    }
  }
  return meta;
};

const KIND_BY_SOURCE = {
  [ACCESS_SOURCES.CREDITS]: REVENUE_EVENT_KINDS.UNLOCK,
  [ACCESS_SOURCES.BULK]: REVENUE_EVENT_KINDS.BULK_UNLOCK,
  [ACCESS_SOURCES.SUBSCRIPTION]: REVENUE_EVENT_KINDS.SUBSCRIPTION,
};

/**
 * The key the live code would have written for this unlock.
 *
 * Matching it exactly is what makes the backfill idempotent AND keeps it from
 * colliding with events written after the deploy.
 */
const keyForAccess = (row) => {
  if (row.source === ACCESS_SOURCES.SUBSCRIPTION) return `sub-unlock:${row._id}`;
  if (!row.transaction) return `backfill-access:${row._id}`;
  const prefix = row.source === ACCESS_SOURCES.BULK ? 'bulk-unlock' : 'unlock';
  return `${prefix}:${row.transaction}:${row.chapter}`;
};

// ------------------------------------------------------------------ the work

const run = async () => {
  await connectDB(process.env.MONGO_URI);
  console.log(`Connected. Mode: ${VERIFY_ONLY ? 'VERIFY ONLY' : APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);

  const currentRate = await settingsService.get('credits.perUsd');
  const timeline = await buildRateTimeline(currentRate);

  heading('Pre-flight');
  const [accessCount, spendCount, eventCount, novelCount] = await Promise.all([
    ChapterAccess.countDocuments({}),
    CreditTransaction.countDocuments({ type: CREDIT_TRANSACTION_TYPES.SPEND }),
    RevenueEvent.countDocuments({}),
    Novel.countDocuments({}).setOptions({ withDeleted: true }),
  ]);
  console.log(`  ChapterAccess rows      ${n(accessCount)}`);
  console.log(`  Spend transactions      ${n(spendCount)}`);
  console.log(`  RevenueEvent rows       ${n(eventCount)}`);
  console.log(`  Novels (incl. deleted)  ${n(novelCount)}`);
  console.log(
    `  credits.perUsd          ${currentRate} now, ${timeline.points.length} recorded change(s)` +
      (timeline.points.length ? `, ${timeline.initial} at the start of history` : '')
  );
  if (!timeline.points.length && accessCount) {
    warn('No recorded rate changes — face value is priced at the current rate throughout.');
  }
  if (!accessCount && !spendCount) {
    console.log('\nNothing to backfill: there are no unlocks in this database.');
    await mongoose.connection.close();
    return;
  }

  // Idempotency here is the unique index, not the keys on their own. Without it
  // a second run inserts every event again and silently doubles the revenue.
  if (APPLY) {
    const indexes = await RevenueEvent.collection.indexes().catch(() => []);
    const guard = indexes.find(
      (index) => index.unique && index.key && index.key.idempotencyKey === 1
    );
    if (!guard) {
      console.error(
        '\nREFUSING TO RUN: the unique index on RevenueEvent.idempotencyKey does not exist yet.\n' +
          'Without it this script is not safe to re-run — a second pass would double every figure.\n' +
          'Start the app once (or run `npm run sync-indexes`) to build indexes, then try again.'
      );
      await mongoose.connection.close();
      process.exitCode = 1;
      return;
    }
  }

  if (VERIFY_ONLY) {
    await verify(timeline);
    await mongoose.connection.close();
    return;
  }

  // --- 1. attribution per novel, resolved once ----------------------------
  const novels = await Novel.find({})
    .select('_id author authorRef title')
    .populate({ path: 'authorRef', select: 'name' })
    .setOptions({ withDeleted: true })
    .lean();
  const attribution = new Map(
    novels.map((novel) => [
      String(novel._id),
      { author: novel.authorRef?._id || null, authorName: novel.authorRef?.name || novel.author || '' },
    ])
  );
  const attributionFor = (novelId) =>
    attribution.get(String(novelId)) || { author: null, authorName: '' };

  // --- 2. seed from ChapterAccess -----------------------------------------
  heading('1. Unlocks from ChapterAccess');
  const accessRows = await ChapterAccess.find({})
    .select('_id user chapter novel source creditsSpent attributedUsdMicros transaction unlockedAt createdAt')
    .lean();

  const chapterNumbers = new Map();
  const chapterIds = [...new Set(accessRows.map((row) => String(row.chapter)))];
  for (let i = 0; i < chapterIds.length; i += BATCH) {
    const chunk = await Chapter.find({ _id: { $in: chapterIds.slice(i, i + BATCH) } })
      .select('_id number')
      .setOptions({ withDeleted: true })
      .lean();
    chunk.forEach((chapter) => chapterNumbers.set(String(chapter._id), chapter.number || 0));
  }

  const spendMeta = await loadSpendMeta(
    [...new Set(accessRows.filter((row) => row.transaction).map((row) => String(row.transaction)))]
  );

  // A bulk debit covers several chapters; its grant-funded credits are shared
  // out in the same proportion as the credits themselves.
  const byTransaction = new Map();
  for (const row of accessRows) {
    if (!row.transaction) continue;
    const key = String(row.transaction);
    if (!byTransaction.has(key)) byTransaction.set(key, []);
    byTransaction.get(key).push(row);
  }
  const grantFundedByAccess = new Map();
  for (const [transactionId, rows] of byTransaction) {
    const meta = spendMeta.get(transactionId);
    if (!meta || !meta.grantFunded) continue;
    const totalCredits = rows.reduce((sum, row) => sum + (row.creditsSpent || 0), 0) || 1;
    let allocated = 0;
    rows.forEach((row, index) => {
      const isLast = index === rows.length - 1;
      const share = isLast
        ? meta.grantFunded - allocated
        : Math.floor((meta.grantFunded * (row.creditsSpent || 0)) / totalCredits);
      allocated += share;
      if (share > 0) grantFundedByAccess.set(String(row._id), share);
    });
  }

  const planned = [];
  let unknownNovel = 0;
  for (const row of accessRows) {
    const at = new Date(row.unlockedAt || row.createdAt || Date.now());
    const rate = rateAt(timeline, at);
    const credits = row.creditsSpent || 0;
    const who = attributionFor(row.novel);
    if (!attribution.has(String(row.novel))) unknownNovel += 1;

    planned.push({
      chapter: row.chapter,
      novel: row.novel,
      chapterNumber: chapterNumbers.get(String(row.chapter)) || 0,
      author: who.author,
      authorName: who.authorName,
      user: row.user,
      kind: KIND_BY_SOURCE[row.source] || REVENUE_EVENT_KINDS.ADJUSTMENT,
      source: row.source || '',
      creditsSpent: credits,
      attributedUsdMicros: row.attributedUsdMicros || 0,
      faceValueUsdMicros: revenueService.faceValueMicros(credits, rate),
      creditsPerUsdAtEvent: rate,
      grantFundedCredits:
        grantFundedByAccess.get(String(row._id)) || (row.attributedUsdMicros ? 0 : credits),
      transaction: row.transaction || null,
      order: null,
      occurredAt: at,
      day: dayOf(at),
      idempotencyKey: keyForAccess(row),
      metadata: { backfilledFrom: 'ChapterAccess', accessId: row._id },
    });
  }

  const accessMicros = planned.reduce((sum, row) => sum + row.attributedUsdMicros, 0);
  console.log(`  ${n(planned.length)} unlocks, ${usd(accessMicros)} attributed`);
  if (unknownNovel) warn(`${n(unknownNovel)} rows reference a novel that no longer exists at all`);

  // --- 3. recover unlocks whose entitlement row is gone --------------------
  heading('2. Unlocks recoverable only from the credit ledger');
  // Keyed on the DEBIT, not on (user, chapter). A rental that lapsed and was
  // bought again has a surviving row for the second purchase only; skipping by
  // the pair would drop the first sale on the floor.
  const plannedTransactions = new Set(
    planned.filter((row) => row.transaction).map((row) => String(row.transaction))
  );
  const orphanSpends = await CreditTransaction.find({
    type: CREDIT_TRANSACTION_TYPES.SPEND,
    chapter: { $ne: null },
  })
    .select('_id user novel chapter amount attributedUsdMicros bucketBreakdown createdAt')
    .lean();

  let recovered = 0;
  let recoveredMicros = 0;
  for (const spend of orphanSpends) {
    if (plannedTransactions.has(String(spend._id))) continue; // already covered above
    const at = new Date(spend.createdAt);
    const rate = rateAt(timeline, at);
    const credits = Math.abs(spend.amount || 0);
    const who = attributionFor(spend.novel);
    const grantFunded = (spend.bucketBreakdown || []).reduce(
      (sum, entry) => sum + (entry.costMicros === 0 ? entry.credits || 0 : 0),
      0
    );

    planned.push({
      chapter: spend.chapter,
      novel: spend.novel,
      chapterNumber: chapterNumbers.get(String(spend.chapter)) || 0,
      author: who.author,
      authorName: who.authorName,
      user: spend.user,
      kind: REVENUE_EVENT_KINDS.UNLOCK,
      source: ACCESS_SOURCES.CREDITS,
      creditsSpent: credits,
      attributedUsdMicros: spend.attributedUsdMicros || 0,
      faceValueUsdMicros: revenueService.faceValueMicros(credits, rate),
      creditsPerUsdAtEvent: rate,
      grantFundedCredits: grantFunded,
      transaction: spend._id,
      order: null,
      occurredAt: at,
      day: dayOf(at),
      // The key the live single-unlock path uses, so this never double-writes.
      idempotencyKey: `unlock:${spend._id}:${spend.chapter}`,
      metadata: { backfilledFrom: 'CreditTransaction', reason: 'entitlement row no longer exists' },
    });
    recovered += 1;
    recoveredMicros += spend.attributedUsdMicros || 0;
  }
  console.log(`  ${n(recovered)} recovered (lapsed rentals / removed chapters), ${usd(recoveredMicros)}`);

  // Bulk debits with no surviving rows cannot be split back across chapters.
  const bulkSpends = await CreditTransaction.find({
    type: CREDIT_TRANSACTION_TYPES.SPEND,
    chapter: null,
    novel: { $ne: null },
  })
    .select('_id novel attributedUsdMicros')
    .lean();
  const coveredTransactions = new Set(planned.filter((row) => row.transaction).map((row) => String(row.transaction)));
  const lostBulk = bulkSpends.filter((spend) => !coveredTransactions.has(String(spend._id)));
  if (lostBulk.length) {
    const lostMicros = lostBulk.reduce((sum, spend) => sum + (spend.attributedUsdMicros || 0), 0);
    warn(
      `${n(lostBulk.length)} bulk unlock(s) worth ${usd(lostMicros)} have no surviving entitlement rows — ` +
        'the debit is known but its per-chapter split is not, so they are left out rather than guessed.'
    );
  }

  // --- 4. write ------------------------------------------------------------
  heading('3. Write');
  const totalMicros = planned.reduce((sum, row) => sum + row.attributedUsdMicros, 0);
  const totalFace = planned.reduce((sum, row) => sum + row.faceValueUsdMicros, 0);
  console.log(`  ${n(planned.length)} events, ${usd(totalMicros)} attributed, ${usd(totalFace)} face value`);

  if (!APPLY) {
    console.log('\n  DRY RUN — nothing written. Re-run with --apply to commit.');
    await previewRefunds();
    await mongoose.connection.close();
    return;
  }

  let inserted = 0;
  let duplicates = 0;
  for (let i = 0; i < planned.length; i += BATCH) {
    const chunk = planned.slice(i, i + BATCH);
    try {
      const result = await RevenueEvent.insertMany(chunk, { ordered: false });
      inserted += result.length;
    } catch (error) {
      // ordered:false keeps going; duplicates are the point of the keys.
      if (!error.writeErrors && error.code !== 11000) throw error;
      const failures = error.writeErrors || [];
      const dupes = failures.filter((entry) => (entry.err || entry).code === 11000).length;
      if (dupes !== failures.length) throw error;
      duplicates += dupes;
      inserted += error.insertedDocs ? error.insertedDocs.length : chunk.length - failures.length;
    }
    process.stdout.write(`\r  inserted ${n(inserted)} / ${n(planned.length)}`);
  }
  console.log(`\n  ${n(inserted)} inserted, ${n(duplicates)} already present`);

  // --- 5. reverse refunds that were never un-booked ------------------------
  heading('4. Refunds');
  await applyRefunds();

  // --- 6. recompute the lifetime counters from the ledger ------------------
  heading('5. Lifetime counters');
  await recomputeLifetime();

  // --- 7. rebuild the rollups ---------------------------------------------
  if (SKIP_ROLLUPS) {
    console.log('\n  Skipping rollup rebuild (--no-rollups). Run it before trusting the dashboard.');
  } else {
    heading('6. Daily rollups');
    await rebuildRollups();
  }

  await verify(timeline);
  await mongoose.connection.close();
};

// ---------------------------------------------------------------- refunds

const refundedOrders = () =>
  Order.find({ refundedUsdCents: { $gt: 0 }, creditedAt: { $ne: null } })
    .select('_id orderNumber netUsdCents refundedUsdCents')
    .lean();

const previewRefunds = async () => {
  const orders = await refundedOrders();
  const removals = await CreditTransaction.countDocuments({
    type: CREDIT_TRANSACTION_TYPES.REFUND,
    idempotencyKey: { $regex: '^content-removed:' },
  });
  if (orders.length || removals) {
    heading('Refunds that would be reversed');
    if (orders.length) {
      const refunded = orders.reduce((sum, order) => sum + order.refundedUsdCents, 0);
      console.log(`  ${n(orders.length)} refunded order(s), $${(refunded / 100).toFixed(2)} returned to readers`);
      console.log('    Historic clawbacks reversed the unspent half only; the recognized half stayed');
      console.log('    in author earnings. --apply posts the offsetting negative events.');
    }
    if (removals) {
      console.log(`  ${n(removals)} chapter-removal refund(s) to un-book`);
    }
  }
};

const applyRefunds = async () => {
  // (a) Chapters removed under the refund policy. The reader got their credits
  // back but the chapter kept the money, because nothing wrote a negative row.
  const removals = await CreditTransaction.find({
    type: CREDIT_TRANSACTION_TYPES.REFUND,
    idempotencyKey: { $regex: '^content-removed:' },
  })
    .select('_id user refId createdAt')
    .lean();

  let removalEvents = 0;
  let removalMicros = 0;
  for (const refund of removals) {
    const positives = await RevenueEvent.find({
      user: refund.user,
      chapter: refund.refId,
      attributedUsdMicros: { $gt: 0 },
      // Only what had been earned by the time of the refund.
      occurredAt: { $lte: new Date(refund.createdAt) },
    }).lean();
    for (const row of positives) {
      const written = await revenueService.record({
        chapter: row.chapter,
        novel: row.novel,
        chapterNumber: row.chapterNumber,
        user: row.user,
        kind: REVENUE_EVENT_KINDS.REFUND,
        source: row.source,
        creditsSpent: -row.creditsSpent,
        attributedUsdMicros: -row.attributedUsdMicros,
        grantFundedCredits: 0,
        transaction: row.transaction,
        occurredAt: new Date(refund.createdAt),
        idempotencyKey: `content-removed-backfill:${refund._id}:${row._id}`,
        attribution: { author: row.author, authorName: row.authorName },
        creditsPerUsd: row.creditsPerUsdAtEvent,
        metadata: { reason: 'content removed', backfilled: true },
      });
      if (written) {
        removalEvents += 1;
        removalMicros += row.attributedUsdMicros;
      }
    }
  }
  console.log(`  Chapter removals: ${n(removalEvents)} event(s), ${usd(removalMicros)} un-booked`);

  // (b) Refunded orders. reverseOrder walks the tranche each spend drew on, so
  // it reverses exactly what THIS order funded and nothing else.
  const orders = await refundedOrders();
  let orderEvents = 0;
  let orderMicros = 0;
  for (const lean of orders) {
    const order = await Order.findById(lean._id);
    const ratio = order.netUsdCents > 0 ? order.refundedUsdCents / order.netUsdCents : 1;
    const result = await revenueService.reverseOrder(order, { ratio });
    orderEvents += result.events;
    orderMicros += result.reversed;
  }
  console.log(`  Refunded orders : ${n(orders.length)} order(s), ${n(orderEvents)} event(s), ${usd(orderMicros)} reversed`);
};

// ------------------------------------------------------------ counters

/**
 * Recompute rather than increment.
 *
 * The counters already hold values the old code incremented, and the backfill
 * would add to them. Setting them from the ledger makes the script idempotent
 * and repairs any pre-existing drift at the same time.
 */
const recomputeLifetime = async () => {
  for (const [model, field, label] of [
    [Chapter, 'chapter', 'chapters'],
    [Novel, 'novel', 'novels'],
  ]) {
    const totals = await RevenueEvent.aggregate([
      { $group: { _id: `$${field}`, micros: { $sum: '$attributedUsdMicros' } } },
    ]);
    const writes = totals.map((row) => ({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { revenueLifetimeUsdMicros: row.micros } },
      },
    }));
    // Anything with no events must read zero, not whatever it held before.
    writes.push({
      updateMany: {
        filter: { _id: { $nin: totals.map((row) => row._id) } },
        update: { $set: { revenueLifetimeUsdMicros: 0 } },
      },
    });
    for (let i = 0; i < writes.length; i += BATCH) {
      await model.bulkWrite(writes.slice(i, i + BATCH), { ordered: false });
    }
    console.log(`  ${label}: ${n(totals.length)} with revenue, the rest zeroed`);
  }
};

// ------------------------------------------------------------- rollups

const rebuildRollups = async () => {
  // Only days that actually have something to roll up.
  const [eventDays, readDays, gateDays] = await Promise.all([
    RevenueEvent.distinct('day'),
    ChapterRead.aggregate([
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$lastReadAt' } } } },
    ]),
    GateImpression.aggregate([{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$at' } } } }]),
  ]);

  const days = [
    ...new Set([
      ...eventDays,
      ...readDays.map((row) => row._id),
      ...gateDays.map((row) => row._id),
    ]),
  ]
    .filter(Boolean)
    .sort();

  console.log(`  ${n(days.length)} day(s) with activity`);
  let done = 0;
  for (const day of days) {
    await rollupService.rebuildDay(day);
    done += 1;
    process.stdout.write(`\r  rebuilt ${n(done)} / ${n(days.length)} (${day})`);
  }
  console.log('');
};

// -------------------------------------------------------------- verification

const verify = async (timeline) => {
  heading('Verification');

  const [ledger] = await RevenueEvent.aggregate([
    {
      $group: {
        _id: null,
        gross: { $sum: { $cond: [{ $gt: ['$attributedUsdMicros', 0] }, '$attributedUsdMicros', 0] } },
        reversed: { $sum: { $cond: [{ $lt: ['$attributedUsdMicros', 0] }, '$attributedUsdMicros', 0] } },
        net: { $sum: '$attributedUsdMicros' },
        face: { $sum: '$faceValueUsdMicros' },
        events: { $sum: 1 },
      },
    },
  ]);
  const recognized = ledger ? ledger.net : 0;

  console.log(`  Events              ${n(ledger ? ledger.events : 0)}`);
  console.log(`  Gross recognized    ${usd(ledger ? ledger.gross : 0)}`);
  console.log(`  Reversed by refunds ${usd(Math.abs(ledger ? ledger.reversed : 0))}`);
  console.log(`  NET RECOGNIZED      ${usd(recognized)}`);
  console.log(`  Credit face value   ${usd(ledger ? ledger.face : 0)}  (comparison only, not revenue)`);

  // The §6.4 identity: every cent taken is recognized, still deferred,
  // refunded, or forfeited. A gap means money is unaccounted for.
  const [orders] = await Order.aggregate([
    { $match: { creditedAt: { $ne: null } } },
    {
      $group: {
        _id: null,
        net: { $sum: '$netUsdCents' },
        refunded: { $sum: '$refundedUsdCents' },
      },
    },
  ]);
  const [deferred] = await CreditBucket.aggregate([
    { $match: { remaining: { $gt: 0 } } },
    { $group: { _id: null, micros: { $sum: '$remainingCostMicros' } } },
  ]);
  const [forfeited] = await CreditTransaction.aggregate([
    { $match: { type: CREDIT_TRANSACTION_TYPES.EXPIRE } },
    { $group: { _id: null, micros: { $sum: { $sum: '$bucketBreakdown.costMicros' } } } },
  ]);

  const takenMicros = (orders ? orders.net : 0) * MICROS_PER_CENT;
  const refundedMicros = (orders ? orders.refunded : 0) * MICROS_PER_CENT;
  const deferredMicros = deferred ? deferred.micros : 0;
  const forfeitedMicros = forfeited ? forfeited.micros : 0;
  const accounted = recognized + deferredMicros + refundedMicros + forfeitedMicros;
  const gap = takenMicros - accounted;

  console.log('\n  Accounting identity (docs/monetization-architecture.md §6.4)');
  console.log(`    Cash received     ${usd(takenMicros)}`);
  console.log(`    = recognized      ${usd(recognized)}`);
  console.log(`    + deferred        ${usd(deferredMicros)}`);
  console.log(`    + refunded        ${usd(refundedMicros)}`);
  console.log(`    + forfeited       ${usd(forfeitedMicros)}`);
  console.log(`    difference        ${usd(gap)}`);

  const tolerance = Math.max(MICROS_PER_CENT, Math.abs(takenMicros) * 0.0001);
  if (Math.abs(gap) <= tolerance) {
    console.log('    OK — balances within rounding.');
  } else if (gap > 0) {
    warn(`${usd(gap)} received but not accounted for. Usually the bulk unlocks reported above,`);
    warn('or subscription cycles that were never attributed. Investigate before trusting totals.');
  } else {
    warn(`${usd(-gap)} MORE accounted for than received — this should not happen. Do not`);
    warn('trust these figures; check for double-counted events before going further.');
  }

  // The rollups must agree with the ledger they are built from.
  const ChapterStatsDaily = require('../src/models/ChapterStatsDaily');
  const NovelRevenueDaily = require('../src/models/NovelRevenueDaily');
  const [chapterRoll] = await ChapterStatsDaily.aggregate([
    { $group: { _id: null, micros: { $sum: '$attributedUsdMicros' } } },
  ]);
  const [novelRoll] = await NovelRevenueDaily.aggregate([
    { $group: { _id: null, micros: { $sum: '$attributedUsdMicros' } } },
  ]);
  console.log('\n  Rollups vs ledger');
  console.log(`    ChapterStatsDaily ${usd(chapterRoll ? chapterRoll.micros : 0)}`);
  console.log(`    NovelRevenueDaily ${usd(novelRoll ? novelRoll.micros : 0)}`);
  const rollGap = (chapterRoll ? chapterRoll.micros : 0) - recognized;
  if (Math.abs(rollGap) > MICROS_PER_CENT) {
    warn(`Chapter rollups differ from the ledger by ${usd(rollGap)} — rerun with rollups enabled.`);
  } else {
    console.log('    OK — rollups match the ledger.');
  }

  // Lifetime counters are a cache of the same ledger.
  const [counterTotal] = await Chapter.aggregate([
    { $group: { _id: null, micros: { $sum: '$revenueLifetimeUsdMicros' } } },
  ]).option({ withDeleted: true });
  const counterGap = (counterTotal ? counterTotal.micros : 0) - recognized;
  console.log(`\n  Chapter lifetime counters ${usd(counterTotal ? counterTotal.micros : 0)}`);
  if (Math.abs(counterGap) > MICROS_PER_CENT) {
    warn(`Off the ledger by ${usd(counterGap)} — rerun with --apply to recompute them.`);
  } else {
    console.log('    OK — counters match the ledger.');
  }

  if (timeline && timeline.points.length) {
    console.log(`\n  Face value priced across ${timeline.points.length + 1} rate period(s).`);
  }

  console.log(
    APPLY
      ? '\nDone. Open Admin -> Analytics -> Revenue and pick "All time" to confirm.'
      : '\nDry run complete.'
  );
};

run().catch(async (error) => {
  console.error('\nFAILED:', error);
  if (mongoose.connection.readyState === 1) await mongoose.connection.close();
  process.exit(1);
});
