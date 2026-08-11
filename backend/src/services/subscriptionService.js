// Subscriptions.
//
// Two things here are easy to get wrong and expensive when you do.
//
// 1. PayPal billing plans are immutable once active. Editing a price in the
//    admin portal cannot change what existing subscribers pay — it needs a new
//    plan and a migration. `syncPlan` refuses to pretend otherwise.
//
// 2. Cycle credits must be granted exactly once per cycle. PayPal redelivers
//    PAYMENT.SALE.COMPLETED, so the grant is keyed on the cycle number.

const SubscriptionPlan = require('../models/SubscriptionPlan');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Chapter = require('../models/Chapter');
const Novel = require('../models/Novel');
const paypalService = require('./paypalService');
const creditService = require('./creditService');
const settingsService = require('./settingsService');
const creditNotifications = require('./creditNotificationService');
const {
  SUBSCRIPTION_STATUS,
  CREDIT_TRANSACTION_TYPES,
  CREDIT_SOURCES,
  CREDIT_REF_TYPES,
  MICROS_PER_CENT,
} = require('../config/constants');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const planSnapshot = (plan) => ({
  id: plan._id,
  name: plan.name,
  tier: plan.tier,
  priceUsdCents: plan.priceUsdCents,
  interval: plan.interval,
  monthlyCredits: plan.monthlyCredits,
  perks: plan.perks ? plan.perks.toObject?.() || plan.perks : {},
});

/**
 * Create or replace the PayPal product and plan for a local plan.
 *
 * When the price has changed, the old plan is deactivated and a new one
 * created — existing subscribers stay on the old plan at the old price until
 * they resubscribe, which is PayPal's behaviour and not something we can
 * paper over.
 */
const syncPlan = async (plan) => {
  const notes = [];

  if (!plan.paypalProductId) {
    const product = await paypalService.createProduct({ name: plan.name, description: plan.description });
    plan.paypalProductId = product.id;
  }

  const priceChanged = plan.paypalPlanId && plan.pricedAtUsdCents !== plan.priceUsdCents;

  if (priceChanged) {
    await paypalService.deactivateBillingPlan(plan.paypalPlanId).catch(() => {});
    notes.push(
      `Price changed from $${(plan.pricedAtUsdCents / 100).toFixed(2)} to ` +
        `$${(plan.priceUsdCents / 100).toFixed(2)}. A new PayPal plan was created — existing subscribers ` +
        'stay on the old price until they resubscribe.'
    );
    plan.paypalPlanId = '';
  }

  if (!plan.paypalPlanId) {
    const created = await paypalService.createBillingPlan({
      productId: plan.paypalProductId,
      name: plan.name,
      description: plan.description,
      priceUsdCents: plan.priceUsdCents,
      interval: plan.interval,
      intervalCount: plan.intervalCount,
      trialDays: plan.trialDays,
    });
    plan.paypalPlanId = created.id;
    plan.pricedAtUsdCents = plan.priceUsdCents;
  }

  plan.paypalSyncedAt = new Date();
  await plan.save();
  return { plan, notes };
};

/** Plans a reader can choose from. */
const listPlans = async () => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('monetization.enabled') || !snapshot.get('subscriptions.enabled')) {
    return { enabled: false, plans: [] };
  }
  const plans = await SubscriptionPlan.find({ active: true, paypalPlanId: { $ne: '' } }).sort({
    sortOrder: 1,
    priceUsdCents: 1,
  });
  return {
    enabled: true,
    plans: plans.map((plan) => ({
      id: plan._id,
      name: plan.name,
      tier: plan.tier,
      description: plan.description,
      priceUsdCents: plan.priceUsdCents,
      interval: plan.interval,
      trialDays: plan.trialDays,
      monthlyCredits: plan.monthlyCredits,
      perks: plan.perks,
    })),
  };
};

/** The reader's live subscription, if any. */
const activeFor = async (userId) =>
  Subscription.findOne({
    user: userId,
    status: { $in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.PAST_DUE] },
  });

