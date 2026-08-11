// Scheduled job definitions.
//
// Each job declares its own schedule key so the cadence is admin-editable
// rather than hardcoded. `run` returns a small summary object that lands in
// JobRun.result and shows up in the admin portal.

const Novel = require('../models/Novel');
const CreditBucket = require('../models/CreditBucket');
const ChapterAccess = require('../models/ChapterAccess');
const Wallet = require('../models/Wallet');
const CreditTransaction = require('../models/CreditTransaction');
const WebhookEvent = require('../models/WebhookEvent');
const JobRun = require('../models/JobRun');
const fxService = require('../services/fxService');
const orderService = require('../services/orderService');
const creditService = require('../services/creditService');
const settingsService = require('../services/settingsService');
const { CREDIT_TRANSACTION_TYPES, WEBHOOK_STATUS } = require('../config/constants');

/**
 * Reset the rolling view counter that "Trending" ranks on.
 *
 * This job not existing is a live bug: `weeklyViews` is incremented in two
 * places and reset nowhere, and TRENDING_WINDOW_DAYS was exported but imported
 * by nothing. Trending has therefore been a permanently accumulating counter —
 * functionally identical to all-time Popular with a different start date.
 */
const trendingReset = {
  name: 'trending.reset',
  label: 'Reset trending counters',
  scheduleKey: 'ranking.trendingResetCron',
  ttlMs: 5 * 60 * 1000,
  run: async () => {
    const result = await Novel.updateMany({ weeklyViews: { $gt: 0 } }, { $set: { weeklyViews: 0 } });
    return { novelsReset: result.modifiedCount || 0 };
  },
};

const fxRefresh = {
  name: 'fx.refresh',
  label: 'Refresh exchange rates',
  scheduleKey: 'fx.refreshCron',
  ttlMs: 5 * 60 * 1000,
  run: async () => fxService.refreshRates(),
};

const expireOrders = {
  name: 'orders.expire',
  label: 'Expire stale orders',
  schedule: '*/15 * * * *',
  ttlMs: 5 * 60 * 1000,
  run: async () => orderService.expireStaleOrders(),
};

/**
 * Zero out expired credit tranches.
 *
 * The forfeited cost basis is real money kept with no content delivered, so it
 * is reported separately rather than being quietly folded into revenue.
 */
const expireCredits = {
  name: 'credits.expire',
  label: 'Sweep expired credits',
  scheduleKey: 'expiry.sweepCron',
  ttlMs: 30 * 60 * 1000,
  run: async () => {
    const snapshot = await settingsService.snapshot();
    if (!snapshot.get('expiry.enabled')) return { skipped: true, reason: 'expiry disabled' };

    const now = new Date();
    const expired = await CreditBucket.find({ expiresAt: { $ne: null, $lte: now }, remaining: { $gt: 0 } });

    let credits = 0;
    let forfeitedMicros = 0;
    for (const bucket of expired) {
      const claimed = await CreditBucket.findOneAndUpdate(
        { _id: bucket._id, remaining: bucket.remaining },
        { $set: { remaining: 0, remainingCostMicros: 0 } }
      );
      if (!claimed) continue; // spent between the read and the write

      const wallet = await Wallet.findOneAndUpdate(
        { user: bucket.user },
        { $inc: { balance: -bucket.remaining, lifetimeExpired: bucket.remaining } },
        { new: true }
      );

      await CreditTransaction.create({
        user: bucket.user,
        type: CREDIT_TRANSACTION_TYPES.EXPIRE,
        amount: -bucket.remaining,
        balanceAfter: wallet ? wallet.balance : 0,
        attributedUsdMicros: 0,
        bucketBreakdown: [
          { bucket: bucket._id, credits: bucket.remaining, costMicros: bucket.remainingCostMicros },
        ],
        idempotencyKey: `expire:${bucket._id}`,
        reason: 'credits expired',
        description: `${bucket.remaining} credits expired`,
      }).catch((error) => {
        if (error.code !== 11000) throw error;
      });

      credits += bucket.remaining;
      forfeitedMicros += bucket.remainingCostMicros;
    }
    return { buckets: expired.length, credits, forfeitedUsdCents: Math.round(forfeitedMicros / 10000) };
  },
};

/**
 * Close out subscriptions whose period has ended.
 *
 * Runs hourly rather than daily: a grace period measured in days still ends at
 * a specific hour, and letting a suspended subscriber keep reading for most of
 * a day is a real revenue leak. This is also where an unmetered cycle's cash is
 * finally attributed to the chapters it bought.
 */
const expireSubscriptions = {
  name: 'subscriptions.expire',
  label: 'Expire lapsed subscriptions',
  schedule: '15 * * * *',
  scheduleKey: 'subscriptions.expireCron',
  ttlMs: 15 * 60 * 1000,
  run: async () => {
    const snapshot = await settingsService.snapshot();
    if (!snapshot.get('subscriptions.enabled')) return { skipped: 'subscriptions disabled' };
    return require('../services/subscriptionService').expireLapsed();
  },
};

