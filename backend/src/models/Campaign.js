const mongoose = require('mongoose');
const { NOTIFICATION_CHANNELS } = require('../config/constants');

const campaignSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    link: { type: String, default: '' },
    targetAudience: { type: String, enum: ['all', 'user', 'admin', 'specific'], default: 'all' },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    channels: [{ type: String, enum: Object.values(NOTIFICATION_CHANNELS) }],
    recipientCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

campaignSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Campaign', campaignSchema);
