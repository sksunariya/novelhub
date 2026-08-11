const mongoose = require('mongoose');

// Per-chapter daily counters.
//
// Aggregating raw ChapterRead rows on every dashboard load will not stay fast
// once a novel has a few hundred thousand of them, so the charts read this and
// the raw table is kept for cohort work.
const chapterStatsDailySchema = new mongoose.Schema(
  {
    day: { type: String, required: true }, // YYYY-MM-DD, UTC
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    chapterNumber: { type: Number, required: true },

    reads: { type: Number, default: 0 },
    uniqueReaders: { type: Number, default: 0 },
    gateImpressions: { type: Number, default: 0 },
    unlocks: { type: Number, default: 0 },
    creditsSpent: { type: Number, default: 0 },
    // Cash actually behind the credits spent here.
    attributedUsdMicros: { type: Number, default: 0 },

    // Credits ÷ creditsPerUsd. Kept alongside so a report can show both bases
    // without recomputing, and so the gap between them stays visible.
    faceValueUsdMicros: { type: Number, default: 0 },
    // Credits spent here that were granted rather than bought. High readership
    // funded entirely by free credits looks like success and earns nothing.
    grantFundedCredits: { type: Number, default: 0 },
    uniqueBuyers: { type: Number, default: 0 },
    refundedUsdMicros: { type: Number, default: 0 },
  },
  { timestamps: true }
);

chapterStatsDailySchema.index({ day: 1, chapter: 1 }, { unique: true });
chapterStatsDailySchema.index({ novel: 1, day: -1 });
chapterStatsDailySchema.index({ day: -1 });

module.exports = mongoose.model('ChapterStatsDaily', chapterStatsDailySchema);
