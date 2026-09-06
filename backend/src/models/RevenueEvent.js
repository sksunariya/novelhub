const mongoose = require('mongoose');
const { REVENUE_EVENT_KINDS } = require('../config/constants');

// Append-only per-chapter revenue ledger.
//
// Why this exists rather than rebuilding revenue from ChapterAccess: that
// collection is an ENTITLEMENT record, not a financial one. It is hard-deleted
// when a rental lapses, it never exists for an unmetered subscription cycle,
// and a row can fail to insert while cash was still taken. Rebuilding revenue
// from it therefore silently erased money that had genuinely been earned — the
// numbers would look stable for three days and then quietly drop.
//
// Every event that moves cash onto or off a chapter writes one row here, and
// nothing ever deletes or rewrites one. Rollups are a projection of this.
//
// Signed: an unlock is positive, a refund reversal is negative. Summing the
// collection over any window gives net recognized revenue for that window with
// no special cases.
const revenueEventSchema = new mongoose.Schema(
  {
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    chapterNumber: { type: Number, default: 0 },

    // Denormalized at event time so history survives a novel being reassigned,
    // renamed or soft-deleted. Resolving the author at report time is how
    // earnings quietly moved to "(unattributed)" when a novel went to trash.
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'Author', default: null },
    authorName: { type: String, default: '' },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    kind: { type: String, enum: Object.values(REVENUE_EVENT_KINDS), required: true },
    source: { type: String, default: '' }, // ACCESS_SOURCES value where relevant

    creditsSpent: { type: Number, default: 0 },
    // Signed cash, micro-USD. Negative on a reversal.
    attributedUsdMicros: { type: Number, default: 0 },

    // Credits x the rate IN EFFECT WHEN THIS HAPPENED. Frozen here precisely so
    // a later change to credits.perUsd cannot retroactively restate history.
    faceValueUsdMicros: { type: Number, default: 0 },
    creditsPerUsdAtEvent: { type: Number, default: 0 },

    // Credits spent here that carried no cash (granted / promotional).
    grantFundedCredits: { type: Number, default: 0 },

    transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditTransaction' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },

    // The real-world instant. Day bucketing for a configured reporting
    // timezone is derived from this, so a tz change needs no migration.
    occurredAt: { type: Date, required: true, default: Date.now },
    // UTC day key, denormalized for the rollup match and its index.
    day: { type: String, required: true },

    idempotencyKey: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Same partial-index pattern as CreditTransaction: `sparse` would still index
// an explicit null and collide every un-keyed row against the first.
revenueEventSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
revenueEventSchema.index({ day: 1, chapter: 1 });
revenueEventSchema.index({ novel: 1, occurredAt: -1 });
revenueEventSchema.index({ chapter: 1, occurredAt: -1 });
// Purchase-epoch lookup on the unlock path: how many times has this reader
// already bought this chapter.
revenueEventSchema.index({ user: 1, chapter: 1, kind: 1 });
revenueEventSchema.index({ author: 1, occurredAt: -1 });
revenueEventSchema.index({ occurredAt: -1 });
revenueEventSchema.index({ transaction: 1 });
revenueEventSchema.index({ order: 1 });

const blockMutation = function blockMutation(next) {
  next(Object.assign(new Error('Revenue events are immutable'), { status: 400 }));
};
revenueEventSchema.pre('updateOne', blockMutation);
revenueEventSchema.pre('updateMany', blockMutation);
revenueEventSchema.pre('findOneAndUpdate', blockMutation);

module.exports = mongoose.model('RevenueEvent', revenueEventSchema);
