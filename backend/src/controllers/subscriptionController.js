// Subscriptions: reader-facing endpoints and the admin plan catalogue.
//
// The admin half is deliberately noisy about PayPal's constraint that an active
// billing plan cannot be repriced. Silently letting an admin "edit" a price
// would leave existing subscribers paying the old amount with nothing in the UI
// to say so, which is the kind of bug that only surfaces in a chargeback.

const SubscriptionPlan = require('../models/SubscriptionPlan');
const Subscription = require('../models/Subscription');
const AdminAuditLog = require('../models/AdminAuditLog');
const subscriptionService = require('../services/subscriptionService');
const settingsService = require('../services/settingsService');
const paypalService = require('../services/paypalService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { parsePagination } = require('./novelController');
const { SUBSCRIPTION_STATUS } = require('../config/constants');

const audit = (req, action, entityId, changes, note = '') =>
  AdminAuditLog.create({
    actor: req.user._id,
    actorLabel: req.user.username || req.user.email,
    action,
    entity: 'subscriptionPlan',
    entityId: String(entityId || ''),
    changes,
    note,
    ip: req.ip,
    userAgent: (req.headers['user-agent'] || '').slice(0, 300),
  });

const publicSubscription = (subscription) =>
  subscription && {
    id: subscription._id,
    status: subscription.status,
    plan: subscription.planSnapshot,
    entitled: subscription.isEntitled(),
    currentPeriodEnd: subscription.currentPeriodEnd,
    nextBillingAt: subscription.nextBillingAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    gracePeriodEndsAt: subscription.gracePeriodEndsAt,
    freeUnlocksRemaining: subscription.freeUnlocksRemaining(),
    cyclesCompleted: subscription.cyclesCompleted,
  };

// ------------------------------------------------------------ reader

/** GET /api/subscriptions/plans */
const listPlans = asyncHandler(async (req, res) => {
  const result = await subscriptionService.listPlans();
  const mine = req.user ? await subscriptionService.activeFor(req.user._id) : null;
  res.json({ ...result, current: publicSubscription(mine) });
});

/** GET /api/subscriptions/me */
const mySubscription = asyncHandler(async (req, res) => {
  const subscription = await subscriptionService.activeFor(req.user._id);
  res.json({ subscription: publicSubscription(subscription) });
});

/** POST /api/subscriptions */
const subscribe = asyncHandler(async (req, res) => {
  const { planId, returnUrl, cancelUrl } = req.body || {};
  if (!planId) return res.status(400).json({ message: 'planId is required' });

  const result = await subscriptionService.start({
    user: req.user,
    planId,
    returnUrl: returnUrl || `${req.headers.origin || ''}/subscribe/return`,
    cancelUrl: cancelUrl || `${req.headers.origin || ''}/subscribe`,
  });
  res.status(201).json({
    subscriptionId: result.subscription._id,
    approveUrl: result.approveUrl,
  });
});

/**
 * POST /api/subscriptions/:id/confirm
 *
 * The reader coming back from PayPal. The ACTIVATED webhook is the source of
 * truth, but it can lag by seconds, and a reader staring at "pending" after
 * paying will assume it failed. So we ask PayPal directly and converge — the
 * cycle grant is keyed on the cycle number, so whichever path lands first wins
 * and the other is a no-op.
 */
const confirm = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({ _id: req.params.id, user: req.user._id });
  if (!subscription) return res.status(404).json({ message: 'Subscription not found' });
  if (!subscription.paypalSubscriptionId) {
    return res.status(409).json({ message: 'This subscription was never sent to PayPal' });
  }

  const remote = await paypalService.getSubscription(subscription.paypalSubscriptionId);
  if (remote.status !== 'ACTIVE') {
    return res.status(202).json({
      subscription: publicSubscription(subscription),
      paypalStatus: remote.status,
      message: 'PayPal has not activated this subscription yet',
    });
  }

  const lastPayment = remote.billing_info?.last_payment?.amount;
  await subscriptionService.activate(subscription, {
    netUsdCents: lastPayment ? Math.round(parseFloat(lastPayment.value) * 100) : 0,
    periodStart: new Date(),
    periodEnd: remote.billing_info?.next_billing_time
      ? new Date(remote.billing_info.next_billing_time)
      : null,
  });

  res.json({ subscription: publicSubscription(subscription) });
});

