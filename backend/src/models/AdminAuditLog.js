const mongoose = require('mongoose');

// Immutable trail of admin actions. Deliberately does NOT use the softDelete
// plugin — an audit log that can be deleted is not an audit log.
const adminAuditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorLabel: { type: String, default: '' }, // survives the actor being removed
    action: { type: String, required: true }, // 'settings.update', 'wallet.adjust', …
    entity: { type: String, default: '' }, // 'setting', 'wallet', 'chapter', …
    entityId: { type: String, default: '' },
    changes: [
      {
        _id: false,
        key: { type: String, required: true },
        before: mongoose.Schema.Types.Mixed,
        after: mongoose.Schema.Types.Mixed,
      },
    ],
    note: { type: String, default: '', maxlength: 1000 },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

adminAuditLogSchema.index({ createdAt: -1 });
adminAuditLogSchema.index({ action: 1, createdAt: -1 });
adminAuditLogSchema.index({ actor: 1, createdAt: -1 });
adminAuditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
adminAuditLogSchema.index({ 'changes.key': 1, createdAt: -1 });

// Records are written once and never mutated.
adminAuditLogSchema.pre('findOneAndUpdate', function blockUpdate(next) {
  next(Object.assign(new Error('Audit log entries are immutable'), { status: 400 }));
});
adminAuditLogSchema.pre('updateOne', function blockUpdate(next) {
  next(Object.assign(new Error('Audit log entries are immutable'), { status: 400 }));
});

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
