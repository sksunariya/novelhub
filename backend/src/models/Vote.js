const mongoose = require('mongoose');
const { VOTE_TARGET_TYPES } = require('../config/constants');

// The vote ledger. This will become the largest collection on the site by two
// orders of magnitude — at 100k DAU it is roughly 730M rows per year — and
// every design decision here is about that.
//
// See docs/spaces/scalability.md §4.5 for the archival strategy that keeps it
// from growing without bound, and §3.3 for why the unique index below is the
// number that actually constrains the system.
//
// NO softDelete PLUGIN. Unvoting deletes the row. There is nothing to audit in
// a removed vote, and the plugin's read hook would add a `deletedAt: null`
// clause to the single most frequent query on the site.
//
// COUNTERS ARE A CACHE; THIS IS TRUTH. Post.score can be wrong and rebuilt from
// here, which is what makes batched and asynchronous counter writes safe.

const voteSchema = new mongoose.Schema(
  {
    // Future shard key: { user: 'hashed' }. The hot query — "did I vote on any
    // of these 25 posts" — is by user, so it stays a single-shard lookup.
    // Counter rebuilds by target become scatter-gather, which is acceptable for
    // a batch job.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: Object.values(VOTE_TARGET_TYPES), required: true },
    target: { type: mongoose.Schema.Types.ObjectId, required: true },

    // Denormalized and populated on EVERY write, even though nothing queries it
    // yet. Per-space karma rebuilds and per-space vote-anomaly detection both
    // need it, and adding a field to a 500M-row collection later is a migration
    // measured in hours of downtime.
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },

    value: { type: Number, enum: [1, -1], required: true },

    // Vote manipulation enforcement NULLIFIES rather than deletes: the row
    // stays so counters remain rebuildable and the evidence survives an appeal.
    // Same migration argument as `space`.
    nullified: { type: Boolean, default: false },
    nullifiedReason: { type: String, default: '' },

    // Hashed device fingerprint. The single most useful signal for detecting
    // alt-account vote rings — and completely worthless if collection begins
    // after the abuse does, which is why it is here in Phase 2 rather than
    // Phase 5. Purged on the schedule in spaces.privacy.fingerprintRetentionDays.
    fingerprint: { type: String, default: '' },
    ipHash: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

// One vote per user per item. This is what makes the vote endpoint idempotent
// under a double-click, and it is the index whose size determines when
// archival becomes necessary.
voteSchema.index({ user: 1, targetType: 1, target: 1 }, { unique: true });

// Counter rebuild: sum values for a target.
voteSchema.index({ target: 1, value: 1 });

// "My upvoted", and the velocity analysis behind manipulation detection.
voteSchema.index({ user: 1, createdAt: -1 });

// Per-space karma rebuild, and per-space anomaly detection.
voteSchema.index({ space: 1, user: 1 });

// Archival sweep: find votes older than the hot window.
voteSchema.index({ createdAt: 1 });

/**
 * Sum the live votes for a set of targets.
 *
 * The rebuild path. Excludes nullified rows, because the point of nullifying
 * rather than deleting is that the counters stop reflecting them while the
 * evidence remains.
 */
voteSchema.statics.tallyFor = function tallyFor(targetIds) {
  return this.aggregate([
    { $match: { target: { $in: targetIds }, nullified: false } },
    {
      $group: {
        _id: '$target',
        upvotes: { $sum: { $cond: [{ $eq: ['$value', 1] }, 1, 0] } },
        downvotes: { $sum: { $cond: [{ $eq: ['$value', -1] }, 1, 0] } },
      },
    },
  ]);
};

/**
 * This user's votes across a set of targets.
 *
 * Serves the "did I vote on these" merge on every feed page. Projected to just
 * the two fields it needs so the query is covered by the unique index and never
 * touches a document.
 */
voteSchema.statics.forUserTargets = function forUserTargets(userId, targetType, targetIds) {
  return this.find(
    { user: userId, targetType, target: { $in: targetIds } },
    { target: 1, value: 1, _id: 0 }
  ).lean();
};

module.exports = mongoose.model('Vote', voteSchema);
