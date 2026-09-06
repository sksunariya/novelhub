// Revenue recognition.
//
// One place writes the per-chapter revenue ledger, so there is one place where
// the rate is frozen, the author is denormalized and the lifetime counters are
// bumped. Before this existed those three things happened in four callers and
// disagreed with each other.
//
// The rule this service enforces: everything that can change later is captured
// AT EVENT TIME. The credits-per-USD rate, the author, the chapter number.
// A report is then a pure sum over immutable rows, and no admin action —
// changing a rate, renaming an author, binning a novel — can restate history.

const mongoose = require('mongoose');
const RevenueEvent = require('../models/RevenueEvent');
const Chapter = require('../models/Chapter');
const Novel = require('../models/Novel');
const settingsService = require('./settingsService');
const { MICROS_PER_CENT, REVENUE_EVENT_KINDS } = require('../config/constants');

const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);

/**
 * Credit face value in micro-USD at the rate in force right now.
 *
 * Face value is a comparison figure, not revenue (see §6 of
 * docs/monetization-architecture.md). It is still worth recording, but only if
 * it is recorded at the moment of the spend — computing it at report time from
 * the live setting is what made every historical face-value figure move
 * whenever an admin touched the rate.
 */
const faceValueMicros = (credits, creditsPerUsd) =>
  creditsPerUsd > 0 ? Math.round((credits / creditsPerUsd) * 100 * MICROS_PER_CENT) : 0;

/**
 * Who this novel's earnings belong to, captured for the event row.
 *
 * `withDeleted` on purpose: a novel in the trash still earned the money it
 * earned, and dropping its author here is what silently moved historical
 * earnings into the "(unattributed)" bucket on the next rebuild.
 */
const resolveAttribution = async (novelId) => {
  const novel = await Novel.findById(novelId)
    .select('author authorRef title')
    .populate({ path: 'authorRef', select: 'name' })
    .setOptions({ withDeleted: true });
  return {
    author: novel?.authorRef?._id || null,
    authorName: novel?.authorRef?.name || novel?.author || '',
  };
};

/**
 * How many times this reader has already bought these chapters.
 *
 * Used as a purchase epoch in unlock idempotency keys. The ledger is the only
 * durable record of that — entitlement rows are deleted when a rental lapses,
 * which is exactly the case the epoch exists to distinguish.
 */
const purchaseCount = async (userId, chapterIds) => {
  const chapter = Array.isArray(chapterIds) ? { $in: chapterIds } : chapterIds;
  return RevenueEvent.countDocuments({
    user: userId,
    chapter,
    kind: { $in: [REVENUE_EVENT_KINDS.UNLOCK, REVENUE_EVENT_KINDS.BULK_UNLOCK] },
  });
};

/**
 * Record one revenue event.
 *
 * Idempotent when given a key: a replayed webhook or a double-submitted unlock
 * writes one row. The duplicate is swallowed rather than thrown because the
 * caller has already succeeded at the thing that mattered.
 */
const record = async ({
  chapter,
  novel,
  chapterNumber = 0,
  user = null,
  kind = REVENUE_EVENT_KINDS.UNLOCK,
  source = '',
  creditsSpent = 0,
  attributedUsdMicros = 0,
  grantFundedCredits = null,
  transaction = null,
  order = null,
  occurredAt = null,
  idempotencyKey = null,
  metadata = {},
  attribution = null,
  creditsPerUsd = null,
}) => {
  const at = occurredAt || new Date();
  const rate = creditsPerUsd ?? (await settingsService.get('credits.perUsd'));
  const who = attribution || (await resolveAttribution(novel));

  const row = {
    chapter,
    novel,
    chapterNumber,
    author: who.author,
    authorName: who.authorName,
    user,
    kind,
    source,
    creditsSpent,
    attributedUsdMicros,
    faceValueUsdMicros: faceValueMicros(creditsSpent, rate),
    creditsPerUsdAtEvent: rate,
    // Credits that bought nothing because no cash sat behind them. Derived
    // here rather than by the caller so the definition cannot drift.
    grantFundedCredits:
      grantFundedCredits === null ? (attributedUsdMicros === 0 ? creditsSpent : 0) : grantFundedCredits,
    transaction,
    order,
    occurredAt: at,
    day: dayKey(at),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    metadata,
  };

  try {
    const event = await RevenueEvent.create(row);
    await bumpLifetime(chapter, novel, attributedUsdMicros);
    return event;
  } catch (error) {
    if (error.code === 11000) return null; // already recorded; nothing to undo
    throw error;
  }
};

/** Write several events for one debit, skipping duplicates. */
const recordMany = async (events) => {
  const written = [];
  for (const event of events) {
    const row = await record(event);
    if (row) written.push(row);
  }
  return written;
};

/**
 * Lifetime counters on the documents themselves.
 *
 * A cache of the ledger, kept because the novel page and the delete guard want
 * one number without an aggregation. Signed, so a reversal decrements.
 */
const bumpLifetime = async (chapter, novel, micros) => {
  if (!micros) return;
  await Promise.all([
    Chapter.updateOne({ _id: chapter }, { $inc: { revenueLifetimeUsdMicros: micros } }),
    Novel.updateOne({ _id: novel }, { $inc: { revenueLifetimeUsdMicros: micros } }),
  ]);
};

