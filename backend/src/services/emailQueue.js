// Outbound email queue.
//
// Before this, sendNotificationEmail called transport.sendMail directly and
// dispatchCampaign fired them inside Promise.all over chunks of 250 — up to 250
// concurrent SMTP connections. Essentially every provider throttles, defers or
// blocks at that rate, and the failures vanished into a .catch(console.error).
// A 12k-recipient grant campaign would mostly not arrive, silently.
//
// This is an in-process queue, which suits a single instance. It is deliberately
// small: bounded concurrency, retry with backoff, a per-user daily cap and
// counters worth showing in the admin portal. If NovelHub ever runs more than
// one instance, swap the internals for a durable queue — the interface stays.

const settingsService = require('./settingsService');

const queue = [];
const sentToday = new Map(); // email -> { day, count }

let active = 0;
let draining = false;
let sender = null;
// Jobs waiting out a backoff. Counted separately from `queue` and `active`
// because they are in neither, and flush() must still wait for them.
const retryTimers = new Set();

// Bumped by reset(). A drain that was already running when the queue was reset
// belongs to the previous generation: it holds a stale config snapshot, and
// letting it keep draining means two drains racing over one queue — the older
// one admitting jobs under the limits that applied before the reset.
let generation = 0;

const stats = { queued: 0, sent: 0, failed: 0, retried: 0, skippedByCap: 0 };

const dayKey = () => new Date().toISOString().slice(0, 10);

/**
 * The queue does not know how to send. The caller injects that, which keeps
 * this testable without SMTP and avoids a require cycle with utils/mailer.
 */
const setSender = (fn) => {
  sender = fn;
};

/**
 * Claim one of today's slots for this recipient, or refuse.
 *
 * Check and increment together, at ADMISSION rather than on completion. The
 * counter used to be bumped after `sender()` resolved, so with concurrency N
 * the first N jobs for one address were all dequeued and started before any of
 * them had counted — a cap of 2 let five through.
 *
 * A retried job keeps the slot it already claimed, so backoff attempts do not
 * each consume one.
 */
const reserveSlot = (job, cap) => {
  if (job.reserved) return true;
  if (!cap) {
    job.reserved = true;
    return true;
  }
  const today = dayKey();
  const to = job.message.to;
  const row = sentToday.get(to);
  if (!row || row.day !== today) sentToday.set(to, { day: today, count: 1 });
  else if (row.count >= cap) return false;
  else row.count += 1;
  job.reserved = true;
  return true;
};


// Exponential backoff. The base is a test seam: the real 1s/2s/4s schedule is
// right for a throttling mail server and wrong for a test that has to sit
// through it, and a suite waiting seven seconds per retry case is one slow CI
// box away from a flake.
let backoffBase = 500;
const setBackoffBase = (ms) => {
  backoffBase = Math.max(1, Number(ms) || 500);
};
const backoffMs = (attempt) => Math.min(30000, backoffBase * 2 ** attempt);

const runOne = async (job, config) => {
  try {
    await sender(job.message);
    stats.sent += 1;
  } catch (error) {
    job.attempts += 1;
    if (job.attempts <= config.maxAttempts) {
      stats.retried += 1;
      // Re-queue behind current work rather than blocking the drain. The timer
      // is tracked so flush() waits for it: previously the job was in neither
      // `queue` nor `active` while it waited, so flush() returned early and the
      // retry fired after the caller had moved on — which in tests meant the
      // callback ran against a torn-down database.
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        queue.push(job);
        drain().catch((err) => console.error('[emailQueue] retry drain failed:', err.message));
      }, backoffMs(job.attempts));
      timer.unref?.();
      retryTimers.add(timer);
      return;
    }
    stats.failed += 1;
    console.error(`[emailQueue] giving up on ${job.message.to} after ${job.attempts}:`, error.message);
  }
};

const drain = async () => {
  if (draining) return;
  draining = true;
  const myGeneration = generation;
  try {
    const snapshot = await settingsService.snapshot();
    if (myGeneration !== generation) return;
    const config = {
      concurrency: Math.max(1, snapshot.get('notifications.emailConcurrency')),
      perUserPerDay: snapshot.get('notifications.maxEmailsPerUserPerDay'),
      maxAttempts: 3,
    };

    // One condition covering all three kinds of outstanding work: queued jobs,
    // sends still in flight, and retries waiting out a backoff.
    //
    // These cannot be separate phases. A drain that emptied the queue and then
    // waited for in-flight sends in a second loop would ignore anything pushed
    // back during that wait — and a retry timer firing in exactly that window
    // hits `if (draining) return` and is swallowed, so the job sits in the
    // queue with nothing left to pick it up and flush() blocks until timeout.
    while (queue.length || retryTimers.size || active > 0) {
      if (myGeneration !== generation) return; // reset() superseded this drain
      if (!queue.length) {
        // In-flight work or a pending backoff. Wait for it rather than
        // declaring the queue drained.
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      if (active >= config.concurrency) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }

      const job = queue.shift();
      if (!job) continue;

      if (!reserveSlot(job, config.perUserPerDay)) {
        stats.skippedByCap += 1;
        continue;
      }

      active += 1;
      runOne(job, config).finally(() => {
        active -= 1;
      });
    }
  } finally {
    draining = false;
  }
};

/**
 * Queue a message. Returns immediately — delivery is asynchronous by design,
 * so a slow mail server never delays a credit or an HTTP response.
 */
const enqueue = (message) => {
  if (!sender) {
    console.error('[emailQueue] no sender configured, dropping message');
    return false;
  }
  if (!message || !message.to) return false;
  queue.push({ message, attempts: 0, queuedAt: Date.now() });
  stats.queued += 1;
  drain().catch((error) => console.error('[emailQueue] drain failed:', error.message));
  return true;
};

/** Wait for the queue to empty. For tests and graceful shutdown. */
const flush = async (timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while ((queue.length || active > 0 || retryTimers.size) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return {
    drained: queue.length === 0 && active === 0 && retryTimers.size === 0,
    pending: queue.length + retryTimers.size,
  };
};

const getStats = () => ({ ...stats, pending: queue.length + retryTimers.size, active });

/** Test seam. */
const reset = () => {
  queue.length = 0;
  sentToday.clear();
  // Cancel pending backoffs. A surviving timer fires after the suite that
  // queued it has finished and drains against a closed connection.
  retryTimers.forEach((timer) => clearTimeout(timer));
  retryTimers.clear();
  backoffBase = 500;
  generation += 1;
  active = 0;
  draining = false;
  Object.keys(stats).forEach((key) => {
    stats[key] = 0;
  });
};

module.exports = { enqueue, flush, getStats, setSender, reset, setBackoffBase, _queue: queue };
