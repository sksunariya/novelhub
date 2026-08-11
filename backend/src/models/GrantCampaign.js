const mongoose = require('mongoose');
const { NOTIFICATION_CHANNELS } = require('../config/constants');

const audienceRuleSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ['all', 'role', 'specific', 'csv_emails', 'query'],
      default: 'all',
    },
    role: { type: String, enum: ['user', 'admin', null], default: null },
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    emails: [{ type: String, lowercase: true, trim: true }],

    query: {
      registeredBefore: Date,
      registeredAfter: Date,
      lastActiveBefore: Date,
      lastActiveAfter: Date,
      inactiveForDays: Number,
      emailVerified: Boolean,
      country: [String],
      hasEverPurchased: Boolean,
      minLifetimeSpendUsdCents: Number,
      maxLifetimeSpendUsdCents: Number,
      balanceBelow: Number,
      balanceAbove: Number,
      hasNovelInLibrary: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Novel' }],
      hasReadNovel: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Novel' }],
      minChaptersRead: Number,
      minChaptersUnlocked: Number,
      minCommentCount: Number,
      minReviewCount: Number,
      receivedGrantCampaign: { type: mongoose.Schema.Types.ObjectId, ref: 'GrantCampaign' },
      notReceivedGrantCampaign: { type: mongoose.Schema.Types.ObjectId, ref: 'GrantCampaign' },
    },

    limit: { type: Number, default: 0 }, // 0 = everyone matching
    orderBy: { type: String, enum: ['createdAt', 'lastActive', 'lifetimeSpend', 'random'], default: 'createdAt' },
    excludeUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { _id: false }
);

const grantCampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    internalNote: { type: String, default: '', maxlength: 1000 },

    amount: { type: Number, required: true, min: 0 },
    amountMode: {
      type: String,
      enum: ['fixed', 'match_percent', 'top_up_to'],
      default: 'fixed',
      // fixed         → everyone gets `amount`
      // match_percent → amount% of their lifetime spend, as a loyalty rebate
      // top_up_to     → bring every balance up to `amount`, so nobody sits below it
    },
    maxPerUser: { type: Number, default: 0, min: 0 }, // caps the computed modes

    audience: { type: audienceRuleSchema, default: () => ({}) },

    schedule: {
      mode: { type: String, enum: ['immediate', 'scheduled', 'recurring'], default: 'immediate' },
      runAt: { type: Date, default: null },
      cron: { type: String, default: '' },
      endsAt: { type: Date, default: null },
    },

    expiryDays: { type: Number, default: 0, min: 0 },

    notify: {
      enabled: { type: Boolean, default: true },
      channels: [{ type: String, enum: Object.values(NOTIFICATION_CHANNELS) }],
      title: { type: String, default: '', maxlength: 200 },
      message: { type: String, default: '', maxlength: 1000 },
    },

    status: {
      type: String,
      enum: ['draft', 'scheduled', 'running', 'completed', 'partially_failed', 'cancelled', 'reversed'],
      default: 'draft',
    },
    lastDryRunAt: { type: Date, default: null },
    lastDryRunCount: { type: Number, default: 0 },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    stats: {
      targeted: { type: Number, default: 0 },
      granted: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      creditsIssued: { type: Number, default: 0 },
    },

    // Persisted so a crash mid-campaign resumes instead of restarting.
    cursor: {
      lastUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
      processedCount: { type: Number, default: 0 },
    },
    runIndex: { type: Number, default: 0 },
    runs: [
      {
        _id: false,
        runIndex: Number,
        startedAt: Date,
        finishedAt: Date,
        stats: mongoose.Schema.Types.Mixed,
        error: String,
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

grantCampaignSchema.index({ status: 1, 'schedule.runAt': 1 });
grantCampaignSchema.index({ createdAt: -1 });

module.exports = mongoose.model('GrantCampaign', grantCampaignSchema);
