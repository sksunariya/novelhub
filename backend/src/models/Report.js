const mongoose = require('mongoose');
const {
  REPORT_TARGET_TYPES,
  REPORT_STATUS,
  REPORT_SOURCES,
} = require('../config/constants');

// User reports.
//
// The mechanism: enough distinct reporters hide the content immediately, an
// admin or moderator reviews it, and it is either restored or removed. The user
// is told what happened at every step.
//
// TWO THINGS THAT MAKE THIS WORK RATHER THAN BEING GAMEABLE:
//
//   1. DISTINCT REPORTERS, not report count. The unique index below means one
//      person cannot hide a post by reporting it five times, and the reporter's
//      identity is what the threshold counts.
//   2. SEVERITY WEIGHTING. "Off topic" and "content involving a minor" cannot
//      share a threshold. A low-severity reason needs the full count; the most
//      severe reasons hide on the first report and escalate immediately,
//      because for those the delay IS the harm.
//
// `snapshot` matters more than it looks: a user reports a post, the author
// edits it into something innocuous, and without a snapshot the reviewer sees
// nothing wrong and the report is dismissed. The queue must show what was
// actually reported.

const reportSchema = new mongoose.Schema(
  {
    targetType: { type: String, enum: Object.values(REPORT_TARGET_TYPES), required: true },
    target: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Denormalized: the moderation queue is always space-scoped, and a space
    // moderator must never see reports from another space.
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', default: null },
    // Who wrote the reported content. Lets the queue show a reviewer the
    // author's history without a second lookup per row.
    contentAuthor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // The DSA requires ANYONE to be able to report illegal content, not only
    // account holders. These exist now so the public endpoint is a route
    // addition rather than a schema migration.
    reporterEmail: { type: String, default: '' },
    reporterType: { type: String, enum: ['user', 'anonymous', 'trusted_flagger', 'automated'], default: 'user' },

    reason: { type: String, required: true },
    severity: { type: Number, default: 1, min: 1, max: 5 },
    details: { type: String, default: '', maxlength: 2000 },
    source: { type: String, enum: Object.values(REPORT_SOURCES), default: REPORT_SOURCES.USER },

    status: { type: String, enum: Object.values(REPORT_STATUS), default: REPORT_STATUS.OPEN },

    // Content as it was WHEN REPORTED. An edit after the fact must not
    // invalidate the report.
    snapshot: {
      title: { type: String, default: '' },
      body: { type: String, default: '' },
      mediaUrls: [{ type: String }],
      capturedAt: { type: Date, default: Date.now },
    },

    // Classifier output, stored even when no action is taken — without it there
    // is no data to calibrate thresholds against later.
    classificationScores: { type: mongoose.Schema.Types.Mixed, default: null },

    // Prevents two moderators actioning the same item.
    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    claimedAt: { type: Date, default: null },

    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },
    resolution: { type: String, default: '', maxlength: 1000 },
    // 'restored' | 'removed' | 'dismissed' | 'escalated'
    outcome: { type: String, default: '' },
  },
  { timestamps: true }
);

// One report per person per item. This is what makes the threshold count
// DISTINCT reporters rather than clicks — without it, one angry user hides
// anything they like.
reportSchema.index(
  { targetType: 1, target: 1, reporter: 1 },
  { unique: true, partialFilterExpression: { reporter: { $type: 'objectId' } } }
);

// The per-space moderation queue, newest and most severe first.
reportSchema.index({ space: 1, status: 1, severity: -1, createdAt: -1 });
// The global admin queue.
reportSchema.index({ status: 1, severity: -1, createdAt: -1 });
// All reports against one item, for the review view.
reportSchema.index({ targetType: 1, target: 1, status: 1 });
// Report-brigading detection: someone filing many reports in a short window.
reportSchema.index({ reporter: 1, createdAt: -1 });
// "Show me everything reported against this author".
reportSchema.index({ contentAuthor: 1, createdAt: -1 });

/** How many DISTINCT people have an open report against this item. */
reportSchema.statics.distinctReporterCount = async function distinctReporterCount(targetType, target) {
  const reporters = await this.distinct('reporter', {
    targetType,
    target,
    status: REPORT_STATUS.OPEN,
  });
  return reporters.filter(Boolean).length;
};

/** The highest severity anyone has reported this item under. */
reportSchema.statics.peakSeverity = async function peakSeverity(targetType, target) {
  const [row] = await this.aggregate([
    { $match: { targetType, target, status: REPORT_STATUS.OPEN } },
    { $group: { _id: null, severity: { $max: '$severity' } } },
  ]);
  return row ? row.severity : 0;
};

module.exports = mongoose.model('Report', reportSchema);
