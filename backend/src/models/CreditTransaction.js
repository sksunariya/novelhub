const mongoose = require('mongoose');
const { CREDIT_TRANSACTION_TYPES, CREDIT_REF_TYPES } = require('../config/constants');

// Append-only ledger. The source of truth for every credit movement.
//
// No softDelete plugin and no updates after creation: a financial record that
// can be edited is not a financial record. Wallet.balance is a cache of this.
const creditTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: Object.values(CREDIT_TRANSACTION_TYPES), required: true },

    amount: { type: Number, required: true }, // SIGNED: +500 credit, -10 debit
    balanceAfter: { type: Number, required: true },

    // Cash recognized by this movement, in micro-USD. Positive on a spend
    // (revenue recognized), negative on a refund (revenue reversed).
    attributedUsdMicros: { type: Number, default: 0 },
    bucketBreakdown: [
      {
        _id: false,
        bucket: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditBucket' },
        credits: Number,
        costMicros: Number,
      },
    ],

    reason: { type: String, default: '' }, // admin-facing
    description: { type: String, default: '' }, // user-facing

    refType: { type: String, enum: [...Object.values(CREDIT_REF_TYPES), null], default: null },
    refId: { type: mongoose.Schema.Types.ObjectId },

    // Denormalized so revenue rollups never need to join back through chapters.
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel' },
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter' },

    // The double-credit guard. Every credit-granting path supplies one, and the
    // unique index is what makes the client-capture and webhook paths converge
    // harmlessly rather than paying out twice.
    idempotencyKey: { type: String },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A partial index, not a sparse one. `sparse` only skips documents where the
// field is absent — an explicit `idempotencyKey: null` is still indexed, so the
// second un-keyed transaction would collide with the first on a null duplicate.
// Matching on $type: 'string' indexes only real keys. Same pattern as the
// googleId index on User.
creditTransactionSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
creditTransactionSchema.index({ user: 1, createdAt: -1 });
creditTransactionSchema.index({ type: 1, createdAt: -1 });
creditTransactionSchema.index({ novel: 1, createdAt: -1 });
creditTransactionSchema.index({ chapter: 1, createdAt: -1 });
creditTransactionSchema.index({ refType: 1, refId: 1 });

const blockMutation = function blockMutation(next) {
  next(Object.assign(new Error('Ledger entries are immutable'), { status: 400 }));
};
creditTransactionSchema.pre('updateOne', blockMutation);
creditTransactionSchema.pre('updateMany', blockMutation);
creditTransactionSchema.pre('findOneAndUpdate', blockMutation);

module.exports = mongoose.model('CreditTransaction', creditTransactionSchema);
