const mongoose = require('mongoose');
const { NOVEL_STATUS } = require('../config/constants');
const softDelete = require('./plugins/softDelete');

const novelSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true },
    author: { type: String, required: true, trim: true, maxlength: 100 },
    synopsis: { type: String, default: '', maxlength: 5000 },
    coverUrl: { type: String, default: '' },
    genres: [{ type: String, trim: true }],
    tags: [{ type: String, trim: true }],
    status: { type: String, enum: Object.values(NOVEL_STATUS), default: NOVEL_STATUS.ONGOING },
    published: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    weeklyViews: { type: Number, default: 0 },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    chapterCount: { type: Number, default: 0 },
    lastChapterAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

novelSchema.index({ title: 'text', author: 'text', synopsis: 'text' });
novelSchema.index({ genres: 1 });
novelSchema.index({ views: -1 });
// Unique slug only among non-deleted novels, so a deleted novel's slug can be reused.
novelSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

novelSchema.plugin(softDelete);

module.exports = mongoose.model('Novel', novelSchema);