/** Start a subscription. Returns the PayPal approval link for the reader. */
const start = async ({ user, planId, returnUrl, cancelUrl }) => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('subscriptions.enabled')) throw fail('Subscriptions are not available', 503);

  const existing = await activeFor(user._id);
  if (existing) throw fail('You already have an active subscription', 409);

  // Tidy up approvals the reader walked away from. Not a correctness guard —
  // the unique index no longer covers pending rows — just housekeeping so the
  // collection does not fill with abandoned checkouts.
  await Subscription.updateMany(
    {
      user: user._id,
      status: SUBSCRIPTION_STATUS.APPROVAL_PENDING,
      createdAt: { $lt: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    },
    { $set: { status: SUBSCRIPTION_STATUS.EXPIRED } }
  );

  const plan = await SubscriptionPlan.findOne({ _id: planId, active: true });
  if (!plan || !plan.paypalPlanId) throw fail('That plan is not available', 404);

  const local = await Subscription.create({
    user: user._id,
    plan: plan._id,
    planSnapshot: planSnapshot(plan),
    status: SUBSCRIPTION_STATUS.APPROVAL_PENDING,
  });

  const { brandName } = await paypalService.credentials();
  const created = await paypalService.createSubscription({
    planId: plan.paypalPlanId,
    subscriptionId: local._id,
    returnUrl,
    cancelUrl,
    brandName,
  });

  local.paypalSubscriptionId = created.id;
  await local.save();

  const approve = (created.links || []).find((link) => link.rel === 'approve');
  return { subscription: local, approveUrl: approve ? approve.href : null };
};

/**
 * Grant one cycle's credits.
 *
 * Idempotent on the cycle number, so a redelivered sale webhook is a no-op
 * rather than a second month of credits.
 */
const grantCycle = async (subscription, { cycle, netUsdCents }) => {
  if (cycle <= subscription.lastGrantedCycle) return { granted: false, reason: 'already granted' };

  const credits = subscription.planSnapshot?.monthlyCredits || 0;
  const snapshot = await settingsService.snapshot();
  const expireWithCycle = snapshot.get('subscriptions.creditsExpireWithCycle');

  if (credits > 0) {
    const user = await User.findById(subscription.user);
    await creditService.credit({
      user: subscription.user,
      amount: credits,
      type: CREDIT_TRANSACTION_TYPES.SUBSCRIPTION_GRANT,
      source: CREDIT_SOURCES.SUBSCRIPTION,
      // Subscription credits carry real cash, so spending them recognizes
      // revenue exactly as a purchased credit does.
      costUsdCents: netUsdCents || subscription.planSnapshot?.priceUsdCents || 0,
      expiresAt: expireWithCycle ? subscription.currentPeriodEnd : null,
      idempotencyKey: `sub:${subscription._id}:${cycle}`,
      refType: CREDIT_REF_TYPES.SUBSCRIPTION,
      refId: subscription._id,
      reason: `subscription cycle ${cycle}`,
      description: `${credits} credits from your ${subscription.planSnapshot?.name || 'subscription'}`,
    });
    if (user) {
      await creditNotifications.creditsGranted(user, {
        amount: credits,
        reason: subscription.planSnapshot?.name || 'subscription',
      });
    }
  }

  subscription.lastGrantedCycle = cycle;
  subscription.cyclesCompleted = cycle;
  subscription.freeUnlocksUsedThisCycle = 0;
  subscription.cycleNetUsdCents = netUsdCents || 0;
  subscription.lifetimeUsdCents += netUsdCents || 0;
  await subscription.save();

  return { granted: true, credits };
};

/**
 * Activate a subscription PayPal has approved.
 *
 * Because pending rows no longer hold the uniqueness slot, a reader can have
 * two approvals outstanding. If both get approved PayPal will bill both, so
 * the second one to arrive is cancelled at PayPal rather than quietly kept —
 * being double-charged is a far worse outcome than a cancelled duplicate.
 */
const activate = async (subscription, details) => {
  const live = await Subscription.findOne({
    user: subscription.user,
    _id: { $ne: subscription._id },
    status: { $in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.PAST_DUE] },
  });

  if (live) {
    if (subscription.paypalSubscriptionId) {
      await paypalService
        .cancelSubscription(subscription.paypalSubscriptionId, 'Duplicate subscription')
        .catch((error) => console.error('[subscriptions] duplicate cancel failed', error.message));
    }
    subscription.status = SUBSCRIPTION_STATUS.CANCELLED;
    subscription.cancelledAt = new Date();
    subscription.cancelReason = 'duplicate of an existing subscription';
    await subscription.save();
    return { duplicate: true, granted: false, keptSubscription: live._id };
  }

  return recordRenewal(subscription, details);
};

