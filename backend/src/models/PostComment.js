const mongoose = require('mongoose');
const softDelete = require('./plugins/softDelete');
const { POST_STATUS } = require('../config/constants');

// Threaded comments on a community post.
//
// DELIBERATELY A SEPARATE MODEL FROM `Comment`. That one serves chapter
// comments: tied to a chapter, carrying inline like/dislike arrays and the
// reading gate's `{ novel, user }` probe index — which sits on the reading hot
// path. Adding a threading path, vote aggregates and a moderation removal state
// to it would slow that probe for no benefit. Different features, different
// access patterns.
//
// THREADING USES BOTH `ancestors` AND `sortPath`, for different jobs:
//
//   ancestors — root-to-parent id list. Makes "remove this comment and
//               everything under it" a single updateMany({ ancestors: id }),
//               and "how many descendants" a single count.
//   sortPath  — fixed-width encoding of each ancestor's insertion rank, e.g.
//               "0001.000a.0003". Gives a stable depth-first ordering that a
//               single indexed range scan returns already in tree order,
//               instead of N recursive queries.
//
// sortPath encodes INSERTION order, not score. A score-derived path would have
// to be rewritten on every vote, which is unworkable — so siblings are
// re-sorted in memory by the requested sort, and the path only guarantees that
// a subtree is contiguous and deterministic.

const PATH_WIDTH = 4; // base36, so 1,679,615 siblings per parent
const PATH_SEPARATOR = '.';

const postCommentSchema = new mongoose.Schema(
  {
    // Future shard key prefix: { post: 1, _id: 1 }. An entire comment tree must
    // live on one shard — that is the whole game for comments. Denormalized on
    // EVERY comment including deep replies, never derived by walking ancestors.
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    // Denormalized for the moderation queue, which is always space-scoped.
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'PostComment', default: null },
    ancestors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PostComment' }],
    depth: { type: Number, default: 0 },
    sortPath: { type: String, default: '' },

    body: { type: String, default: '' }, // sanitized HTML
    bodyText: { type: String, default: '' }, // stripped; search + banned-word scan

    // Resolved at write time rather than re-parsed on every render — and it
    // survives the mentioned user being renamed.
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    status: { type: String, enum: Object.values(POST_STATUS), default: POST_STATUS.PUBLISHED },
    removal: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      byRole: { type: String, default: '' },
      reason: { type: String, default: '' },
      ruleId: { type: String, default: '' },
      note: { type: String, default: '' },
      at: { type: Date, default: null },
    },

    editedAt: { type: Date, default: null },
    editCount: { type: Number, default: 0 },

    isPinned: { type: Boolean, default: false },
    // Denormalized so the OP badge needs no join when rendering 500 comments.
    isOp: { type: Boolean, default: false },

    upvotes: { type: Number, default: 0 },
    downvotes: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    bestScore: { type: Number, default: 0 },
    controversyScore: { type: Number, default: 0 },
    replyCount: { type: Number, default: 0 },
    // Direct children only, for the "N more replies" affordance.
    directReplyCount: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One indexed range scan returns a subtree already in tree order.
postCommentSchema.index({ post: 1, sortPath: 1 });
// Top-level comments by the requested sort. ESR: equality, equality, sort.
postCommentSchema.index({ post: 1, parent: 1, bestScore: -1 });
postCommentSchema.index({ post: 1, parent: 1, createdAt: -1 });
postCommentSchema.index({ post: 1, parent: 1, score: -1 });
// Default view: pinned first, then best.
postCommentSchema.index({ post: 1, isPinned: -1, bestScore: -1 });
// Subtree removal cascade, and descendant counting.
postCommentSchema.index({ ancestors: 1 });
// Profile.
postCommentSchema.index({ author: 1, createdAt: -1 });
// Moderation queue — partial, because it only ever looks at reported comments.
postCommentSchema.index(
  { space: 1, status: 1, reportCount: -1 },
  { partialFilterExpression: { reportCount: { $gt: 0 } } }
);
postCommentSchema.index({ bodyText: 'text' });

postCommentSchema.plugin(softDelete);

/** Encode one sibling rank into the fixed-width path segment. */
postCommentSchema.statics.pathSegment = (index) =>
  Number(index).toString(36).padStart(PATH_WIDTH, '0').slice(-PATH_WIDTH);

/**
 * Build a child's sortPath from its parent's.
 *
 * Fixed width matters: variable-length segments sort lexicographically wrong
 * ("10" < "9"), which would scramble every tree past nine siblings.
 */
postCommentSchema.statics.childPath = function childPath(parentPath, index) {
  const segment = this.pathSegment(index);
  return parentPath ? `${parentPath}${PATH_SEPARATOR}${segment}` : segment;
};

/**
 * Is this comment's content hidden from ordinary viewers?
 *
 * Removed and deleted comments keep their NODE so replies beneath them are not
 * orphaned — only the body is replaced with a tombstone.
 */
postCommentSchema.methods.isTombstoned = function isTombstoned() {
  return this.status !== POST_STATUS.PUBLISHED || Boolean(this.deletedAt);
};

postCommentSchema.statics.PATH_WIDTH = PATH_WIDTH;
postCommentSchema.statics.PATH_SEPARATOR = PATH_SEPARATOR;

module.exports = mongoose.model('PostComment', postCommentSchema);
