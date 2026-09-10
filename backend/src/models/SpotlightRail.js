const mongoose = require('mongoose');
const spotlightTypes = require('../config/spotlightTypes');

// One document = one row on the homepage.
//
// WHY THIS EXISTS. The homepage used to be six sections hardcoded in
// frontend/src/pages/Home.jsx with six booleans in SiteSettings.homeSections to
// hide them. Changing the order, adding a row, running a row for one week, or
// showing anything that is not a novel all required a deploy. Meanwhile
// `Space.featured`, `Space.pinnedGlobally` and `Post.pinnedGlobally` existed in
// the schema with nothing rendering them.
//
// A rail is the unit an admin actually thinks in: a titled row, in an order,
// holding some things, live between two dates, aimed at some audience. The six
// original sections are seeded as ordinary rails, so there is one system rather
// than a curation system bolted next to a hardcoded one.
//
// A rail gets its contents one of two ways, and the distinction is the whole
// design:
//
//   manual — an admin pinned specific things. Editorial control, goes stale if
//            nobody tends it.
//   auto   — a query runs at read time. Never stale, never exactly what you
//            wanted.
//
// Both are needed. Manual for the things worth a human decision, auto for the
// volume that keeps the page alive on a week when nobody logs into the portal.

const itemSchema = new mongoose.Schema(
  {
    _id: false,
    // A key from config/spotlightTypes.js.
    type: { type: String, required: true },
    // Absent for standalone types (`custom`), which carry their whole card here.
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // Denormalized at pin time. NOT the render source for entity-backed items:
    // the resolver re-reads those live, so a renamed space or a re-covered
    // novel updates on the homepage without anyone re-pinning it. These are the
    // fallback when hydration finds nothing, the label the admin list shows
    // without hitting four collections, and a record of what was pinned.
    //
    // This is the opposite call from Post.linkedRefs, which denormalizes to
    // avoid a join while rendering a feed of hundreds of rows. A homepage rail
    // holds a handful of items and batches them by type, so it can afford to be
    // live where a feed cannot.
    label: { type: String, default: '', maxlength: 200 },
    thumb: { type: String, default: '', maxlength: 2000 },
    url: { type: String, default: '', maxlength: 2000 },

    // Editorial overlay. The reason this thing is on the front page today,
    // written by a person: "Finale drops Friday", "Most argued-about post this
    // week". Optional, and worth more than any automatic badge.
    note: { type: String, default: '', maxlength: 300 },
    badge: { type: String, default: '', maxlength: 40 },

    order: { type: Number, default: 0 },
    pinnedAt: { type: Date, default: Date.now },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

// What an `auto` rail pulls. `kind` picks the resolver; the rest are that
// resolver's parameters. A flat bag of every field for every kind would make
// "which of these apply to me" a guess at both ends.
const querySchema = new mongoose.Schema(
  {
    _id: false,
    kind: {
      type: String,
      enum: ['novels', 'posts', 'spaces', 'linked_posts'],
      default: 'novels',
    },

    // kind: novels
    novelSort: {
      type: String,
      enum: ['featured', 'trending', 'popular', 'rating', 'newest', 'updated'],
      default: 'trending',
    },
    novelStatus: { type: String, default: '' }, // ongoing | completed | hiatus
    genre: { type: String, default: '' },

    // kind: posts — the community feed, same sorts the feed itself offers.
    feedSort: { type: String, enum: ['hot', 'new', 'top', 'rising'], default: 'hot' },
    timeframe: { type: String, enum: ['hour', 'day', 'week', 'month', 'year', 'all'], default: 'week' },
    // Empty means every discoverable space.
    spaces: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Space' }],
    minScore: { type: Number, default: 0 },
    postType: { type: String, default: '' }, // text | image | link | poll

    // kind: spaces
    spaceSort: { type: String, enum: ['members', 'active', 'newest'], default: 'active' },
    topics: [{ type: String }],
    featuredOnly: { type: Boolean, default: false },

    // kind: linked_posts — the reader-to-community bridge. Posts whose
    // linkedRefs point at platform content, so "what readers are saying about
    // this novel" can sit on the homepage next to the novel itself.
    linkedType: { type: String, default: 'novel' },
    linkedId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // With no linkedId, the rail follows whatever novel is trending rather than
    // being pinned to one — a rail that stays interesting without being edited.
    followTrending: { type: Boolean, default: false },
  },
  { _id: false }
);

const spotlightRailSchema = new mongoose.Schema(
  {
    // Stable identifier. The seeded rails use the old homeSections keys
    // ('trending', 'newArrivals', …) so the migration is legible and idempotent.
    key: { type: String, required: true, trim: true, lowercase: true, maxlength: 60 },

    title: { type: String, required: true, trim: true, maxlength: 80 },
    subtitle: { type: String, default: '', maxlength: 200 },
    icon: { type: String, default: 'Sparkles', maxlength: 40 }, // lucide-react name
    accent: {
      type: String,
      enum: ['crimson', 'violet', 'amber', 'emerald', 'azure', 'gold', 'rose'],
      default: 'crimson',
    },

    // How the row draws itself. The renderer switches on this, so adding a
    // layout is a frontend change and nothing else.
    layout: {
      type: String,
      enum: ['carousel', 'grid', 'spotlight', 'poll', 'pulse', 'banner'],
      default: 'carousel',
    },

    source: { type: String, enum: ['manual', 'auto'], default: 'manual' },
    items: { type: [itemSchema], default: [] },
    query: { type: querySchema, default: () => ({}) },

    // Who sees this row.
    //
    // `non_members` is the one that earns its keep: "pick your first space" is
    // the single most useful thing to show someone who has an account and has
    // joined nothing, and the single most annoying thing to show everyone else.
    audience: {
      type: String,
      enum: ['all', 'anon', 'authed', 'members', 'non_members'],
      default: 'all',
    },

    // Scheduling. Both null means always. An event rail can be written on
    // Monday and go live on Friday without anyone being awake for it.
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    maxItems: { type: Number, default: 12, min: 1, max: 40 },

    viewAllUrl: { type: String, default: '', maxlength: 2000 },
    viewAllLabel: { type: String, default: 'View all', maxlength: 40 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

spotlightRailSchema.index({ key: 1 }, { unique: true });
// The public read: active rails in order. Every homepage request is this scan.
spotlightRailSchema.index({ isActive: 1, order: 1 });

/**
 * Is this rail live right now?
 *
 * Schedule only — audience is resolved per viewer and belongs with the request,
 * not with the document.
 */
spotlightRailSchema.methods.isScheduledNow = function isScheduledNow(now = new Date()) {
  if (!this.isActive) return false;
  if (this.startAt && this.startAt > now) return false;
  if (this.endAt && this.endAt < now) return false;
  return true;
};

/**
 * Drop items whose type is no longer in the registry.
 *
 * A type removed from config/spotlightTypes.js leaves orphaned items behind.
 * They cannot be rendered and cannot be validated, so they are stripped on the
 * way in rather than left to fail silently at read time.
 */
spotlightRailSchema.pre('save', function dropUnknownTypes(next) {
  if (Array.isArray(this.items) && this.items.length) {
    this.items = this.items.filter((item) => spotlightTypes.has(item.type));
  }
  next();
});

module.exports = mongoose.model('SpotlightRail', spotlightRailSchema);
