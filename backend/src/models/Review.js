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
    rating: { type: Number, required: true, min: RATING.MIN, max: RATING.MAX },
    content: { type: String, default: '', trim: true, maxlength: 5000 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    replies: [reviewReplySchema],
    editedAt: { type: Date, default: null },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One active review per user per target; chapter is null for novel reviews, so the
// same index covers both. A deleted review doesn't block re-reviewing.
reviewSchema.index({ novel: 1, chapter: 1, user: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
// Serves the reading gate's "has this user reviewed this chapter" probe, which the
// index above cannot because its prefix is `novel`.
reviewSchema.index({ chapter: 1, user: 1 });

reviewSchema.plugin(softDelete);

module.exports = mongoose.model('Review', reviewSchema);
