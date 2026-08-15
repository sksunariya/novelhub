// Counter seam — the most important interface in the community system.
//
// THE PROBLEM IT EXISTS FOR: a post on the front page takes thousands of $inc
// operations against ONE document. WiredTiger uses document-level concurrency
// control, so concurrent writers to the same document conflict and retry. Past
// a few hundred writes per second on a single document, throughput collapses
// and latency spikes.
//
// This will not happen at 10k DAU. It will happen the first time a post goes
// genuinely viral, and it will happen without warning.
//
// Because every counter update goes through this one function, the fix is a
// change here and nowhere else:
//
//   direct   — one $inc per call. Correct, simplest, current default.
//   batched  — accumulate deltas in memory, flush one $inc per document every
//              spaces.scale.counterFlushMs. Loses at most one flush window on a
//              crash, which for a vote counter is acceptable.
//   bucketed — (not implemented) write to { doc, bucket: random(0..N) } rows
//              and fold them back periodically. For when batching is not enough.
//
// Mode is read from settings at call time, so it can be switched under load and
// switched back — without shipping code during an incident.
//
// COUNTERS ARE A CACHE. The Vote ledger is truth. Any counter can be wrong and
// rebuilt, which is exactly what makes async and batched updates safe.

const mongoose = require('mongoose');
const settingsService = require('./settingsService');

const MODELS = {
  post: 'Post',
  comment: 'PostComment',
  space: 'Space',
  user: 'User',
};

// model -> id -> { field: delta }
const pending = new Map();
let flushTimer = null;
const stats = { direct: 0, batched: 0, flushes: 0, failures: 0 };

const keyOf = (targetType, id) => `${targetType}:${id}`;

const readMode = async () => {
  try {
    const snapshot = await settingsService.snapshot();
    return {
      mode: snapshot.get('spaces.scale.counterMode'),
      flushMs: snapshot.get('spaces.scale.counterFlushMs'),
    };
  } catch (error) {
    // Settings unreadable: fall back to the always-correct path. A counter must
    // never be dropped because configuration was briefly unavailable.
    return { mode: 'direct', flushMs: 1000 };
  }
};

const modelFor = (targetType) => {
  const name = MODELS[targetType];
  if (!name) throw new Error(`Unknown counter target: ${targetType}`);
  return mongoose.model(name);
};

const applyDirect = async (targetType, id, deltas, extra) => {
  const update = { $inc: deltas };
  if (extra && Object.keys(extra).length) update.$set = extra;
  stats.direct += 1;
  return modelFor(targetType).updateOne({ _id: id }, update);
};

/**
 * Write every accumulated delta.
 *
 * Deltas are removed from `pending` BEFORE the write, so a slow flush does not
 * double-count concurrent increments. If the write then fails, the deltas are
 * merged back rather than lost.
 */
const flush = async () => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pending.size) return { flushed: 0 };

  const batch = [...pending.entries()];
  pending.clear();
  stats.flushes += 1;

  const byModel = new Map();
  for (const [key, deltas] of batch) {
    const [targetType, id] = key.split(':');
    if (!byModel.has(targetType)) byModel.set(targetType, []);
    byModel.get(targetType).push({
      updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $inc: deltas } },
    });
  }

  let flushed = 0;
  for (const [targetType, operations] of byModel) {
    try {
      // Unordered: one bad document must not stop the rest of the batch.
      await modelFor(targetType).bulkWrite(operations, { ordered: false });
      flushed += operations.length;
    } catch (error) {
      stats.failures += 1;
      console.error(`[counterService] flush failed for ${targetType}:`, error.message);
      // Merge the deltas back so they are retried on the next flush.
      for (const [key, deltas] of batch) {
        if (!key.startsWith(`${targetType}:`)) continue;
        const existing = pending.get(key) || {};
        for (const [field, delta] of Object.entries(deltas)) {
          existing[field] = (existing[field] || 0) + delta;
        }
        pending.set(key, existing);
      }
    }
  }
  return { flushed };
};

const scheduleFlush = (flushMs) => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flush().catch((error) => console.error('[counterService] scheduled flush:', error.message));
  }, flushMs);
  // Never hold the process open for a counter flush. `shutdown()` drains
  // explicitly on SIGTERM, which is the correct place to guarantee it.
  if (flushTimer.unref) flushTimer.unref();
};

const accumulate = (targetType, id, deltas, flushMs) => {
  const key = keyOf(targetType, id);
  const existing = pending.get(key) || {};
  for (const [field, delta] of Object.entries(deltas)) {
    existing[field] = (existing[field] || 0) + delta;
  }
  pending.set(key, existing);
  stats.batched += 1;
  scheduleFlush(flushMs);
};

/**
 * Increment counters on a document.
 *
 *   counterService.increment('post', postId, { score: 1, upvotes: 1 });
 *   counterService.increment('post', postId, { commentCount: 1 }, { lastActivityAt: new Date() });
 *
 * @param {string} targetType  'post' | 'comment' | 'space' | 'user'
 * @param {ObjectId|string} id
 * @param {object} deltas      field -> signed integer
 * @param {object} [extra]     $set fields. Forces the direct path — a $set
 *                             cannot be accumulated, only overwritten, and
 *                             batching one would silently drop intermediate
 *                             values such as a hotScore recompute.
 */
const increment = async (targetType, id, deltas, extra = null) => {
  if (!deltas || !Object.keys(deltas).length) return null;

  const { mode, flushMs } = await readMode();

  if (mode === 'batched' && !extra) {
    accumulate(targetType, id, deltas, flushMs);
    return { batched: true };
  }

  return applyDirect(targetType, id, deltas, extra);
};

/** Fire-and-forget. For counters where a lost increment is acceptable — views. */
const incrementSilent = (targetType, id, deltas, extra = null) =>
  increment(targetType, id, deltas, extra).catch((error) =>
    console.error(`[counterService] ${targetType}:${id}`, error.message)
  );

/**
 * Drain before exit.
 *
 * server.js already drains the scheduler and the database on SIGTERM; this
 * belongs in the same sequence. Without it, a deploy during batched mode
 * discards up to one flush window of counts.
 */
const shutdown = async () => {
  if (!pending.size) return { flushed: 0 };
  return flush();
};

const getStats = () => ({ ...stats, pending: pending.size });

/** Test seam. */
const reset = () => {
  pending.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  stats.direct = 0;
  stats.batched = 0;
  stats.flushes = 0;
  stats.failures = 0;
};

module.exports = {
  increment,
  incrementSilent,
  flush,
  shutdown,
  getStats,
  reset,
  MODELS,
  _pending: pending,
};
