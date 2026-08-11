const mongoose = require('mongoose');
const softDelete = require('./plugins/softDelete');
const { CHAPTER_ACCESS_TYPES } = require('../config/constants');

const chapterSchema = new mongoose.Schema(
  {
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    number: { type: Number, required: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    content: { type: String, required: true },
    views: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },

    // When the chapter actually became readable. `createdAt` is the wrong proxy:
    // a chapter drafted in January and published in August would be instantly
    // free under a freeAfterDays rule. Set on the false->true publish transition.
    publishedAt: { type: Date, default: null },
    // Enables word-count pricing rules without re-parsing content on every read.
    wordCount: { type: Number, default: 0 },
    // Renumbering must not silently move a paid chapter into the free range.
    originalNumber: { type: Number },

    accessType: {
      type: String,
      enum: Object.values(CHAPTER_ACCESS_TYPES),
      default: CHAPTER_ACCESS_TYPES.INHERIT,
    },
    priceCredits: { type: Number, min: 0, default: null },
    freeAfterDays: { type: Number, min: 0, default: null },
    earlyAccessUntil: { type: Date, default: null },
    rentalHours: { type: Number, min: 0, default: null },
    // Denormalized so the admin chapter table can sort by earnings cheaply.
    // Admin-only, so excluded by default the same way as the novel figure.
    revenueLifetimeUsdMicros: { type: Number, default: 0, select: false },
    // Original uploaded source file, stored privately in S3 (key + metadata).
    sourceFile: {
      key: { type: String },
      name: { type: String },
      size: { type: Number },
      contentType: { type: String },
    },
  },
  { timestamps: true }
);

// Unique chapter number per novel only among non-deleted chapters.
chapterSchema.index({ novel: 1, number: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
chapterSchema.index({ novel: 1, publishedAt: -1 });

const HTML_TAG = /<[^>]*>/g;

const countWords = (html) =>
  String(html || '')
    .replace(HTML_TAG, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

chapterSchema.pre('save', function stampPublishAndWords() {
  if (this.isNew && this.originalNumber === undefined) {
    this.originalNumber = this.number;
  }
  // Stamp on the false->true transition, and on creation of an already-published
  // chapter. Never re-stamp: unpublishing and republishing must not reset the
  // clock that timed-release pricing depends on.
  if (this.published && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  if (this.isModified('content')) {
    this.wordCount = countWords(this.content);
  }
});

chapterSchema.statics.countWords = countWords;

chapterSchema.plugin(softDelete);

module.exports = mongoose.model('Chapter', chapterSchema);
