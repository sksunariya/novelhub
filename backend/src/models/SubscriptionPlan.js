const mongoose = require('mongoose');
const softDelete = require('./plugins/softDelete');

// A subscription tier, mirrored into PayPal as a Catalog Product plus a
// Billing Plan.
//
// The important constraint: **an active PayPal billing plan cannot be
// repriced.** Changing the price means creating a new plan and migrating
// subscribers. `paypalPlanId` is therefore treated as belonging to a specific
// price, and `pricedAt` records what it was created for — so a mismatch is
// detectable rather than silently charging the old amount.
const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    tier: { type: String, required: true, trim: true, maxlength: 40 },
    description: { type: String, default: '', maxlength: 500 },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },

    priceUsdCents: { type: Number, required: true, min: 1 },
    interval: { type: String, enum: ['month', 'year'], default: 'month' },
    intervalCount: { type: Number, default: 1, min: 1 },
    trialDays: { type: Number, default: 0, min: 0 },

    // Credits granted at the start of every paid cycle.
    monthlyCredits: { type: Number, default: 0, min: 0 },

    perks: {
      freeUnlocks: {
        type: String,
        enum: ['none', 'all', 'selected_novels', 'up_to_n_per_cycle'],
        default: 'none',
      },
      freeUnlockNovels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Novel' }],
      freeUnlockLimit: { type: Number, default: 0, min: 0 },
      packDiscountPct: { type: Number, default: 0, min: 0, max: 100 },
      chapterDiscountPct: { type: Number, default: 0, min: 0, max: 100 },
      earlyAccessHours: { type: Number, default: 0, min: 0 },
      adFree: { type: Boolean, default: false },
      profileBadge: { type: String, default: '' },
      badgeColor: { type: String, default: '' },
    },

    paypalProductId: { type: String, default: '' },
    paypalPlanId: { type: String, default: '' },
    paypalSyncedAt: { type: Date, default: null },
    // The price the live PayPal plan was created for. If this drifts from
    // priceUsdCents the plan needs replacing, not editing.
    pricedAtUsdCents: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

subscriptionPlanSchema.index({ active: 1, sortOrder: 1 });
subscriptionPlanSchema.index({ tier: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
subscriptionPlanSchema.index({ paypalPlanId: 1 }, { sparse: true });

/** Does the live PayPal plan still match what an admin has configured? */
subscriptionPlanSchema.methods.needsResync = function needsResync() {
  if (!this.paypalPlanId) return true;
  return this.pricedAtUsdCents !== this.priceUsdCents;
};

subscriptionPlanSchema.plugin(softDelete);

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
