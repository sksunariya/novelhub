const mongoose = require('mongoose');

// The per-space moderation log.
//
// DELIBERATELY SEPARATE FROM AdminAuditLog. Conflating them means either
// community moderators can read the site-wide audit trail — which contains
// settings changes, wallet adjustments and other people's spaces — or site
// admin actions vanish from the community's own record.
//
// Site-admin actions are written to BOTH. A community must be able to see that
// an admin acted in their space; opacity there is how trust in moderation dies.
//
// Immutable, same as AdminAuditLog. A moderation log that can be edited is not
// a log.

const modActionSchema = new mongoose.Schema(
  {
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },

    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Survives the account being deleted or anonymised — an audit entry that
    // loses its actor is not an audit entry.
    actorLabel: { type: String, default: '' },
    actorRole: { type: String, default: '' }, // 'owner' | 'moderator' | 'admin' | 'system'

    action: { type: String, required: true }, // 'post.remove', 'member.ban', …
    targetType: { type: String, default: '' },
    target: { type: mongoose.Schema.Types.ObjectId, default: null },
    targetLabel: { type: String, default: '' },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    reason: { type: String, default: '', maxlength: 1000 },
    ruleId: { type: String, default: '' },
    // Private to the mod team. Never rendered in a public mod log.
    note: { type: String, default: '', maxlength: 2000 },

    changes: [
      {
        _id: false,
        key: { type: String },
        before: mongoose.Schema.Types.Mixed,
        after: mongoose.Schema.Types.Mixed,
      },
    ],

    statement: { type: mongoose.Schema.Types.ObjectId, ref: 'StatementOfReasons', default: null },
    // False for anything a space opts to keep internal even with a public log.
    publiclyVisible: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

modActionSchema.index({ space: 1, createdAt: -1 });
modActionSchema.index({ space: 1, action: 1, createdAt: -1 });
modActionSchema.index({ actor: 1, createdAt: -1 });
// "Show me everything done to this user" — the view an appeal needs.
modActionSchema.index({ targetUser: 1, createdAt: -1 });
// How an admin finds a moderator abusing their space. No other view answers it.
modActionSchema.index({ actorRole: 1, createdAt: -1 });

const blockUpdate = function blockUpdate(next) {
  next(Object.assign(new Error('Moderation log entries are immutable'), { status: 400 }));
};
modActionSchema.pre('findOneAndUpdate', blockUpdate);
modActionSchema.pre('updateOne', blockUpdate);
modActionSchema.pre('updateMany', blockUpdate);

module.exports = mongoose.model('ModAction', modActionSchema);
