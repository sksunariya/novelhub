const mongoose = require('mongoose');
const { RATING } = require('../config/constants');
const softDelete = require('./plugins/softDelete');

const reviewReplySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    editedAt: { type: Date, default: null },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const reviewSchema = new mongoose.Schema(
  {
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    // null for a review of the novel itself; set for a review of a single chapter.
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, default: 0, min: 0, max: RATING.MAX },
    content: { type: String, default: '', trim: true, maxlength: 5000 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    replies: [reviewReplySchema],
    editedAt: { type: Date, default: null },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isPinned: { type: Boolean, default: false },
    pinnedAt: { type: Date, default: null },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One live review per reader per target: one for the novel (chapter null) and
// one per chapter. Comments are a separate model and stay unlimited.
//
// A unique index rather than controller logic alone, because saveReview does a
// find-then-create: two submissions racing each other both miss the existing
// row and both insert. Partial on deletedAt so a soft-deleted review does not
// block the reader from writing a new one.
//
// NOTE: this index will fail to build on a collection that already holds
// duplicates. Check with the aggregation in scripts/findDuplicateReviews.js
// before deploying, and merge or soft-delete the extras first.
reviewSchema.index(
  { novel: 1, chapter: 1, user: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
reviewSchema.index({ novel: 1, chapter: 1, isPinned: -1, pinnedAt: -1, createdAt: -1 });
// Serves the reading gate's "has this user reviewed this chapter" probe, which the
// index above cannot because its prefix is `novel`.
reviewSchema.index({ chapter: 1, user: 1 });

reviewSchema.plugin(softDelete);

module.exports = mongoose.model('Review', reviewSchema);