const expireRentals = {
  name: 'rentals.expire',
  label: 'Expire rentals',
  schedule: '5 * * * *',
  ttlMs: 10 * 60 * 1000,
  run: async () => {
    const result = await ChapterAccess.deleteMany({ expiresAt: { $ne: null, $lte: new Date() } });
    return { expired: result.deletedCount || 0 };
  },
};

/**
 * Compare wallet balances against the ledger.
 *
 * Reports rather than repairs by default — silent auto-correction would hide
 * whatever caused the drift.
 */
const reconcileLedger = {
  name: 'ledger.reconcile',
  label: 'Reconcile wallets against the ledger',
  schedule: '30 4 * * *',
  ttlMs: 30 * 60 * 1000,
  run: async () => {
    const result = await creditService.reconcile({ apply: false });
    if (result.drift.length) {
      console.error('[ledger.reconcile] drift detected on', result.drift.length, 'wallet(s)');
    }
    return { checked: result.checked, driftCount: result.drift.length, drift: result.drift.slice(0, 20) };
  },
};

/** Retry webhooks that failed for a transient reason. */
const retryWebhooks = {
  name: 'webhooks.retry',
  label: 'Retry failed webhooks',
  schedule: '*/10 * * * *',
  ttlMs: 5 * 60 * 1000,
  run: async () => {
    const { replayWebhook } = require('../controllers/webhookController');
    const stuck = await WebhookEvent.find({
      status: WEBHOOK_STATUS.FAILED,
      signatureVerified: true,
      attempts: { $lt: 5 },
    }).limit(50);
    // Replay is exposed as a controller for the admin button; reuse its handler
    // map rather than duplicating the event routing here.
    let retried = 0;
    for (const event of stuck) {
      const fakeRes = {
        json: () => {
          retried += 1;
        },
        status: () => ({ json: () => {} }),
      };
      await replayWebhook({ params: { id: event._id } }, fakeRes, () => {}).catch(() => {});
    }
    return { candidates: stuck.length, retried };
  },
};

/**
 * Rebuild the trailing rollup window.
 *
 * A trailing window rather than just today, because refunds and late webhooks
 * change days that have already closed — recomputing only the current day
 * would leave yesterday permanently wrong.
 */
const rebuildRollups = {
  name: 'analytics.rollup',
  label: 'Rebuild analytics rollups',
  scheduleKey: 'analytics.rollupCron',
  ttlMs: 30 * 60 * 1000,
  run: async () => require('../services/rollupService').rebuildRecent(3),
};

/** Trim old job history so the collection does not grow without bound. */
const pruneJobRuns = {
  name: 'jobs.prune',
  label: 'Prune job history',
  schedule: '0 5 * * *',
  ttlMs: 5 * 60 * 1000,
  run: async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await JobRun.deleteMany({ startedAt: { $lt: cutoff } });
    return { removed: result.deletedCount || 0 };
  },
};

/** Fire campaigns whose scheduled time has arrived, and resume stalled ones. */
const runScheduledGrants = {
  name: 'grants.scheduled',
  label: 'Run scheduled grant campaigns',
  schedule: '*/5 * * * *',
  ttlMs: 30 * 60 * 1000,
  run: async () => {
    const grantService = require('../services/grantService');
    const [due, stalled] = await Promise.all([grantService.runDueCampaigns(), grantService.resumeStalled()]);
    return { due: due.due, resumed: stalled.stalled, results: [...due.results, ...stalled.results] };
  },
};

/** Warn readers before credits expire, while they can still spend them. */
const warnExpiringCredits = {
  name: 'credits.expiryWarning',
  label: 'Warn about expiring credits',
  schedule: '0 10 * * *',
  ttlMs: 30 * 60 * 1000,
  run: async () => {
    const snapshot = await settingsService.snapshot();
    if (!snapshot.get('expiry.enabled')) return { skipped: true, reason: 'expiry disabled' };
    const warnDays = snapshot.get('expiry.warnDaysBefore');
    if (!warnDays) return { skipped: true, reason: 'warnings disabled' };

    const User = require('../models/User');
    const creditNotifications = require('../services/creditNotificationService');
    const from = new Date();
    const to = new Date(Date.now() + warnDays * 24 * 3600 * 1000);

    const soon = await CreditBucket.aggregate([
      { $match: { expiresAt: { $gt: from, $lte: to }, remaining: { $gt: 0 } } },
      { $group: { _id: '$user', credits: { $sum: '$remaining' }, soonest: { $min: '$expiresAt' } } },
    ]);

    let notified = 0;
    for (const row of soon) {
      const user = await User.findById(row._id);
      if (!user) continue;
      await creditNotifications.creditsExpiring(user, { amount: row.credits, expiresAt: row.soonest });
      notified += 1;
    }
    return { notified };
  },
};

const JOBS = [
  trendingReset,
  fxRefresh,
  expireOrders,
  expireCredits,
  warnExpiringCredits,
  expireRentals,
  expireSubscriptions,
  runScheduledGrants,
  rebuildRollups,
  reconcileLedger,
  retryWebhooks,
  pruneJobRuns,
];

module.exports = {
  JOBS,
  trendingReset,
  fxRefresh,
  expireOrders,
  expireCredits,
  warnExpiringCredits,
  expireRentals,
  expireSubscriptions,
  runScheduledGrants,
  rebuildRollups,
  reconcileLedger,
};
