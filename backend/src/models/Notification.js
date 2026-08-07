const mongoose = require('mongoose');
const { NOTIFICATION_TYPES, NOTIFICATION_CHANNELS } = require('../config/constants');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: Object.values(NOTIFICATION_TYPES), required: true },
    message: { type: String, required: true, maxlength: 500 },
    link: { type: String, default: '' },
    read: { type: Boolean, default: false },
    channels: [{ type: String, enum: Object.values(NOTIFICATION_CHANNELS) }],
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
