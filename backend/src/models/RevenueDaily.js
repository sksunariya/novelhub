const mongoose = require('mongoose');

// Platform-wide daily figures, one row per day per settlement currency.
//
// Cash comes from Order (what actually arrived), not from credit spending —
// those are different events and conflating them is how a credit economy ends
// up reporting revenue it never received.
const revenueDailySchema = new mongoose.Schema(
  {
    day: { type: String, required: true }, // YYYY-MM-DD, UTC
    currency: { type: String, required: true, uppercase: true },

    orders: { type: Number, default: 0 },
    capturedOrders: { type: Number, default: 0 },
    failedOrders: { type: Number, default: 0 },
    newPayers: { type: Number, default: 0 },

    grossUsdCents: { type: Number, default: 0 },
    discountUsdCents: { type: Number, default: 0 },
    taxUsdCents: { type: Number, default: 0 },
    feeUsdCents: { type: Number, default: 0 },
    netUsdCents: { type: Number, default: 0 },
    refundUsdCents: { type: Number, default: 0 },

    creditsIssued: { type: Number, default: 0 },
    creditsGranted: { type: Number, default: 0 },
    creditsSpent: { type: Number, default: 0 },
    creditsExpired: { type: Number, default: 0 },

    // Recognized: cash earned by delivering content that day.
    // Deferred: the running balance of cash taken but not yet earned. It is a
    // liability, and a generous grant campaign does not increase it — only
    // real purchases do.
    recognizedUsdMicros: { type: Number, default: 0 },
    deferredUsdMicrosEnd: { type: Number, default: 0 },
  },
  { timestamps: true }
);

revenueDailySchema.index({ day: 1, currency: 1 }, { unique: true });
revenueDailySchema.index({ day: -1 });

module.exports = mongoose.model('RevenueDaily', revenueDailySchema);
