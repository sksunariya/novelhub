const mongoose = require('mongoose');
const { WEBHOOK_STATUS } = require('../config/constants');

// Every inbound webhook lands here before any business logic runs.
//
// The unique eventId is where replays die — PayPal redelivers aggressively, and
// this makes a replay storm a no-op instead of a payout storm. It also makes
// reprocessing a failed event a one-click admin action rather than a support
// ticket.
const webhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, default: 'paypal' },
    eventId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true },
    resourceId: { type: String, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },

    signatureVerified: { type: Boolean, default: false },
    status: { type: String, enum: Object.values(WEBHOOK_STATUS), default: WEBHOOK_STATUS.RECEIVED },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    processedAt: { type: Date },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  },
  { timestamps: true }
);

webhookEventSchema.index({ status: 1, createdAt: -1 });
webhookEventSchema.index({ eventType: 1, createdAt: -1 });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
