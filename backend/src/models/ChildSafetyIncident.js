const mongoose = require('mongoose');

// Child safety incidents.
//
// THIS IS NOT A MODERATION RECORD. It is a legal preservation record, and it is
// deliberately outside the normal moderation flow for one reason:
//
//   A MODERATOR MUST NOT BE ABLE TO DELETE THEIR WAY OUT OF A PRESERVATION
//   OBLIGATION.
//
// US electronic service providers must report apparent CSAM to NCMEC's
// CyberTipline as soon as reasonably possible after obtaining actual knowledge,
// and must PRESERVE the material, its metadata, the uploader's account
// information and IP addresses (18 U.S.C. § 2258A, extended by the REPORT Act).
// If this were a `Report` with a special reason, every existing moderation tool
// — bulk dismiss, bulk delete, a space owner clearing their queue — would be a
// path to destroying evidence.
//
// So: no softDelete plugin, no delete route, immutable once written, and
// visible only to an account holding the CHILD_SAFETY elevated permission.
// Not to space moderators. Not to ordinary admins.
//
// The content itself is NOT deleted either. It is access-restricted at the
// storage layer and the record points at it. Deleting it would destroy the
// evidence the law requires be preserved, and would also destroy the hash that
// prevents the same file being re-uploaded.

const INCIDENT_STATUS = {
  DETECTED: 'detected', // matched, quarantined, not yet reviewed
  CONFIRMED: 'confirmed', // reviewed and confirmed by a safety reviewer
  REPORTED: 'reported', // submitted to NCMEC
  FALSE_POSITIVE: 'false_positive', // reviewed and cleared
};

const childSafetyIncidentSchema = new mongoose.Schema(
  {
    status: { type: String, enum: Object.values(INCIDENT_STATUS), default: INCIDENT_STATUS.DETECTED },

    // What matched.
    matchType: { type: String, default: '' }, // 'photodna' | 'safer' | 'manual'
    matchConfidence: { type: Number, default: 0 },
    perceptualHash: { type: String, default: '' },
    sha256: { type: String, default: '' },

    // Where the file is held. Access-restricted, never public, never deleted
    // while the incident is open.
    storageKey: { type: String, default: '' },
    mime: { type: String, default: '' },
    bytes: { type: Number, default: 0 },

    // Everything § 2258A requires be preserved about the uploader.
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploaderSnapshot: {
      username: { type: String, default: '' },
      email: { type: String, default: '' },
      createdAt: { type: Date, default: null },
    },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },

    // Context, if the upload reached a post before quarantine.
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', default: null },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },

    // Reporting trail.
    reportedAt: { type: Date, default: null },
    reportReference: { type: String, default: '' }, // NCMEC report id
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', maxlength: 2000 },

    // Explicit, and deliberately not defaulted to a date. Preserved material is
    // released only by a documented decision, never by a retention sweep that
    // happens to run.
    preservationUntil: { type: Date, default: null },
    preservationReleasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

childSafetyIncidentSchema.index({ status: 1, createdAt: -1 });
childSafetyIncidentSchema.index({ uploader: 1, createdAt: -1 });
// Re-upload detection: the same file must be caught without a second vendor call.
childSafetyIncidentSchema.index({ sha256: 1 });
childSafetyIncidentSchema.index({ perceptualHash: 1 });

// No softDelete plugin. Deliberate — see the header.

// Nothing may remove an incident. Not a moderator, not an admin, not a cascade
// from deleting the post or the user. `deleteMany` is what a bulk cleanup
// script would reach for, so it is blocked too.
const blockDelete = function blockDelete(next) {
  next(Object.assign(new Error('Child safety incidents cannot be deleted'), { status: 403 }));
};
childSafetyIncidentSchema.pre('deleteOne', blockDelete);
childSafetyIncidentSchema.pre('deleteMany', blockDelete);
childSafetyIncidentSchema.pre('findOneAndDelete', blockDelete);
childSafetyIncidentSchema.pre('remove', blockDelete);

childSafetyIncidentSchema.statics.STATUS = INCIDENT_STATUS;

module.exports = mongoose.model('ChildSafetyIncident', childSafetyIncidentSchema);
