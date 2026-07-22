const mongoose = require('mongoose');
const { RATING } = require('../config/constants');

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

reviewSchema.index({ novel: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
