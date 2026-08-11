const mongoose = require('mongoose');
const { ORDER_STATUS } = require('../config/constants');

// Declared as its own schema because the field is called `type`, which is also
// Mongoose's typeKey. Written inline as `{ at, type: String, source, data }`,
// Mongoose reads the whole object as a type declaration and silently collapses
// the array to [String] — every order.log() then throws a CastError.
const orderEventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    // Nested deliberately: `type: String` here would be ambiguous.
    type: { type: String },
    source: { type: String, enum: ['client', 'webhook', 'admin', 'cron'] },
    data: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

// One purchase attempt. Immutable financial record — no softDelete plugin.
const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    pack: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditPack' },
    // Frozen copy: the pack may be repriced or deleted later, and a receipt
    // must always show what was actually bought.
    packSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },

    credits: { type: Number, required: true },
    bonusCredits: { type: Number, default: 0 },
    totalCredits: { type: Number, required: true },

    // Every figure locked at creation and re-verified at capture.
    baseUsdCents: { type: Number, required: true },
    discountUsdCents: { type: Number, default: 0 },
    netUsdCents: { type: Number, required: true },
    taxUsdCents: { type: Number, default: 0 },
    taxRatePct: { type: Number, default: 0 },
    taxCountry: { type: String, default: '' },
    paypalFeeUsdCents: { type: Number, default: 0 },
    netAfterFeeUsdCents: { type: Number, default: 0 },

    coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
    couponCode: { type: String, default: '' },

    chargeCurrency: { type: String, required: true, uppercase: true },
    chargeAmountMinor: { type: Number, required: true },
    chargeDecimals: { type: Number, default: 2 },
    fxRateUsed: { type: Number, default: 1 },
    fxMarkupPct: { type: Number, default: 0 },
    fxRateAt: { type: Date },
    // True when the local figure shown to the buyer was an estimate because
    // PayPal cannot settle in their currency.
    isEstimateDisplay: { type: Boolean, default: false },
    displayCurrency: { type: String, default: '' },
    displayAmountMinor: { type: Number, default: 0 },

    provider: { type: String, default: 'paypal' },
    paypalOrderId: { type: String },
    paypalCaptureId: { type: String },
    paypalPayerId: { type: String, default: '' },
    paypalPayerEmail: { type: String, default: '' },

    status: { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.CREATED },
    // The double-credit guard: set once, checked by both the client capture
    // path and the webhook path.
    creditedAt: { type: Date, default: null },
    refundedUsdCents: { type: Number, default: 0 },
    creditsClawedBack: { type: Number, default: 0 },

    quoteExpiresAt: { type: Date },
    ipAddress: { type: String, default: '' },
    ipCountry: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    failureReason: { type: String, default: '' },

    events: { type: [orderEventSchema], default: [] },
  },
  { timestamps: true }
);

// Partial rather than sparse, for the same reason as the ledger's idempotency
// index: an explicit null would otherwise collide across orders.
orderSchema.index(
  { paypalOrderId: 1 },
  { unique: true, partialFilterExpression: { paypalOrderId: { $type: 'string' } } }
);
orderSchema.index(
  { paypalCaptureId: 1 },
  { unique: true, partialFilterExpression: { paypalCaptureId: { $type: 'string' } } }
);
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, quoteExpiresAt: 1 });
orderSchema.index({ createdAt: -1 });

orderSchema.methods.log = function log(type, source, data = {}) {
  this.events.push({ type, source, data, at: new Date() });
};

module.exports = mongoose.model('Order', orderSchema);
