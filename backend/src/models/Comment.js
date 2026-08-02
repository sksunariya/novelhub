const mongoose = require('mongoose');
const softDelete = require('./plugins/softDelete');

const commentSchema = new mongoose.Schema(
  {
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    parentComment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

commentSchema.index({ chapter: 1, createdAt: -1 });

commentSchema.plugin(softDelete);

module.exports = mongoose.model('Comment', commentSchema);
