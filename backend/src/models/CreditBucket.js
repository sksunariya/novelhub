const mongoose = require('mongoose');
const { CREDIT_SOURCES } = require('../config/constants');

// A tranche of credits issued in one event, carrying the cash that bought it.
//
// This is what makes per-chapter revenue honest. A user paying $9.99 for
// "1000 credits + 200 bonus" did not buy 1200 credits at 1 cent each — each
// credit is worth 8325 micro-USD, and a granted credit is worth zero. Spending
// draws cost from these tranches so a chapter's revenue is the actual money
// behind the credits spent on it.
//
// Financial record: never soft-deleted, never rewritten except by the atomic
// decrements below.
const creditBucketSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    source: { type: String, enum: Object.values(CREDIT_SOURCES), required: true },
    sourceRef: { type: mongoose.Schema.Types.ObjectId },

    amount: { type: Number, required: true, min: 0 }, // credits originally issued
    remaining: { type: Number, required: true, min: 0 },

    // Cash behind this tranche, in micro-USD. Zero for grants and referrals.
    totalCostMicros: { type: Number, default: 0, min: 0 },
    remainingCostMicros: { type: Number, default: 0, min: 0 },

    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Consumption scan: find this user's live tranches in the configured order.
creditBucketSchema.index({ user: 1, remaining: 1, expiresAt: 1, createdAt: 1 });
// Expiry sweeper.
creditBucketSchema.index({ expiresAt: 1, remaining: 1 });
creditBucketSchema.index({ sourceRef: 1 });

/**
 * Withdraw `credits` from a loaded bucket and return the cash that goes with
 * them, proportional to what is left.
 *
 * The last withdrawal from a tranche sweeps the remainder exactly, so repeated
 * integer division can never leave orphaned micros or over-attribute. This is
 * what keeps the accounting identity in docs/monetization-architecture.md §6.4
 * exact rather than approximate.
 */
creditBucketSchema.statics.costFor = function costFor(bucket, credits) {
  if (credits >= bucket.remaining) return bucket.remainingCostMicros;
  if (bucket.remaining <= 0) return 0;
  return Math.floor((bucket.remainingCostMicros * credits) / bucket.remaining);
};

module.exports = mongoose.model('CreditBucket', creditBucketSchema);