/** A renewal succeeded. */
const recordRenewal = async (subscription, { netUsdCents, periodStart, periodEnd }) => {
  // Settle the cycle that is ending before its figures are overwritten below.
  if (subscription.cyclesCompleted > 0) {
    await attributeCycle(subscription, subscription.cyclesCompleted).catch((error) =>
      console.error('[subscriptions] attribution failed', subscription._id, error.message)
    );
  }

  subscription.status = SUBSCRIPTION_STATUS.ACTIVE;
  subscription.gracePeriodEndsAt = null;
  if (periodStart) subscription.currentPeriodStart = periodStart;
  if (periodEnd) {
    subscription.currentPeriodEnd = periodEnd;
    subscription.nextBillingAt = periodEnd;
  }
  await subscription.save();
  return grantCycle(subscription, { cycle: subscription.cyclesCompleted + 1, netUsdCents });
};

/**
 * A payment failed.
 *
 * Access continues through the grace window while PayPal retries, so a card
 * expiring does not lock someone out mid-chapter.
 */
const recordPaymentFailure = async (subscription) => {
  const days = await settingsService.get('subscriptions.gracePeriodDays');
  subscription.status = SUBSCRIPTION_STATUS.PAST_DUE;
  subscription.gracePeriodEndsAt = new Date(Date.now() + days * 24 * 3600 * 1000);
  await subscription.save();

  const user = await User.findById(subscription.user);
  if (user) {
    await creditNotifications.notify('purchase_failed', {
      user,
      vars: { orderNumber: subscription.planSnapshot?.name || 'your subscription' },
      link: '/profile',
    });
  }
  return subscription;
};

/** Cancel, at period end by default so the reader keeps what they paid for. */
const cancel = async ({ user, reason = '' }) => {
  const subscription = await activeFor(user._id);
  if (!subscription) throw fail('You do not have an active subscription', 404);

  const atPeriodEnd = await settingsService.get('subscriptions.cancelAtPeriodEnd');

  if (subscription.paypalSubscriptionId) {
    await paypalService.cancelSubscription(subscription.paypalSubscriptionId, reason || 'Cancelled by the subscriber');
  }

  subscription.cancelReason = reason;
  subscription.cancelledAt = new Date();
  if (atPeriodEnd && subscription.currentPeriodEnd > new Date()) {
    subscription.cancelAtPeriodEnd = true;
  } else {
    subscription.status = SUBSCRIPTION_STATUS.CANCELLED;
  }
  await subscription.save();
  return subscription;
};

/**
 * Close out subscriptions whose paid period has elapsed.
 *
 * Done one at a time rather than with updateMany because a closing cycle also
 * has to have its cash attributed, and that needs each subscription's own
 * period window and read history.
 */
const expireLapsed = async () => {
  const now = new Date();
  let expired = 0;
  let suspended = 0;

  const ending = await Subscription.find({
    cancelAtPeriodEnd: true,
    currentPeriodEnd: { $lte: now },
    status: SUBSCRIPTION_STATUS.ACTIVE,
  }).limit(500);

  for (const subscription of ending) {
    await attributeCycle(subscription, subscription.cyclesCompleted).catch((error) =>
      console.error('[subscriptions] attribution failed', subscription._id, error.message)
    );
    subscription.status = SUBSCRIPTION_STATUS.EXPIRED;
    await subscription.save();
    expired += 1;
  }

  const lapsed = await Subscription.find({
    status: SUBSCRIPTION_STATUS.PAST_DUE,
    gracePeriodEndsAt: { $lte: now },
  }).limit(500);

  for (const subscription of lapsed) {
    await attributeCycle(subscription, subscription.cyclesCompleted).catch((error) =>
      console.error('[subscriptions] attribution failed', subscription._id, error.message)
    );
    subscription.status = SUBSCRIPTION_STATUS.SUSPENDED;
    await subscription.save();
    suspended += 1;
  }

  return { expired, suspended };
};

/**
 * Does this reader's subscription cover this novel right now?
 *
 * Called by the access resolver, so it stays cheap and returns a plain boolean.
 */
const coversNovel = async (userId, novelId) => {
  if (!userId) return false;
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('subscriptions.enabled')) return false;

  const subscription = await activeFor(userId);
  if (!subscription || !subscription.isEntitled()) return false;
  return subscription.coversNovel(novelId);
};

/**
 * Spend one unlock from a metered per-cycle allowance.
 *
 * The limit is enforced inside the update predicate, not by a read-then-write,
 * because two tabs unlocking at once would otherwise both see "4 of 5 used".
 * Returns null when there was nothing to spend, so the caller falls back to
 * charging credits.
 */
