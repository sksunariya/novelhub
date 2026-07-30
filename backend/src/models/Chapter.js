const mongoose = require('mongoose');

const chapterSchema = new mongoose.Schema(
  {
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    number: { type: Number, required: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    content: { type: String, required: true },
    views: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
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

chapterSchema.index({ novel: 1, number: 1 }, { unique: true });

module.exports = mongoose.model('Chapter', chapterSchema);
