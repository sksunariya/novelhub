const mongoose = require('mongoose');

// A reader hit a wall and was shown it.
//
// readChapter returns its 403 before registerView is ever called — correct for
// view counts, but it means a reader who hits the paywall and leaves is
// otherwise completely invisible. This is the top of the conversion funnel:
// without it, "64% of readers stop at the paywall" is not a computable claim.
const gateImpressionSchema = new mongoose.Schema(
  {
    readerKey: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    chapterNumber: { type: Number, required: true },

    reason: { type: String, required: true }, // credits | login | engagement | early_access
    priceCredits: { type: Number, default: 0 },
    balanceAtTime: { type: Number, default: 0 },
    couldAfford: { type: Boolean, default: false },

    // Bucketed to the UTC day so a reader refreshing a locked page twenty times
    // counts once. Without this the funnel denominator is meaningless.
    day: { type: String, required: true }, // YYYY-MM-DD
    at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

gateImpressionSchema.index({ readerKey: 1, chapter: 1, day: 1 }, { unique: true });
gateImpressionSchema.index({ novel: 1, chapterNumber: 1 });
gateImpressionSchema.index({ chapter: 1, at: -1 });
gateImpressionSchema.index({ at: -1 });

module.exports = mongoose.model('GateImpression', gateImpressionSchema);
