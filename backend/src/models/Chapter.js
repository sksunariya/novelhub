const mongoose = require('mongoose');
const softDelete = require('./plugins/softDelete');

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

chapterSchema.plugin(softDelete);

module.exports = mongoose.model('Chapter', chapterSchema);
