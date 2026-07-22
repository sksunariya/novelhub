const mongoose = require('mongoose');
const { VIEW_TARGET_TYPES, VIEW_DEDUP_WINDOW_SECONDS } = require('../config/constants');

const viewEventSchema = new mongoose.Schema({
  targetType: { type: String, enum: Object.values(VIEW_TARGET_TYPES), required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  viewerKey: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

viewEventSchema.index({ targetType: 1, targetId: 1, viewerKey: 1 }, { unique: true });
viewEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: VIEW_DEDUP_WINDOW_SECONDS });

module.exports = mongoose.model('ViewEvent', viewEventSchema);
