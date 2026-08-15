// Job dispatch seam.
//
// Today: handlers run in-process, either immediately after the response is
// sent or on a short delay. There is no queue, and this file deliberately does
// not add one.
//
// Later: the same `enqueue(name, payload)` call backed by BullMQ on Redis, with
// the existing Node image running as a worker under a different entrypoint.
// Call sites do not change.
//
// WHY THIS MATTERS IN PHASE 4: link preview fetching, thumbnail generation and
// CSAM hash matching all take hundreds of milliseconds and reach out to the
// network. Doing them inline makes post creation slow and couples a user's
// write to a third party's availability. Writing them as dispatched jobs from
// day one costs nothing and makes the queue swap invisible.
//
// GUARANTEE, STATED HONESTLY: in-process dispatch is at-most-once. A crash
// loses queued work. That is acceptable for previews and thumbnails, which are
// retried by the existing cron sweeps, and it is NOT acceptable for anything
// that must happen exactly once — those still belong in a JobRun-backed cron
// job with a JobLock, which the codebase already has.

const handlers = new Map();
const stats = { dispatched: 0, completed: 0, failed: 0, unhandled: 0 };
let inFlight = 0;

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Register a handler.
 *
 *   jobDispatcher.register('post.linkPreview', async ({ postId }) => { ... });
 *
 * Registration is idempotent by name so a module reloaded under a test harness
 * does not accumulate duplicate handlers.
 */
const register = (name, handler, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  if (typeof handler !== 'function') throw new Error(`Handler for ${name} must be a function`);
  handlers.set(name, { handler, timeoutMs });
  return handler;
};

const withTimeout = (promise, ms, name) =>
  Promise.race([
    promise,
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Job ${name} timed out after ${ms}ms`)), ms);
      if (timer.unref) timer.unref();
    }),
  ]);

const run = async (name, payload) => {
  const entry = handlers.get(name);
  if (!entry) {
    stats.unhandled += 1;
    console.warn(`[jobs] no handler registered for "${name}"`);
    return { ok: false, reason: 'no_handler' };
  }

  inFlight += 1;
  const startedAt = Date.now();
  try {
    const result = await withTimeout(
      Promise.resolve(entry.handler(payload)),
      entry.timeoutMs,
      name
    );
    stats.completed += 1;
    return { ok: true, result, ms: Date.now() - startedAt };
  } catch (error) {
    stats.failed += 1;
    // A background job must never take down the request that scheduled it, and
    // must never become an unhandled rejection.
    console.error(`[jobs] ${name} failed after ${Date.now() - startedAt}ms:`, error.message);
    return { ok: false, error: error.message };
  } finally {
    inFlight -= 1;
  }
};

/**
 * Schedule work.
 *
 *   jobDispatcher.enqueue('post.linkPreview', { postId });
 *
 * Returns immediately. The handler runs on a later tick via setImmediate, so
 * the HTTP response is already on its way out — the caller is never blocked.
 *
 * @param {string} name
 * @param {object} payload    must be plain and serializable, so the same call
 *                            works unchanged once a real queue is behind it
 * @param {object} [options]
 * @param {number} [options.delayMs]
 * @param {boolean} [options.await]  run inline and await. For tests, and for
 *                                   the rare caller that genuinely needs the
 *                                   result before responding.
 */
const enqueue = (name, payload = {}, { delayMs = 0, await: awaitResult = false } = {}) => {
  stats.dispatched += 1;

  if (awaitResult) return run(name, payload);

  if (delayMs > 0) {
    const timer = setTimeout(() => {
      run(name, payload).catch(() => {});
    }, delayMs);
    if (timer.unref) timer.unref();
    return Promise.resolve({ scheduled: true, delayMs });
  }

  setImmediate(() => {
    run(name, payload).catch(() => {});
  });
  return Promise.resolve({ scheduled: true });
};

/** Dispatch many at once — notification fan-out, bulk moderation. */
const enqueueMany = (name, payloads = [], options) =>
  Promise.all(payloads.map((payload) => enqueue(name, payload, options)));

/**
 * Wait for in-flight jobs to finish.
 *
 * Called from server.js during shutdown, alongside the scheduler drain. Without
 * it, a deploy kills work that was already accepted.
 */
const drain = async (timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { drained: inFlight === 0, inFlight };
};

const getStats = () => ({ ...stats, inFlight, handlers: [...handlers.keys()] });

/** Test seam. */
const reset = () => {
  handlers.clear();
  inFlight = 0;
  stats.dispatched = 0;
  stats.completed = 0;
  stats.failed = 0;
  stats.unhandled = 0;
};

module.exports = { register, enqueue, enqueueMany, run, drain, getStats, reset, handlers };
