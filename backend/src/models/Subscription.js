const mongoose = require('mongoose');
const { SUBSCRIPTION_STATUS } = require('../config/constants');

// One reader's subscription. Financial record — no soft delete.
const subscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    // Frozen copy: the plan may be replaced when its price changes, and a
    // subscriber keeps the terms they signed up under until they migrate.
    planSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },

    paypalSubscriptionId: { type: String },
    status: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.APPROVAL_PENDING,
    },

    currentPeriodStart: { type: Date },
    currentPeriodEnd: { type: Date },
    nextBillingAt: { type: Date },
    cyclesCompleted: { type: Number, default: 0 },
    // Guards the cycle credit grant: a repeated PAYMENT.SALE.COMPLETED for the
    // same cycle must not pay twice.
    lastGrantedCycle: { type: Number, default: 0 },

    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: { type: Date },
    cancelReason: { type: String, default: '' },
    // Perks continue until this moment while PayPal retries a failed payment.
    gracePeriodEndsAt: { type: Date, default: null },

    freeUnlocksUsedThisCycle: { type: Number, default: 0 },
    // Net cash for the current cycle, used to attribute subscription revenue
    // across the chapters a subscriber actually read.
    cycleNetUsdCents: { type: Number, default: 0 },
    lifetimeUsdCents: { type: Number, default: 0 },
    // Cycles whose cash has already been split across chapters read. Guards
    // `attributeCycle` against double-posting revenue on a webhook replay.
    attributedCycles: { type: [Number], default: [] },
  },
  { timestamps: true }
);

subscriptionSchema.index({ paypalSubscriptionId: 1 }, { unique: true, partialFilterExpression: { paypalSubscriptionId: { $type: 'string' } } });
// A reader can hold at most one *live* subscription.
//
// Deliberately excludes approval_pending. Including it looked tidier but meant
// a reader who opened checkout and closed the PayPal tab was permanently
// blocked from subscribing — the abandoned row held the slot forever. Pending
// rows are cheap; only billing needs to be unique, and `subscriptionService`
// cancels a redundant approval if two somehow activate.
subscriptionSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['active', 'past_due'] } } }
);
subscriptionSchema.index({ user: 1, status: 1, createdAt: -1 });
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });

/** Are the perks live right now, including any grace window? */
subscriptionSchema.methods.isEntitled = function isEntitled(now = new Date()) {
  if (this.status === SUBSCRIPTION_STATUS.ACTIVE) return true;
  if (this.status !== SUBSCRIPTION_STATUS.PAST_DUE) return false;
  // Past due keeps access until the grace period expires, so a card that fails
  // on renewal does not lock someone out mid-chapter.
  return Boolean(this.gracePeriodEndsAt && this.gracePeriodEndsAt > now);
};

subscriptionSchema.methods.perks = function perkList() {
  return (this.planSnapshot && this.planSnapshot.perks) || {};
};

/**
 * Does this subscription read this novel with no accounting at all?
 *
 * Only the unmetered tiers qualify. A metered allowance deliberately does NOT
 * answer yes here: if it did, the chapter would resolve as free on every read
 * and the allowance would never actually be spent, making the limit fiction.
 */
subscriptionSchema.methods.coversNovel = function coversNovel(novelId) {
  const perks = this.perks();
  if (perks.freeUnlocks === 'all') return true;
  if (perks.freeUnlocks === 'selected_novels') {
    return (perks.freeUnlockNovels || []).some((id) => String(id) === String(novelId));
  }
  return false;
};

/** Metered allowance: how many free unlocks are left in this cycle. */
subscriptionSchema.methods.freeUnlocksRemaining = function freeUnlocksRemaining() {
  const perks = this.perks();
  if (perks.freeUnlocks !== 'up_to_n_per_cycle') return 0;
  return Math.max(0, (perks.freeUnlockLimit || 0) - (this.freeUnlocksUsedThisCycle || 0));
};

module.exports = mongoose.model('Subscription', subscriptionSchema);