const claimFreeUnlock = async (userId) => {
  const subscription = await activeFor(userId);
  if (!subscription || !subscription.isEntitled()) return null;

  const perks = subscription.perks();
  if (perks.freeUnlocks !== 'up_to_n_per_cycle') return null;
  const limit = perks.freeUnlockLimit || 0;
  if (limit <= 0) return null;

  const result = await Subscription.updateOne(
    { _id: subscription._id, freeUnlocksUsedThisCycle: { $lt: limit } },
    { $inc: { freeUnlocksUsedThisCycle: 1 } }
  );
  if (!result.modifiedCount) return null;

  // The denominator is known up front for a metered allowance, so each unlock
  // can carry its honest share of the cycle's cash immediately. Unmetered tiers
  // cannot do this and are settled by `attributeCycle` when the cycle closes.
  const cycleMicros = (subscription.cycleNetUsdCents || 0) * MICROS_PER_CENT;
  return {
    subscription,
    attributedUsdMicros: Math.floor(cycleMicros / limit),
    remaining: limit - (subscription.freeUnlocksUsedThisCycle || 0) - 1,
  };
};

/**
 * Settle an unmetered cycle's cash across the chapters it actually bought.
 *
 * A $9.99 all-you-can-read month is real revenue, but until the cycle ends
 * there is no denominator to divide it by — the reader might open one chapter
 * or eighty. So it is split evenly at cycle close over the chapters first read
 * during the cycle. Idempotent on the cycle number: replays are no-ops.
 */
const attributeCycle = async (subscription, cycle) => {
  if (!subscription || cycle <= 0) return { attributed: 0 };
  if ((subscription.attributedCycles || []).includes(cycle)) return { attributed: 0, replayed: true };

  const perks = subscription.perks ? subscription.perks() : subscription.planSnapshot?.perks || {};
  const unmetered = perks.freeUnlocks === 'all' || perks.freeUnlocks === 'selected_novels';
  const cents = subscription.cycleNetUsdCents || 0;

  // Claim the cycle first. If nothing is owed we still claim it, so a later
  // replay cannot re-enter and double-post.
  const claimed = await Subscription.updateOne(
    { _id: subscription._id, attributedCycles: { $ne: cycle } },
    { $push: { attributedCycles: cycle } }
  );
  if (!claimed.modifiedCount) return { attributed: 0, replayed: true };

  if (!unmetered || cents <= 0) return { attributed: 0 };

  const start = subscription.currentPeriodStart;
  const end = subscription.currentPeriodEnd || new Date();
  if (!start) return { attributed: 0 };

  const ChapterRead = require('../models/ChapterRead');
  const query = {
    user: subscription.user,
    firstReadAt: { $gte: start, $lt: end },
  };
  if (perks.freeUnlocks === 'selected_novels') {
    query.novel = { $in: perks.freeUnlockNovels || [] };
  }
  const reads = await ChapterRead.find(query).select('chapter novel chapterNumber');
  if (!reads.length) return { attributed: 0, reads: 0 };

  const total = cents * MICROS_PER_CENT;
  const per = Math.floor(total / reads.length);
  // The last chapter absorbs the remainder so the parts sum exactly to the cash.
  let allocated = 0;
  const readTracking = require('./readTrackingService');

  for (let index = 0; index < reads.length; index += 1) {
    const read = reads[index];
    const micros = index === reads.length - 1 ? total - allocated : per;
    allocated += micros;
    await readTracking.recordUnlock({
      chapter: read.chapter,
      novel: read.novel,
      chapterNumber: read.chapterNumber,
      creditsSpent: 0,
      attributedUsdMicros: micros,
    });
    await Promise.all([
      Chapter.updateOne({ _id: read.chapter }, { $inc: { revenueLifetimeUsdMicros: micros } }),
      Novel.updateOne({ _id: read.novel }, { $inc: { revenueLifetimeUsdMicros: micros } }),
    ]);
  }

  return { attributed: allocated, reads: reads.length };
};

module.exports = {
  syncPlan,
  listPlans,
  activeFor,
  start,
  grantCycle,
  recordRenewal,
  recordPaymentFailure,
  activate,
  cancel,
  expireLapsed,
  coversNovel,
  claimFreeUnlock,
  attributeCycle,
  planSnapshot,
};
