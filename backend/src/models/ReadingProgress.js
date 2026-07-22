const mongoose = require('mongoose');

const readingProgressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    chapterNumber: { type: Number, required: true },
  },
  { timestamps: true }
);

readingProgressSchema.index({ user: 1, novel: 1 }, { unique: true });
readingProgressSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('ReadingProgress', readingProgressSchema);
