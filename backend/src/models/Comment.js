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
    dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    editedAt: { type: Date, default: null },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

commentSchema.index({ chapter: 1, createdAt: -1 });
commentSchema.index({ parentComment: 1, createdAt: 1 });
// Serves the reading gate's "has this user commented on this novel" probe.
commentSchema.index({ novel: 1, user: 1 });

commentSchema.plugin(softDelete);

module.exports = mongoose.model('Comment', commentSchema);
