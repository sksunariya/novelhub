const mongoose = require('mongoose');
const { PRICING_RULE_SCOPES, PRICING_RULE_MODES, NOVEL_STATUS } = require('../config/constants');

// Dynamic pricing. Static per-chapter prices do not scale to a catalogue; rules do.
//
// Expresses without a code change: "chapters 1-20 free everywhere", "anything
// older than 90 days at half price", "double price for the first 48 hours",
// "Novel X free this weekend", "over 5000 words costs 15 not 10".
const pricingRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    active: { type: Boolean, default: true },
    priority: { type: Number, default: 0 }, // highest wins

    scope: { type: String, enum: Object.values(PRICING_RULE_SCOPES), default: PRICING_RULE_SCOPES.GLOBAL },
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel' },
    genres: [{ type: String, trim: true }],
    novelStatus: { type: String, enum: [...Object.values(NOVEL_STATUS), null], default: null },

    conditions: {
      chapterNumberFrom: { type: Number, min: 1 },
      chapterNumberTo: { type: Number, min: 1 },
      chapterAgeDaysFrom: { type: Number, min: 0 },
      chapterAgeDaysTo: { type: Number, min: 0 },
      wordCountFrom: { type: Number, min: 0 },
      wordCountTo: { type: Number, min: 0 },
    },

    action: {
      mode: { type: String, enum: Object.values(PRICING_RULE_MODES), default: PRICING_RULE_MODES.SET },
      priceCredits: { type: Number, min: 0, default: 0 },
      multiplier: { type: Number, min: 0, default: 1 },
      delta: { type: Number, default: 0 },
    },

    // Scheduled sales without anyone staying up.
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

pricingRuleSchema.index({ active: 1, priority: -1 });
pricingRuleSchema.index({ scope: 1, novel: 1, active: 1 });

module.exports = mongoose.model('PricingRule', pricingRuleSchema);
