// Rate limiting.
//
// Limits come from the settings registry so they are tunable without a deploy.
// Storage lives behind services/rateLimitStore.js so the counter backend can be
// swapped for Redis later without touching this file or any call site.
//
// Scope note: the default memory store keeps counters per-instance. Behind N
// instances the effective limit is N times the configured value — fine as an
// abuse brake, not a billing control. Community write endpoints are public and
// higher-volume than the payment endpoints this originally guarded, so their
// limits are set conservatively enough that N× still lands somewhere sane.
// See docs/spaces/scalability.md §5.2.

const settingsService = require('../services/settingsService');
const rateLimitStore = require('../services/rateLimitStore');
const { ROLES } = require('../config/constants');

const identify = (req) => (req.user ? `u:${req.user._id}` : `ip:${req.ip}`);

/**
 * @param {string} settingKey  registry key holding the limit
 * @param {number} windowMs
 * @param {string} name        bucket namespace
 * @param {object} [options]
 * @param {function} [options.scope]  extra key component, e.g. per-space
 */
const createLimiter = (settingKey, windowMs, name, { scope = null } = {}) =>
  async function limiter(req, res, next) {
    // These limits are an abuse brake on the public. The owner tripping one
    // mid-incident — bulk-editing content or replaying webhooks to fix an
    // outage — is the brake working against the person trying to stop the fire.
    if (req.user && req.user.role === ROLES.SUPERADMIN) return next();

    let enabled = true;
    let max = 0;
    try {
      const snapshot = await settingsService.snapshot();
      enabled = snapshot.get('rateLimits.enabled');
      max = snapshot.get(settingKey);
    } catch (error) {
      return next(); // never block traffic because settings failed to load
    }
    if (!enabled || !max) return next();

    const parts = [name, identify(req)];
    if (scope) {
      const extra = scope(req);
      if (extra) parts.push(extra);
    }
    const key = parts.join(':');

    let bucket;
    try {
      bucket = await rateLimitStore.incr(key, windowMs);
    } catch (error) {
      // A store outage must not become an outage of the site it protects.
      console.error('[rateLimit] store failed:', error.message);
      return next();
    }

    // Headers on every response, not only on rejection — a client that can see
    // its remaining budget can back off before being told to.
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.set('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - Date.now()) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ message: 'Too many requests, please slow down', retryAfter });
    }

    return next();
  };

const MINUTE = 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

module.exports = {
  createLimiter,

  // Payments and reading.
  orderLimiter: createLimiter('rateLimits.orderCreatePerMinute', MINUTE, 'order'),
  captureLimiter: createLimiter('rateLimits.orderCreatePerMinute', MINUTE, 'capture'),
  unlockLimiter: createLimiter('rateLimits.unlockPerMinute', MINUTE, 'unlock'),
  couponLimiter: createLimiter('rateLimits.couponValidatePerMinute', MINUTE, 'coupon'),
  refundLimiter: createLimiter('rateLimits.refundRequestPerDay', DAY, 'refund'),

  // Community. Used from Phase 2 onward.
  postLimiter: createLimiter('spaces.posting.postsPerHour', HOUR, 'space.post'),
  commentLimiter: createLimiter('spaces.posting.commentsPerHour', HOUR, 'space.comment'),
  voteLimiter: createLimiter('spaces.voting.perMinuteLimit', MINUTE, 'space.vote'),
  reportLimiter: createLimiter('spaces.moderation.maxReportsPerUserPerDay', DAY, 'space.report'),
  // Uploads are the costliest requests in the system and were the one write
  // family with no ceiling — the natural target for both denial of service
  // and plain cost amplification.
  uploadLimiter: createLimiter('spaces.media.uploadsPerHour', HOUR, 'space.upload'),

  _store: rateLimitStore,
  _reset: () => rateLimitStore.clear(),

  // Backwards compatibility: tests/setup.js and tests/fxAndLimits.js call
  // `rateLimit._buckets.clear()` between cases. A getter rather than a static
  // reference, so it still resolves correctly if the store is swapped.
  //
  // Fully defensive: a test that installs a stub store may not implement
  // `clear`, and a teardown hook must never be the thing that fails a test.
  get _buckets() {
    const store = rateLimitStore.getStore();
    if (store && store._buckets) return store._buckets;
    return {
      clear: () => {
        if (store && typeof store.clear === 'function') return store.clear();
        return undefined;
      },
    };
  },
};
