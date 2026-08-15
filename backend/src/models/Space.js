const mongoose = require('mongoose');
const softDelete = require('./plugins/softDelete');
const {
  SPACE_VISIBILITY,
  SPACE_JOIN_POLICY,
  SPACE_STATUS,
  POST_TYPES,
} = require('../config/constants');

// A community space. General-purpose: about cooking, a city, a game, or a
// novel — nothing here assumes the platform's own domain. Links to platform
// content go through the optional, generic `linkedRefs` array.

const ruleSchema = new mongoose.Schema(
  {
    _id: false,
    // Stable identifier, generated once and never reused. Moderation actions
    // cite a rule by ID; reordering or editing the text must not silently
    // change what a past enforcement action referred to.
    ruleId: { type: String, required: true },
    order: { type: Number, default: 0 },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    appliesTo: { type: String, enum: ['all', 'post', 'comment'], default: 'all' },
  },
  { _id: false }
);

const linkedRefSchema = new mongoose.Schema(
  {
    _id: false,
    type: { type: String, required: true },
    id: { type: mongoose.Schema.Types.ObjectId },
    url: { type: String, default: '' },
    // Denormalized so rendering a list of links needs no join.
    label: { type: String, default: '' },
    thumb: { type: String, default: '' },
  },
  { _id: false }
);

const spaceSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, lowercase: true, trim: true },
    // Confusable-normalized form of the slug. Indexed and checked at creation
    // so `rn0d` cannot be registered alongside `mod`. See utils/slugSafety.js.
    slugSkeleton: { type: String, required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 60 },
    tagline: { type: String, default: '', maxlength: 120 },
    description: { type: String, default: '', maxlength: 10000 }, // sanitized HTML
    descriptionText: { type: String, default: '' }, // stripped, feeds search

    iconUrl: { type: String, default: '' },
    bannerUrl: { type: String, default: '' },
    theme: {
      // Validated for contrast against the site surfaces at save time — a space
      // owner must not be able to create an unreadable page.
      primary: { type: String, default: '' },
      banner: { type: String, enum: ['image', 'gradient', 'solid'], default: 'gradient' },
      prefersDarkText: { type: Boolean, default: false },
    },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    visibility: {
      type: String,
      enum: Object.values(SPACE_VISIBILITY),
      default: SPACE_VISIBILITY.PUBLIC,
    },
    joinPolicy: {
      type: String,
      enum: Object.values(SPACE_JOIN_POLICY),
      default: SPACE_JOIN_POLICY.OPEN,
    },
    status: { type: String, enum: Object.values(SPACE_STATUS), default: SPACE_STATUS.ACTIVE },
    statusReason: { type: String, default: '', maxlength: 1000 },
    statusChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    statusChangedAt: { type: Date, default: null },
    nsfw: { type: Boolean, default: false },

    // Creation request context. Retained after approval so an admin reviewing a
    // problem space can see what it claimed to be for.
    purpose: { type: String, default: '', maxlength: 2000 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', maxlength: 1000 },

    // Sparse overrides of the global registry. Only keys flagged
    // `spaceOverridable` are accepted from an owner; admins may force any key.
    // Mirrors AppSettings: store what changed, inherit everything else, so a
    // global default change moves every space that never overrode it.
    overrides: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    allowedPostTypes: [{ type: String, enum: Object.values(POST_TYPES) }],
    rules: { type: [ruleSchema], default: [] },

    topics: [{ type: String }],
    language: { type: String, default: 'en', maxlength: 8 },
    linkedRefs: { type: [linkedRefSchema], default: [] },

    // Admin levers.
    featured: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },
    pinnedGlobally: { type: Boolean, default: false },
    excludeFromAll: { type: Boolean, default: false },
    publicModlog: { type: Boolean, default: false },

    // Moderator tools. Fields exist from Phase 1 so Phase 5 does not need a
    // migration on a large collection; unused until then.
    slowMode: {
      enabled: { type: Boolean, default: false },
      seconds: { type: Number, default: 0, min: 0, max: 86400 },
    },
    lockdown: {
      enabled: { type: Boolean, default: false },
      minKarma: { type: Number, default: 0 },
      minAccountAgeHours: { type: Number, default: 0 },
      until: { type: Date, default: null },
    },
    bannedWords: [{ type: String }],

    // Denormalized counters. Caches — rebuildable from source by the recount
    // job, which is what makes batched and async updates safe.
    memberCount: { type: Number, default: 0 },
    postCount: { type: Number, default: 0 },
    activeCount7d: { type: Number, default: 0 },
    lastPostAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Unique only among non-deleted spaces, matching the User model's approach, so
// a deleted space's slug can eventually be reused by an admin.
spaceSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

// Discovery and browse.
spaceSchema.index({ status: 1, visibility: 1, memberCount: -1 });
spaceSchema.index({ featured: -1, memberCount: -1 });
spaceSchema.index({ topics: 1, memberCount: -1 });
spaceSchema.index({ owner: 1, createdAt: -1 });
// Approval queue, and the expiry sweep over stale requests.
spaceSchema.index({ status: 1, createdAt: 1 });
// Sparse: most spaces link to nothing, so they cost nothing here.
spaceSchema.index(
  { 'linkedRefs.type': 1, 'linkedRefs.id': 1 },
  { sparse: true }
);
spaceSchema.index({ name: 'text', descriptionText: 'text', tagline: 'text' });

spaceSchema.plugin(softDelete);

/** Is this space accepting new content right now? */
spaceSchema.methods.isWritable = function isWritable() {
  return this.status === SPACE_STATUS.ACTIVE && !this.locked;
};

/** Is this space visible in feeds and search to someone who is not a member? */
spaceSchema.methods.isDiscoverable = function isDiscoverable() {
  return (
    this.status === SPACE_STATUS.ACTIVE &&
    this.visibility !== SPACE_VISIBILITY.PRIVATE &&
    !this.excludeFromAll
  );
};

module.exports = mongoose.model('Space', spaceSchema);