/** DELETE /api/subscriptions */
const cancelMine = asyncHandler(async (req, res) => {
  const subscription = await subscriptionService.cancel({ user: req.user, reason: (req.body || {}).reason || '' });
  const copy = await settingsService.get('subscriptions.cancellationCopy');
  res.json({ subscription: publicSubscription(subscription), message: copy });
});

// ------------------------------------------------------------- admin

/** GET /api/admin/monetization/plans */
const adminListPlans = asyncHandler(async (req, res) => {
  const plans = await SubscriptionPlan.find({}).sort({ sortOrder: 1, priceUsdCents: 1 });

  // Subscriber counts per plan, so an admin can see what a price change costs
  // before they make it.
  const counts = await Subscription.aggregate([
    { $match: { status: { $in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.PAST_DUE] } } },
    { $group: { _id: '$plan', subscribers: { $sum: 1 }, mrrUsdCents: { $sum: '$cycleNetUsdCents' } } },
  ]);
  const byPlan = new Map(counts.map((row) => [String(row._id), row]));

  res.json({
    plans: plans.map((plan) => ({
      ...plan.toObject(),
      needsResync: plan.needsResync(),
      subscribers: byPlan.get(String(plan._id))?.subscribers || 0,
      mrrUsdCents: byPlan.get(String(plan._id))?.mrrUsdCents || 0,
    })),
    paypalConfigured: await paypalService.isConfigured(),
  });
});

const PLAN_FIELDS = [
  'name',
  'tier',
  'description',
  'sortOrder',
  'active',
  'priceUsdCents',
  'interval',
  'intervalCount',
  'trialDays',
  'monthlyCredits',
  'perks',
];

const applyFields = (plan, body) => {
  const changes = [];
  for (const field of PLAN_FIELDS) {
    if (body[field] === undefined) continue;
    const before = plan[field];
    if (JSON.stringify(before) === JSON.stringify(body[field])) continue;
    plan[field] = body[field];
    changes.push({ key: field, before, after: body[field] });
  }
  return changes;
};

/** POST /api/admin/monetization/plans */
const createPlan = asyncHandler(async (req, res) => {
  const plan = new SubscriptionPlan({ createdBy: req.user._id });
  applyFields(plan, req.body || {});
  if (!plan.name || !plan.tier || !plan.priceUsdCents) {
    return res.status(400).json({ message: 'name, tier and priceUsdCents are required' });
  }
  await plan.save();
  await audit(req, 'plan.create', plan._id, [{ key: 'name', before: null, after: plan.name }]);
  res.status(201).json({ plan, needsResync: plan.needsResync() });
});

/** PUT /api/admin/monetization/plans/:id */
const updatePlan = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.findById(req.params.id);
  if (!plan) return res.status(404).json({ message: 'Plan not found' });

  const changes = applyFields(plan, req.body || {});
  await plan.save();
  if (changes.length) await audit(req, 'plan.update', plan._id, changes);

  const repriced = changes.some((change) => change.key === 'priceUsdCents') && Boolean(plan.paypalPlanId);
  res.json({
    plan,
    needsResync: plan.needsResync(),
    // Said plainly, because the alternative is an admin believing they changed
    // what subscribers pay when they have not.
    warning: repriced
      ? 'PayPal cannot reprice a live plan. Existing subscribers keep the old price until they resubscribe. Sync to create a new plan for new subscribers.'
      : undefined,
  });
});

