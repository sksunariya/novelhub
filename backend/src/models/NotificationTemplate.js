const mongoose = require('mongoose');
const { NOTIFICATION_CHANNELS } = require('../config/constants');

// Admin-editable message copy.
//
// Without this, changing "You received 100 credits" requires a deploy. Every
// credit event resolves its copy through here, falling back to a built-in
// default when no template has been saved.
const notificationTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // matches a NOTIFICATION_TYPES value
    channel: { type: String, enum: Object.values(NOTIFICATION_CHANNELS), required: true },
    enabled: { type: Boolean, default: true },
    subject: { type: String, default: '', maxlength: 200 },
    body: { type: String, default: '', maxlength: 5000 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

notificationTemplateSchema.index({ key: 1, channel: 1 }, { unique: true });

// {{variable}} substitution. Unknown variables render empty rather than
// leaking the raw token into a user-facing message.
notificationTemplateSchema.statics.render = function render(text, vars = {}) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? '' : String(vars[name])
  );
};

module.exports = mongoose.model('NotificationTemplate', notificationTemplateSchema);
