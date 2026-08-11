// Rate limiting.
//
// Nothing existed before, so this is a small in-process limiter rather than a
// new dependency. Limits come from the settings registry so they are tunable
// without a deploy.
//
// Scope note: counters are per-instance. Behind multiple instances the
// effective limit is N times the configured value — fine as an abuse brake,
// not a billing control. Move to a shared store if that changes.

const settingsService = require('../services/settingsService');

const buckets = new Map(); // key -> { count, resetAt }

const SWEEP_EVERY = 60_000;
let lastSweep = Date.now();

const sweep = (now) => {
  if (now - lastSweep < SWEEP_EVERY) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

const identify = (req) => (req.user ? `u:${req.user._id}` : `ip:${req.ip}`);

/**
 * @param {string} settingKey  registry key holding the limit
 * @param {number} windowMs
 * @param {string} name        bucket namespace
 */
const createLimiter = (settingKey, windowMs, name) =>
  async function limiter(req, res, next) {
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

    const now = Date.now();
    sweep(now);

    const key = `${name}:${identify(req)}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ message: 'Too many requests, please slow down', retryAfter });
    }
    bucket.count += 1;
    return next();
  };

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

module.exports = {
  createLimiter,
  orderLimiter: createLimiter('rateLimits.orderCreatePerMinute', MINUTE, 'order'),
  captureLimiter: createLimiter('rateLimits.orderCreatePerMinute', MINUTE, 'capture'),
  unlockLimiter: createLimiter('rateLimits.unlockPerMinute', MINUTE, 'unlock'),
  couponLimiter: createLimiter('rateLimits.couponValidatePerMinute', MINUTE, 'coupon'),
  refundLimiter: createLimiter('rateLimits.refundRequestPerDay', DAY, 'refund'),
  _buckets: buckets,
};
