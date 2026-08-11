const mongoose = require('mongoose');

// A user's credit balance.
//
// Deliberately its own collection rather than a field on User: the balance is
// the hottest write path in the system and must not contend with profile saves
// or bloat the User documents that are populated across the app.
//
// `balance` is a denormalized cache of the ledger. CreditTransaction is the
// source of truth, and the reconciliation job can always rebuild this from it.
const walletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balance: { type: Number, default: 0 },

    lifetimePurchased: { type: Number, default: 0 },
    lifetimeGranted: { type: Number, default: 0 },
    lifetimeSpent: { type: Number, default: 0 },
    lifetimeExpired: { type: Number, default: 0 },
    lifetimeRefunded: { type: Number, default: 0 },
    // Real cash, for whale analysis and audience targeting on spend.
    lifetimeSpendUsdCents: { type: Number, default: 0 },

    autoUnlock: {
      enabled: { type: Boolean, default: false },
      maxPriceCredits: { type: Number, default: 0 },
      novels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Novel' }],
    },

    flags: {
      negative: { type: Boolean, default: false },
      disputeFrozen: { type: Boolean, default: false },
      refundBlocked: { type: Boolean, default: false },
    },

    lowBalanceNotifiedAt: { type: Date },
    lastTransactionAt: { type: Date },
  },
  { timestamps: true }
);

walletSchema.index({ balance: -1 });
walletSchema.index({ lifetimeSpendUsdCents: -1 });

/**
 * Wallets are provisioned lazily as well as at signup, so that users created
 * before monetization (or by a path that forgot to provision) still work.
 */
walletSchema.statics.getOrCreate = async function getOrCreate(userId) {
  const existing = await this.findOne({ user: userId });
  if (existing) return existing;
  try {
    return await this.create({ user: userId });
  } catch (error) {
    if (error.code === 11000) return this.findOne({ user: userId });
    throw error;
  }
};

module.exports = mongoose.model('Wallet', walletSchema);