/** POST /api/admin/monetization/plans/:id/sync */
const syncPlan = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.findById(req.params.id);
  if (!plan) return res.status(404).json({ message: 'Plan not found' });
  if (!(await paypalService.isConfigured())) {
    return res.status(503).json({ message: 'PayPal is not configured' });
  }

  const result = await subscriptionService.syncPlan(plan);
  await audit(req, 'plan.sync', plan._id, [{ key: 'paypalPlanId', before: null, after: plan.paypalPlanId }], result.notes.join(' '));
  res.json({ plan: result.plan, notes: result.notes, needsResync: result.plan.needsResync() });
});

/** DELETE /api/admin/monetization/plans/:id */
const deletePlan = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.findById(req.params.id);
  if (!plan) return res.status(404).json({ message: 'Plan not found' });

  // Deleting a plan that people are paying for would strand their entitlement,
  // since the snapshot is what grants perks but the plan is what renews.
  const live = await Subscription.countDocuments({
    plan: plan._id,
    status: { $in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.PAST_DUE] },
  });
  if (live > 0) {
    return res.status(409).json({
      message: `${live} subscriber${live === 1 ? '' : 's'} are on this plan. Deactivate it instead — it will disappear from the store but keep billing them until they cancel.`,
      subscribers: live,
    });
  }

  if (plan.paypalPlanId) await paypalService.deactivateBillingPlan(plan.paypalPlanId).catch(() => {});
  await plan.softDelete();
  await audit(req, 'plan.delete', plan._id, [{ key: 'deleted', before: false, after: true }]);
  res.json({ deleted: true });
});

/** GET /api/admin/monetization/subscriptions */
const adminListSubscriptions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.plan) filter.plan = req.query.plan;

  const [rows, total] = await Promise.all([
    Subscription.find(filter)
      .populate('user', 'username email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Subscription.countDocuments(filter),
  ]);

  res.json({ subscriptions: rows, page, limit, total, pages: Math.ceil(total / limit) });
});

/**
 * GET /api/admin/monetization/subscriptions/summary
 *
 * MRR is normalised to a monthly figure so annual and monthly plans can be
 * added together without overstating the annual ones twelvefold.
 */
const subscriptionSummary = asyncHandler(async (req, res) => {
  const live = await Subscription.find({
    status: { $in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.PAST_DUE] },
  }).select('planSnapshot status cancelAtPeriodEnd lifetimeUsdCents');

  let mrrUsdCents = 0;
  const byTier = new Map();

  for (const row of live) {
    const snap = row.planSnapshot || {};
    const months = snap.interval === 'year' ? 12 : 1;
    const monthly = Math.round((snap.priceUsdCents || 0) / months);
    mrrUsdCents += monthly;

    const tier = snap.tier || 'unknown';
    const entry = byTier.get(tier) || { tier, subscribers: 0, mrrUsdCents: 0 };
    entry.subscribers += 1;
    entry.mrrUsdCents += monthly;
    byTier.set(tier, entry);
  }

  const [cancelling, pastDue, lifetime] = await Promise.all([
    Subscription.countDocuments({ cancelAtPeriodEnd: true, status: SUBSCRIPTION_STATUS.ACTIVE }),
    Subscription.countDocuments({ status: SUBSCRIPTION_STATUS.PAST_DUE }),
    Subscription.aggregate([{ $group: { _id: null, total: { $sum: '$lifetimeUsdCents' } } }]),
  ]);

  res.json({
    subscribers: live.length,
    mrrUsdCents,
    arrUsdCents: mrrUsdCents * 12,
    byTier: [...byTier.values()].sort((a, b) => b.mrrUsdCents - a.mrrUsdCents),
    cancelling,
    pastDue,
    lifetimeUsdCents: lifetime[0]?.total || 0,
  });
});

module.exports = {
  listPlans,
  mySubscription,
  subscribe,
  confirm,
  cancelMine,
  adminListPlans,
  createPlan,
  updatePlan,
  syncPlan,
  deletePlan,
  adminListSubscriptions,
  subscriptionSummary,
};
