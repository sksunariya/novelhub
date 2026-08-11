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

const stats = { queued: 0, sent: 0, failed: 0, retried: 0, skippedByCap: 0 };

const dayKey = () => new Date().toISOString().slice(0, 10);

/**
 * The queue does not know how to send. The caller injects that, which keeps
 * this testable without SMTP and avoids a require cycle with utils/mailer.
 */
const setSender = (fn) => {
  sender = fn;
};

const underDailyCap = (to, cap) => {
  if (!cap) return true;
  const today = dayKey();
  const row = sentToday.get(to);
  if (!row || row.day !== today) return true;
  return row.count < cap;
};

const recordSend = (to) => {
  const today = dayKey();
  const row = sentToday.get(to);
  if (!row || row.day !== today) sentToday.set(to, { day: today, count: 1 });
  else row.count += 1;
};

const backoffMs = (attempt) => Math.min(30000, 500 * 2 ** attempt);

const runOne = async (job, config) => {
  try {
    await sender(job.message);
    recordSend(job.message.to);
    stats.sent += 1;
  } catch (error) {
    job.attempts += 1;
    if (job.attempts <= config.maxAttempts) {
      stats.retried += 1;
      // Re-queue behind current work rather than blocking the drain.
      setTimeout(() => {
        queue.push(job);
        drain();
      }, backoffMs(job.attempts)).unref?.();
      return;
    }
    stats.failed += 1;
    console.error(`[emailQueue] giving up on ${job.message.to} after ${job.attempts}:`, error.message);
  }
};

const drain = async () => {
  if (draining) return;
  draining = true;
  try {
    const snapshot = await settingsService.snapshot();
    const config = {
      concurrency: Math.max(1, snapshot.get('notifications.emailConcurrency')),
      perUserPerDay: snapshot.get('notifications.maxEmailsPerUserPerDay'),
      maxAttempts: 3,
    };

    while (queue.length) {
      while (active >= config.concurrency) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const job = queue.shift();
      if (!job) break;

      if (!underDailyCap(job.message.to, config.perUserPerDay)) {
        stats.skippedByCap += 1;
        continue;
      }

      active += 1;
      runOne(job, config).finally(() => {
        active -= 1;
      });
    }

    // Let the last batch settle so callers awaiting flush() see final counts.
    while (active > 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
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
  while ((queue.length || active > 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { drained: queue.length === 0 && active === 0, pending: queue.length };
};

const getStats = () => ({ ...stats, pending: queue.length, active });

/** Test seam. */
const reset = () => {
  queue.length = 0;
  sentToday.clear();
  active = 0;
  draining = false;
  Object.keys(stats).forEach((key) => {
    stats[key] = 0;
  });
};

module.exports = { enqueue, flush, getStats, setSender, reset, _queue: queue };
