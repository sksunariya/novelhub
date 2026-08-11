const mongoose = require('mongoose');
const softDelete = require('./plugins/softDelete');

// A purchasable bundle of credits.
//
// There is exactly one price — USD cents — and every other currency is derived
// from it. That is what keeps a 25-currency catalogue maintainable: an admin
// never types a price in yen.
const creditPackSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true },
    description: { type: String, default: '', maxlength: 500 },

    credits: { type: Number, required: true, min: 1 },
    bonusCredits: { type: Number, default: 0, min: 0 },

    priceUsdCents: { type: Number, required: true, min: 1 },
    compareAtUsdCents: { type: Number, default: 0, min: 0 }, // strikethrough anchor

    badge: { type: String, default: '', maxlength: 40 },
    badgeColor: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },

    visibility: {
      newUsersOnly: { type: Boolean, default: false },
      firstPurchaseOnly: { type: Boolean, default: false },
      minAccountAgeDays: { type: Number, default: 0, min: 0 },
      allowedCountries: [{ type: String, uppercase: true }],
      blockedCountries: [{ type: String, uppercase: true }],
      subscribersOnly: { type: Boolean, default: false },
    },

    limits: {
      perUserTotal: { type: Number, default: 0, min: 0 }, // 0 = unlimited
      perUserPerDay: { type: Number, default: 0, min: 0 },
      globalStock: { type: Number, default: 0, min: 0 },
      globalSold: { type: Number, default: 0, min: 0 },
    },

    availableFrom: { type: Date, default: null },
    availableUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

creditPackSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
creditPackSchema.index({ active: 1, sortOrder: 1 });

creditPackSchema.virtual('totalCredits').get(function totalCredits() {
  return this.credits + (this.bonusCredits || 0);
});

/** Is this pack on sale right now, ignoring per-user rules? */
creditPackSchema.methods.isAvailable = function isAvailable(now = new Date()) {
  if (!this.active) return false;
  if (this.availableFrom && now < this.availableFrom) return false;
  if (this.availableUntil && now > this.availableUntil) return false;
  if (this.limits.globalStock > 0 && this.limits.globalSold >= this.limits.globalStock) return false;
  return true;
};

creditPackSchema.methods.allowsCountry = function allowsCountry(country) {
  if (!country) return true;
  const allowed = this.visibility.allowedCountries || [];
  const blocked = this.visibility.blockedCountries || [];
  if (blocked.includes(country)) return false;
  if (allowed.length && !allowed.includes(country)) return false;
  return true;
};

creditPackSchema.plugin(softDelete);
creditPackSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('CreditPack', creditPackSchema);
