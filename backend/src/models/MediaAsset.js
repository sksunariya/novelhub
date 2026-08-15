const mongoose = require('mongoose');

// A ledger row for every uploaded object.
//
// Not bookkeeping for its own sake — it answers four questions the embedded
// Post.media array cannot:
//
//   1. DAILY QUOTA. spaces.media.maxDailyBytesPerUser needs a sum of bytes per
//      user per day. Aggregating that from embedded arrays across posts is a
//      collection scan; here it is an indexed range.
//   2. ORPHANS. The composer uploads as files are dragged in, before a post
//      exists. Anything never claimed is billable storage nobody can see, and
//      without a row there is nothing to sweep.
//   3. DELETION. Purging a space or a user means deleting their objects from
//      S3. The keys have to be recorded somewhere queryable.
//   4. RE-UPLOAD. sha256 catches the same file arriving again — for dedupe, and
//      for spotting someone retrying a file that was already refused.

const mediaAssetSchema = new mongoose.Schema(
  {
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', default: null },
    // Null until the draft is claimed by a submitted post.
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },

    key: { type: String, required: true },
    thumbKey: { type: String, default: '' },
    url: { type: String, default: '' },
    thumbUrl: { type: String, default: '' },

    mime: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    sha256: { type: String, default: '' },

    // 'draft' until a post claims it, then 'attached'. 'orphaned' is set by the
    // sweep before deletion, so a mistake is recoverable for one cycle.
    status: { type: String, enum: ['draft', 'attached', 'orphaned'], default: 'draft' },
    attachedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Daily quota: sum bytes for one user since a cutoff.
mediaAssetSchema.index({ uploader: 1, createdAt: -1 });
// Orphan sweep: unclaimed drafts older than the grace period.
mediaAssetSchema.index({ status: 1, createdAt: 1 });
// Deletion cascade.
mediaAssetSchema.index({ post: 1 });
mediaAssetSchema.index({ space: 1 });
// Re-upload detection.
mediaAssetSchema.index({ sha256: 1 });

/** Bytes this user has uploaded since `since`. Backs the daily quota. */
mediaAssetSchema.statics.bytesSince = async function bytesSince(userId, since) {
  const [row] = await this.aggregate([
    { $match: { uploader: userId, createdAt: { $gte: since } } },
    { $group: { _id: null, bytes: { $sum: '$bytes' } } },
  ]);
  return row ? row.bytes : 0;
};

module.exports = mongoose.model('MediaAsset', mediaAssetSchema);
