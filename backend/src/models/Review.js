const mongoose = require('mongoose');
const { RATING } = require('../config/constants');
const softDelete = require('./plugins/softDelete');

const reviewSchema = new mongoose.Schema(
  {
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: RATING.MIN, max: RATING.MAX },
    content: { type: String, default: '', trim: true, maxlength: 5000 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

// One active review per user per novel; a deleted review doesn't block re-reviewing.
reviewSchema.index({ novel: 1, user: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

reviewSchema.plugin(softDelete);

module.exports = mongoose.model('Review', reviewSchema);
