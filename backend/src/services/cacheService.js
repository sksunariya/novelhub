// Cache seam.
//
// Today: an in-process Map with a TTL and a hard entry cap. Correct for a
// single instance, which is where this app is.
//
// Later: the same interface backed by Redis, when scalability.md Stage 4
// triggers. Call sites do not change — that is the entire point of this file
// existing before there is anything to cache.
//
// TWO RULES that make the eventual swap safe, and that matter today too:
//
//   1. Cached values must tolerate being stale on one instance and fresh on
//      another. Per-instance caches diverge; if divergence would be a bug, the
//      value does not belong here.
//   2. NEVER cache authorization decisions beyond the current request. A ban
//      that takes 60 seconds to apply is a ban that does not work. Use
//      `requestScope()` for per-request memoization instead.

const DEFAULT_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 5000);
const SWEEP_EVERY_MS = 60_000;

const store = new Map(); // key -> { value, expiresAt }
let lastSweep = Date.now();
const stats = { hits: 0, misses: 0, evictions: 0, expired: 0 };

/**
 * Drop expired entries.
 *
 * Amortized rather than scheduled: a setInterval would keep the event loop
 * alive and has to be torn down in tests. This runs at most once a minute, on
 * whatever request happens to arrive.
 */
const sweep = (now) => {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
      stats.expired += 1;
    }
  }
};

/**
 * Evict the oldest entry when full.
 *
 * Map preserves insertion order, so the first key is the oldest — FIFO, not
 * LRU. FIFO is worse at hit rate and much cheaper to maintain, and the cap
 * exists to bound memory rather than to maximise hits. An uncapped cache is a
 * memory leak that presents as a weekly restart.
 */
const evictIfFull = (max) => {
  while (store.size >= max) {
    const oldest = store.keys().next();
    if (oldest.done) return;
    store.delete(oldest.value);
    stats.evictions += 1;
  }
};

const get = (key) => {
  const entry = store.get(key);
  if (!entry) {
    stats.misses += 1;
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    stats.misses += 1;
    stats.expired += 1;
    return undefined;
  }
  stats.hits += 1;
  return entry.value;
};

const set = (key, value, ttlSeconds, { maxEntries = DEFAULT_MAX_ENTRIES } = {}) => {
  if (!ttlSeconds || ttlSeconds <= 0) return value; // ttl 0 disables caching
  const now = Date.now();
  sweep(now);
  // Re-setting an existing key must not count against the cap.
  if (!store.has(key)) evictIfFull(maxEntries);
  store.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
  return value;
};

const has = (key) => get(key) !== undefined;

const del = (key) => store.delete(key);

/**
 * Invalidate one key or every key under a prefix.
 *
 * Prefix invalidation is O(n) over the cache. That is fine at this size and is
 * one of the things Redis does better later — hence the namespaced key
 * convention below, which makes the Redis version a SCAN.
 */
const invalidate = (keyOrPrefix) => {
  if (store.delete(keyOrPrefix)) return 1;
  let removed = 0;
  for (const key of store.keys()) {
    if (key.startsWith(keyOrPrefix)) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
};

/**
 * Cache-aside. The call almost everything should use.
 *
 *   const feed = await cacheService.wrap(`feed:popular:${cursor}`, 30, () => buildFeed());
 *
 * Concurrent callers for a cold key each run `producer` — no request
 * coalescing. Adding it would need a promise map, and at this scale a brief
 * duplicate query is cheaper than the machinery. Revisit alongside Redis.
 *
 * A producer that throws does NOT populate the cache and does not swallow the
 * error. Caching a failure is how a transient blip becomes a sticky outage.
 */
const wrap = async (key, ttlSeconds, producer, options) => {
  const cached = get(key);
  if (cached !== undefined) return cached;
  const value = await producer();
  if (value !== undefined) set(key, value, ttlSeconds, options);
  return value;
};

/**
 * Per-request memoization, stored on the request object rather than here.
 *
 * This is what permission and settings lookups should use. It cannot go stale
 * across requests, so it is safe for authorization — unlike everything else in
 * this module.
 *
 *   const perms = await cacheService.requestScope(req, `perm:${spaceId}`, () => resolve(...));
 */
const requestScope = async (req, key, producer) => {
  if (!req) return producer();
  if (!req._scopedCache) req._scopedCache = new Map();
  if (req._scopedCache.has(key)) return req._scopedCache.get(key);
  const value = await producer();
  req._scopedCache.set(key, value);
  return value;
};

/** Key namespacing. Consistent prefixes are what make prefix invalidation work. */
const keys = {
  feed: (type, sort, cursor = '') => `feed:${type}:${sort}:${cursor}`,
  feedAll: () => 'feed:',
  space: (slug) => `space:${slug}`,
  spaceAll: () => 'space:',
  post: (id) => `post:${id}`,
  user: (id) => `user:${id}`,
};

const getStats = () => ({
  ...stats,
  size: store.size,
  hitRate: stats.hits + stats.misses > 0 ? stats.hits / (stats.hits + stats.misses) : 0,
});

/** Test seam. */
const clear = () => {
  store.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.evictions = 0;
  stats.expired = 0;
};

module.exports = {
  get,
  set,
  has,
  del,
  invalidate,
  wrap,
  requestScope,
  keys,
  getStats,
  clear,
  DEFAULT_MAX_ENTRIES,
  _store: store,
};
