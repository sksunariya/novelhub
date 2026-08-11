const mongoose = require('mongoose');
const { NOVEL_STATUS } = require('../config/constants');
const softDelete = require('./plugins/softDelete');
const { buildReadingGateSchema } = require('./schemas/readingGate');
const { buildMonetizationSchema } = require('./schemas/monetization');

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
    // Ignored unless `override` is true, in which case it replaces the site-wide gate.
    readingGate: {
      type: buildReadingGateSchema({ override: { type: Boolean, default: false } }),
      default: () => ({}),
    },
    // Ignored unless `override` is true, in which case it replaces the
    // site-wide monetization defaults for this novel.
    monetization: {
      type: buildMonetizationSchema({ override: { type: Boolean, default: false } }),
      default: () => ({}),
    },
    // Optional link to an account, for revenue share. `author` above stays the
    // display string so nothing existing breaks.
    authorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Canonical author for earnings grouping. `author` above stays the display
    // string so nothing existing breaks and novels can be linked gradually.
    authorRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Author', default: null },
    // Earnings are admin-only. $inc updates still work without selecting it.
    revenueLifetimeUsdMicros: { type: Number, default: 0, select: false },
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
