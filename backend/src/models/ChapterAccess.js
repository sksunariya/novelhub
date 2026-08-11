const mongoose = require('mongoose');
const { ACCESS_SOURCES } = require('../config/constants');

// What a reader owns.
//
// The unique (user, chapter) index is the double-unlock guard: a duplicate-key
// error means "already owned", which the unlock flow treats as success rather
// than failure. That makes a double-clicked button harmless without needing a
// transaction.
const chapterAccessSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },

    source: { type: String, enum: Object.values(ACCESS_SOURCES), default: ACCESS_SOURCES.CREDITS },
    creditsSpent: { type: Number, default: 0 },
    // Cash this unlock recognized, in micro-USD. Zero when funded by free credits.
    attributedUsdMicros: { type: Number, default: 0 },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditTransaction' },

    // null = permanent. Set under the rental model.
    expiresAt: { type: Date, default: null },
    unlockedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

chapterAccessSchema.index({ user: 1, chapter: 1 }, { unique: true });
// "Which chapters do I own in this novel" — drives the chapter list.
chapterAccessSchema.index({ user: 1, novel: 1 });
// Revenue rollups.
chapterAccessSchema.index({ chapter: 1, unlockedAt: -1 });
chapterAccessSchema.index({ novel: 1, unlockedAt: -1 });
// Rental sweeper.
chapterAccessSchema.index({ expiresAt: 1 }, { sparse: true });

chapterAccessSchema.methods.isLive = function isLive() {
  return !this.expiresAt || this.expiresAt.getTime() > Date.now();
};

module.exports = mongoose.model('ChapterAccess', chapterAccessSchema);
