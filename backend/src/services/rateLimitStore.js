// Rate limit storage seam.
//
// Extracted from middlewares/rateLimit.js so the counter store can be swapped
// without touching the limiter logic or any call site.
//
// Today: an in-process Map. Counters are per-instance, so behind N instances
// the effective limit is N× the configured value. That was an acceptable
// trade-off when the limiter only guarded payment endpoints — it is an abuse
// brake, not a billing control.
//
// It is a weaker fit for community write endpoints, which are public and
// high-volume. Two honest mitigations until Redis arrives (scalability.md
// Stage 4):
//
//   1. Set community limits conservatively, so N× still lands somewhere sane.
//   2. Know the instance count. At one instance the limits are exact.
//
// The Redis implementation is INCR plus EXPIRE against the same interface.

/**
 * The contract any store must satisfy:
 *
 *   incr(key, windowMs) -> { count, resetAt }
 *   reset(key)          -> void
 *   clear()             -> void
 */

const SWEEP_EVERY_MS = 60_000;

const createMemoryStore = () => {
  const buckets = new Map(); // key -> { count, resetAt }
  let lastSweep = Date.now();

  // Amortized rather than scheduled: a setInterval keeps the event loop alive
  // and has to be torn down in tests.
  const sweep = (now) => {
    if (now - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  return {
    name: 'memory',
    // Per-instance counters. Surfaced so the admin portal can say so plainly
    // rather than implying a guarantee that is not there.
    distributed: false,

    // Returns a COPY, never the stored bucket. Handing out a live reference
    // means a caller holding the result sees it mutate under them on the next
    // increment — which is exactly the kind of bug a rate limiter must not
    // have, and which the Redis implementation could not reproduce anyway.
    async incr(key, windowMs) {
      const now = Date.now();
      sweep(now);

      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        const fresh = { count: 1, resetAt: now + windowMs };
        buckets.set(key, fresh);
        return { ...fresh };
      }

      bucket.count += 1;
      return { ...bucket };
    },

    async reset(key) {
      buckets.delete(key);
    },

    async clear() {
      buckets.clear();
    },

    size: () => buckets.size,
    _buckets: buckets,
  };
};

let store = createMemoryStore();

/**
 * Install a different store.
 *
 *   rateLimitStore.setStore(createRedisStore(client));
 *
 * The only thing that changes when Redis arrives.
 */
const setStore = (impl) => {
  if (!impl || typeof impl.incr !== 'function') {
    throw new Error('A rate limit store needs an incr(key, windowMs) function');
  }
  store = impl;
  return store;
};

const getStore = () => store;

const resetToMemory = () => {
  store = createMemoryStore();
  return store;
};

module.exports = {
  createMemoryStore,
  setStore,
  getStore,
  resetToMemory,
  incr: (key, windowMs) => store.incr(key, windowMs),
  reset: (key) => store.reset(key),
  clear: () => store.clear(),
};
