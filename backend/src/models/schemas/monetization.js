const mongoose = require('mongoose');

// Monetization configuration, shared by the novel (per-novel override) and
// available for future site-wide defaults. Mirrors the existing
// buildReadingGateSchema factory in ./readingGate.js — `extraFields` lets the
// novel copy add its own `override` switch without duplicating the field list.
const buildMonetizationSchema = (extraFields = {}) =>
  new mongoose.Schema(
    {
      monetized: { type: Boolean, default: true },
      // First N chapters are always free.
      freeChapterCount: { type: Number, default: 0, min: 0 },
      defaultChapterPriceCredits: { type: Number, default: 0, min: 0 },
      // Paid chapters fall free this many days after publication. 0 = never.
      freeAfterDays: { type: Number, default: 0, min: 0 },
      bulkDiscountTiers: [
        {
          _id: false,
          minChapters: { type: Number, min: 1 },
          discountPct: { type: Number, min: 0, max: 100 },
        },
      ],
      subscriptionIncluded: { type: Boolean, default: true },
      accessMode: { type: String, enum: ['inherit', 'permanent', 'rental'], default: 'inherit' },
      rentalHours: { type: Number, default: 0, min: 0 },
      // Commercial terms. `select: false` keeps them out of every query by
      // default, including the public novel endpoints that return raw
      // documents — an author's negotiated percentage must not be readable by
      // anyone who can load a novel page. Admin reads opt in with
      // .select('+monetization.revenueShare.sharePct').
      revenueShare: {
        enabled: { type: Boolean, default: false, select: false },
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'Author', default: null, select: false },
        sharePct: { type: Number, default: 0, min: 0, max: 100, select: false },
      },
      ...extraFields,
    },
    { _id: false }
  );

module.exports = { buildMonetizationSchema };
