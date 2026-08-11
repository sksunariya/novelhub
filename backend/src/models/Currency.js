const mongoose = require('mongoose');
const {
  PAYPAL_CURRENCIES,
  ZERO_DECIMAL_CURRENCIES,
  SETTLEMENT_MODES,
  ROUNDING_MODES,
} = require('../config/constants');

const currencySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3, unique: true },
    name: { type: String, default: '' },
    symbol: { type: String, default: '' },
    symbolPosition: { type: String, enum: ['before', 'after'], default: 'before' },
    enabled: { type: Boolean, default: false },

    decimals: { type: Number, default: 2, min: 0, max: 4 },

    // Whether PayPal will settle in this currency. Derived from a constant and
    // recomputed on save — an admin must not be able to claim support PayPal
    // does not have, because the resulting orders would just be rejected.
    paypalSupported: { type: Boolean, default: false },
    settlementMode: {
      type: String,
      enum: Object.values(SETTLEMENT_MODES),
      default: SETTLEMENT_MODES.USD,
    },

    rateSource: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    autoRate: { type: Number, default: 0 }, // units per 1 USD
    manualRate: { type: Number, default: 0 },
    markupPct: { type: Number, default: 0, min: 0, max: 50 },

    rounding: { type: String, enum: Object.values(ROUNDING_MODES), default: ROUNDING_MODES.CHARM_99 },
    minChargeMinor: { type: Number, default: 0, min: 0 },

    lastRateAt: { type: Date },
    lastRateSource: { type: String, default: '' },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

currencySchema.index({ enabled: 1 });

const CHARM = [ROUNDING_MODES.CHARM_99, ROUNDING_MODES.CHARM_95];

/**
 * Correct a set of currency fields against what PayPal can actually do.
 *
 * Pure, so it can be applied to a document, to an update payload, or checked
 * directly. These are correctness guards, not preferences: an admin who sets
 * local settlement on an unsupported currency would otherwise generate orders
 * PayPal rejects, and a decimal JPY amount is an outright API error.
 */
currencySchema.statics.deriveCapabilities = function deriveCapabilities(input = {}) {
  const out = { ...input };
  if (out.code) out.code = String(out.code).toUpperCase();

  out.paypalSupported = PAYPAL_CURRENCIES.includes(out.code);
  if (ZERO_DECIMAL_CURRENCIES.includes(out.code)) out.decimals = 0;
  if (!out.paypalSupported) out.settlementMode = SETTLEMENT_MODES.USD;
  if (out.decimals === 0 && CHARM.includes(out.rounding)) out.rounding = ROUNDING_MODES.NEAREST_INT;

  return out;
};

currencySchema.methods.applyCapabilities = function applyCapabilities() {
  const derived = this.constructor.deriveCapabilities({
    code: this.code,
    decimals: this.decimals,
    settlementMode: this.settlementMode,
    rounding: this.rounding,
  });
  this.code = derived.code;
  this.paypalSupported = derived.paypalSupported;
  this.decimals = derived.decimals;
  this.settlementMode = derived.settlementMode;
  this.rounding = derived.rounding;
  return this;
};

// pre('validate') covers save(); validateSync() deliberately skips middleware,
// so anything relying on these guards must go through save() or the static.
currencySchema.pre('validate', function derive() {
  this.applyCapabilities();
});

// An update that bypasses the document entirely would otherwise skip every
// guard above and persist a setting PayPal cannot honour.
currencySchema.pre(['findOneAndUpdate', 'updateOne'], function sanitizeUpdate(next) {
  const update = this.getUpdate();
  if (!update) return next();
  const target = update.$set || update;
  const code = target.code || (this.getFilter() || {}).code;
  if (!code) return next();

  // `this` is the Query here, so `this.constructor` is Query — the model is
  // reached through `this.model`.
  const derived = this.model.deriveCapabilities({
    code,
    decimals: target.decimals,
    settlementMode: target.settlementMode,
    rounding: target.rounding,
  });
  target.paypalSupported = derived.paypalSupported;
  if (target.settlementMode !== undefined) target.settlementMode = derived.settlementMode;
  if (target.decimals !== undefined) target.decimals = derived.decimals;
  if (target.rounding !== undefined) target.rounding = derived.rounding;
  return next();
});

/** Effective units-per-USD including the configured markup. */
currencySchema.methods.effectiveRate = function effectiveRate() {
  const base = this.rateSource === 'manual' ? this.manualRate : this.autoRate;
  return base * (1 + (this.markupPct || 0) / 100);
};

currencySchema.methods.isStale = function isStale(staleAfterHours) {
  if (this.code === 'USD' || this.rateSource === 'manual') return false;
  if (!this.lastRateAt) return true;
  return Date.now() - this.lastRateAt.getTime() > staleAfterHours * 60 * 60 * 1000;
};

module.exports = mongoose.model('Currency', currencySchema);