/**
 * Reverse recognized revenue for a refunded order.
 *
 * The clawback in orderService already reverses the DEFERRED half by draining
 * what is left of the order's credit tranche. This handles the other half: cash
 * that was already recognized against chapters the reader unlocked. Without it
 * a fully refunded order left its revenue sitting in author earnings forever.
 *
 * Which chapters? Exactly the ones this order's credits paid for. Every spend
 * records which tranches it drew from in `bucketBreakdown`, and the order owns
 * one tranche, so the spends funded by this order are discoverable and the
 * share each one took from that tranche is known precisely.
 *
 * `ratio` handles partial refunds: refunding half an order reverses half of
 * what each of its unlocks recognized.
 */
const reverseOrder = async (order, { ratio = 1, occurredAt = null } = {}) => {
  const CreditBucket = require('../models/CreditBucket');
  const CreditTransaction = require('../models/CreditTransaction');
  const { CREDIT_SOURCES } = require('../config/constants');

  const bucket = await CreditBucket.findOne({ sourceRef: order._id, source: CREDIT_SOURCES.PURCHASE });
  if (!bucket) return { reversed: 0, events: 0 };

  const capped = Math.max(0, Math.min(1, ratio));
  if (capped === 0) return { reversed: 0, events: 0 };

  // Spends that drew on this order's tranche.
  const spends = await CreditTransaction.find({
    'bucketBreakdown.bucket': bucket._id,
    amount: { $lt: 0 },
  }).select('_id bucketBreakdown');

  const fromThisBucket = new Map();
  for (const spend of spends) {
    const entry = (spend.bucketBreakdown || []).find((b) => String(b.bucket) === String(bucket._id));
    if (entry && entry.costMicros > 0) fromThisBucket.set(String(spend._id), entry.costMicros);
  }
  if (!fromThisBucket.size) return { reversed: 0, events: 0 };

  const transactionIds = [...fromThisBucket.keys()].map((id) => new mongoose.Types.ObjectId(id));
  const [positives, priorReversals] = await Promise.all([
    RevenueEvent.find({ transaction: { $in: transactionIds }, attributedUsdMicros: { $gt: 0 } }),
    // What earlier refunds on THIS order already took back, per source event.
    // Without this a second partial refund either double-reverses or — when the
    // idempotency key does not vary — silently reverses nothing at all.
    RevenueEvent.find({ order: order._id, attributedUsdMicros: { $lt: 0 } }).select('metadata attributedUsdMicros'),
  ]);
  if (!positives.length) return { reversed: 0, events: 0 };

  const reversedPerEvent = new Map();
  for (const row of priorReversals) {
    const source = row.metadata && row.metadata.reversalOf;
    if (!source) continue;
    const key = String(source);
    reversedPerEvent.set(key, (reversedPerEvent.get(key) || 0) + Math.abs(row.attributedUsdMicros));
  }

  const at = occurredAt || new Date();
  // Distinguishes one refund round from the next, so escalating a $5 refund to
  // the full $10 posts the difference instead of colliding with round one.
  const round = order.refundedUsdCents || 0;

  let reversed = 0;
  let count = 0;

  // Group by transaction: a bulk unlock produced several events from one debit,
  // and it is the debit that knows how much of it this order actually funded.
  const byTransaction = new Map();
  for (const event of positives) {
    const key = String(event.transaction);
    if (!byTransaction.has(key)) byTransaction.set(key, []);
    byTransaction.get(key).push(event);
  }

  for (const [transactionId, rows] of byTransaction) {
    const bucketMicros = fromThisBucket.get(transactionId) || 0;
    const recognized = rows.reduce((sum, row) => sum + row.attributedUsdMicros, 0);
    if (!recognized) continue;

    // Never reverse more than this order funded, even when the spend drew on
    // several tranches, and never more than the refund's share of it.
    const target = Math.round(Math.min(recognized, bucketMicros) * capped);
    const alreadyDone = rows.reduce((sum, row) => sum + (reversedPerEvent.get(String(row._id)) || 0), 0);
    const outstanding = target - alreadyDone;
    if (outstanding <= 0) continue;

    let allocated = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const isLast = index === rows.length - 1;
      const wanted = isLast
        ? outstanding - allocated
        : Math.floor((outstanding * row.attributedUsdMicros) / recognized);
      // An individual event can never go below zero, however the rounding fell.
      const headroom = row.attributedUsdMicros - (reversedPerEvent.get(String(row._id)) || 0);
      const share = Math.max(0, Math.min(wanted, headroom));
      allocated += wanted;
      if (share <= 0) continue;

      const written = await record({
        chapter: row.chapter,
        novel: row.novel,
        chapterNumber: row.chapterNumber,
        user: row.user,
        kind: REVENUE_EVENT_KINDS.REFUND,
        source: row.source,
        // Credits come back in the same proportion as the cash, so face value
        // reverses by exactly what it added.
        creditsSpent: -Math.round((row.creditsSpent * share) / row.attributedUsdMicros),
        attributedUsdMicros: -share,
        grantFundedCredits: 0,
        transaction: row.transaction,
        order: order._id,
        occurredAt: at,
        idempotencyKey: `refund:${order._id}:${row._id}:${round}`,
        attribution: { author: row.author, authorName: row.authorName },
        creditsPerUsd: row.creditsPerUsdAtEvent,
        metadata: { reversalOf: row._id, ratio: capped, refundedUsdCents: round },
      });
      if (written) {
        reversed += share;
        count += 1;
      }
    }
  }

  return { reversed, events: count };
};

module.exports = {
  record,
  purchaseCount,
  recordMany,
  reverseOrder,
  resolveAttribution,
  faceValueMicros,
  dayKey,
};
