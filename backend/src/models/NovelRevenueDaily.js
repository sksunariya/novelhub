const mongoose = require('mongoose');

// Per-novel daily rollup, built from ChapterStatsDaily.
//
// Exists so the novel leaderboard and the author earnings view read one small
// pre-aggregated collection instead of scanning every ChapterAccess row. This
// is the difference between an admin dashboard that stays fast and one that
// times out once there are a hundred thousand unlocks.
const novelRevenueDailySchema = new mongoose.Schema(
  {
    day: { type: String, required: true }, // YYYY-MM-DD, UTC
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    // Denormalized so an earnings report can group by author without joining
    // every novel — and so history survives a novel changing hands.
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'Author', default: null },
    authorName: { type: String, default: '' },

    readers: { type: Number, default: 0 },
    reads: { type: Number, default: 0 },
    gateImpressions: { type: Number, default: 0 },
    unlocks: { type: Number, default: 0 },
    uniqueBuyers: { type: Number, default: 0 },
    creditsEarned: { type: Number, default: 0 },
    attributedUsdMicros: { type: Number, default: 0 },
    faceValueUsdMicros: { type: Number, default: 0 },
    grantFundedCredits: { type: Number, default: 0 },
    refundedUsdMicros: { type: Number, default: 0 },
    chaptersWithActivity: { type: Number, default: 0 },
  },
  { timestamps: true }
);

novelRevenueDailySchema.index({ day: 1, novel: 1 }, { unique: true });
novelRevenueDailySchema.index({ novel: 1, day: -1 });
novelRevenueDailySchema.index({ author: 1, day: -1 });
novelRevenueDailySchema.index({ day: -1 });

module.exports = mongoose.model('NovelRevenueDaily', novelRevenueDailySchema);
