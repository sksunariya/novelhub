const mongoose = require('mongoose');

// Persistent record of who has read which chapter.
//
// Nothing existing could answer this. ViewEvent has a 30-minute TTL (it is a
// dedup key, not an analytics table), Chapter.views is a scalar with no time or
// user dimension, and ReadingProgress is unique on (user, novel) so chapter 40
// overwrites the fact that anyone ever read chapter 11.
//
// Without this table the retention-vs-paywall curve, unlock rate, reader→payer
// conversion and chapter drop-off are all uncomputable — and unlike most gaps,
// this one cannot be backfilled after the fact.
const chapterReadSchema = new mongoose.Schema(
  {
    // `u:<userId>` when signed in, `d:<deviceId>` otherwise. One identity per
    // reader either way, so anonymous readers still count exactly once.
    readerKey: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    chapterNumber: { type: Number, required: true },

    firstReadAt: { type: Date, default: Date.now },
    lastReadAt: { type: Date, default: Date.now },
    readCount: { type: Number, default: 1 },
  },
  { versionKey: false }
);

// One row per reader per chapter. Re-reads bump lastReadAt and readCount.
chapterReadSchema.index({ readerKey: 1, chapter: 1 }, { unique: true });
// The retention curve: unique readers grouped by chapter across a novel.
chapterReadSchema.index({ novel: 1, chapterNumber: 1 });
chapterReadSchema.index({ chapter: 1 });
chapterReadSchema.index({ user: 1, firstReadAt: -1 });
chapterReadSchema.index({ firstReadAt: -1 });

module.exports = mongoose.model('ChapterRead', chapterReadSchema);
