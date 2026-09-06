const mongoose = require('mongoose');
const { NOTIFICATION_CHANNELS } = require('../config/constants');

const campaignSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    link: { type: String, default: '' },
    // 'emails' is the marketing audience: an explicit list of addresses, which
    // may include people who have never registered. Every other value resolves
    // to registered users through a User query.
    targetAudience: {
      type: String,
      enum: ['all', 'user', 'admin', 'specific', 'emails'],
      default: 'all',
    },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    channels: [{ type: String, enum: Object.values(NOTIFICATION_CHANNELS) }],
    recipientCount: { type: Number, default: 0 },

    // ---------------------------------------------------------------- 'emails'
    // How the admin supplied the list. Worth recording separately from the
    // addresses: "who uploaded a CSV of 4,000 strangers" is the question asked
    // when a spam complaint arrives.
    recipientSource: { type: String, enum: ['manual', 'csv', 'mixed'], default: null },

    // The exact normalized list that was dispatched. select:false because a
    // 5,000-entry array on every row would make the audit table's response
    // megabytes wide; ask for it explicitly with .select('+recipientEmails')
    // when auditing one campaign.
    recipientEmails: { type: [String], default: undefined, select: false },

    // Breakdown of what the address list resolved to, so the audit row can say
    // "1,204 sent: 300 members, 904 external" without re-deriving it.
    matchedUserCount: { type: Number, default: 0 },
    externalCount: { type: Number, default: 0 },
    // Addresses belonging to a banned or deleted account. Counted, never sent
    // to — a closed account is an opt-out, whoever typed the address.
    suppressedCount: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

campaignSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Campaign', campaignSchema);
