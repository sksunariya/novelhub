const mongoose = require('mongoose');
const softDelete = require('./plugins/softDelete');
const { POST_TYPES, POST_STATUS } = require('../config/constants');

const mediaSchema = new mongoose.Schema(
  {
    _id: false,
    url: { type: String, required: true },
    thumbUrl: { type: String, default: '' },
    mime: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    // Prompted in the composer, never auto-filled from the filename.
    // Retrofitting alt text means every image uploaded before the change is
    // permanently inaccessible — you cannot go back and ask 40,000 people to
    // describe their photos.
    alt: { type: String, default: '', maxlength: 1000 },
    caption: { type: String, default: '', maxlength: 500 },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const pollOptionSchema = new mongoose.Schema({
  text: { type: String, required: true, maxlength: 200 },
  votes: { type: Number, default: 0 },
});

const linkedRefSchema = new mongoose.Schema(
  {
    _id: false,
    type: { type: String, required: true },
    id: { type: mongoose.Schema.Types.ObjectId },
    url: { type: String, default: '' },
    label: { type: String, default: '' },
    thumb: { type: String, default: '' },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    // Future shard key prefix: { space: 1, _id: 1 }. Space feeds are the
    // dominant query and must stay single-shard. A shard key value cannot be
    // updated in place, which is why "move to another space" is implemented as
    // delete-and-recreate rather than an update.
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: Object.values(POST_TYPES), required: true },

    title: { type: String, required: true, trim: true, maxlength: 1000 },
    titleSlug: { type: String, default: '' },
    body: { type: String, default: '' }, // sanitized HTML
    bodyText: { type: String, default: '' }, // stripped; search + banned-word scan

    media: { type: [mediaSchema], default: [] },

    link: {
      url: { type: String, default: '' },
      domain: { type: String, default: '' },
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      imageUrl: { type: String, default: '' },
      fetchedAt: { type: Date, default: null },
      fetchStatus: { type: String, default: '' },
    },

    poll: {
      options: { type: [pollOptionSchema], default: undefined },
      allowMultiple: { type: Boolean, default: false },
      endsAt: { type: Date, default: null },
      totalVoters: { type: Number, default: 0 },
      hideResultsUntilEnd: { type: Boolean, default: false },
    },

    flair: { type: mongoose.Schema.Types.ObjectId, ref: 'Flair', default: null },
    flairText: { type: String, default: '' },
    nsfw: { type: Boolean, default: false },
    spoiler: { type: Boolean, default: false },
    linkedRefs: { type: [linkedRefSchema], default: [] },

    status: { type: String, enum: Object.values(POST_STATUS), default: POST_STATUS.PUBLISHED },
    locked: { type: Boolean, default: false },
    pinnedInSpace: { type: Boolean, default: false },
    pinnedGlobally: { type: Boolean, default: false },

    // `status: 'removed'` is a moderation state and stays queryable by mods.
    // `deletedAt` is the author deleting their own post. Different events, both
    // recoverable, never conflated.
    removal: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      byRole: { type: String, default: '' },
      reason: { type: String, default: '' },
      ruleId: { type: String, default: '' },
      note: { type: String, default: '' },
      at: { type: Date, default: null },
    },

    editedAt: { type: Date, default: null },

    // Denormalized ranking fields. Caches of the Vote ledger, rebuildable by
    // the recount job — which is what makes batched counter writes safe.
    upvotes: { type: Number, default: 0 },
    downvotes: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    hotScore: { type: Number, default: 0 },
    bestScore: { type: Number, default: 0 },
    controversyScore: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// --- Feed indexes -------------------------------------------------------
// ESR: Equality, Sort, Range. Every field matched by equality comes first,
// then the sort field, then the tiebreak. Getting this order wrong produces an
// index the planner will still use while sorting in memory — it looks correct
// at a glance in explain(), and it is not.
postSchema.index({ space: 1, status: 1, hotScore: -1, _id: -1 });
postSchema.index({ space: 1, status: 1, createdAt: -1, _id: -1 });
postSchema.index({ space: 1, status: 1, score: -1, _id: -1 });
postSchema.index({ space: 1, pinnedInSpace: -1, hotScore: -1 });

// Global feeds. Same shape without the space equality.
postSchema.index({ status: 1, hotScore: -1, _id: -1 });
postSchema.index({ status: 1, createdAt: -1, _id: -1 });
postSchema.index({ pinnedGlobally: -1, hotScore: -1 }, { sparse: true });

postSchema.index({ author: 1, createdAt: -1 });

// Sparse — most posts link to nothing, so they cost nothing here.
postSchema.index({ 'linkedRefs.type': 1, 'linkedRefs.id': 1, createdAt: -1 }, { sparse: true });

// Partial — the moderation queue only ever looks at reported posts, so the
// index is a fraction of the collection rather than all of it.
postSchema.index(
  { status: 1, reportCount: -1 },
  { partialFilterExpression: { reportCount: { $gt: 0 } } }
);

// Poll-closing job. Sparse: only poll posts have it.
postSchema.index({ 'poll.endsAt': 1 }, { sparse: true });

postSchema.index({ title: 'text', bodyText: 'text' });

postSchema.plugin(softDelete);

/** Is this post visible in feeds and search? */
postSchema.methods.isPublic = function isPublic() {
  return this.status === POST_STATUS.PUBLISHED && !this.deletedAt;
};

module.exports = mongoose.model('Post', postSchema);
