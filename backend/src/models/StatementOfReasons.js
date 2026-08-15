const mongoose = require('mongoose');

// DSA Article 17 — a statement of reasons.
//
// EU law requires a clear and specific explanation to the affected user EVERY
// time content is removed or restricted, an account is suspended, or a payment
// is restricted. Not a courtesy — an obligation, with a machine-readable copy
// owed to the Commission's Transparency Database.
//
// WHY THIS IS A MODEL AND NOT A `reason` STRING ON THE POST:
//
//   1. It cannot be added retroactively. Every action taken before the record
//      exists is permanently undocumented, and "we'll add it when we need it"
//      means the first year of enforcement has no defensible record.
//   2. The required fields are structured — legal ground vs terms ground, which
//      specific rule, whether detection was automated, territorial scope. A
//      free-text string cannot be queried, counted, or exported.
//   3. A transparency report is an aggregate over these. Without the structure
//      there is nothing to aggregate.
//
// Immutable. A statement that can be edited after the fact is not a record of
// what was decided; it is a record of what someone later wished had been
// decided.

const GROUNDS = {
  ILLEGAL_CONTENT: 'illegal_content', // breaks the law
  TERMS_VIOLATION: 'terms_violation', // breaks our rules
};

const RESTRICTION_TYPES = {
  CONTENT_REMOVED: 'content_removed',
  CONTENT_HIDDEN: 'content_hidden',
  CONTENT_DEMOTED: 'content_demoted',
  ACCOUNT_SUSPENDED: 'account_suspended',
  ACCOUNT_BANNED: 'account_banned',
  SPACE_BANNED: 'space_banned',
  FEATURE_RESTRICTED: 'feature_restricted',
};

const DETECTION = {
  USER_REPORT: 'user_report',
  TRUSTED_FLAGGER: 'trusted_flagger',
  AUTOMATED: 'automated',
  MODERATOR: 'moderator',
  LEGAL_ORDER: 'legal_order',
};

const statementSchema = new mongoose.Schema(
  {
    // Who it happened to, and what it happened to.
    affectedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, required: true }, // 'post' | 'comment' | 'user' | 'space'
    target: { type: mongoose.Schema.Types.ObjectId, required: true },
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', default: null },

    restrictionType: { type: String, enum: Object.values(RESTRICTION_TYPES), required: true },

    // Illegal, or against our terms. The distinction drives what else is
    // required — an illegal-content ground needs a legal basis.
    ground: { type: String, enum: Object.values(GROUNDS), required: true },
    legalBasis: { type: String, default: '' }, // when ground is illegal_content
    // The specific rule, by stable ID. Rules that exist only as prose cannot be
    // cited consistently, counted, or appealed against — which is why
    // Space.rules carries a permanent ruleId.
    ruleId: { type: String, default: '' },
    ruleText: { type: String, default: '' }, // as it read AT THE TIME

    // "Whether the decision was taken on the basis of automated means" is an
    // explicit Article 17 disclosure, not an implementation detail.
    automated: { type: Boolean, default: false },
    automatedDetail: {
      classifier: { type: String, default: '' },
      score: { type: Number, default: 0 },
      threshold: { type: Number, default: 0 },
    },
    detectionMethod: { type: String, enum: Object.values(DETECTION), required: true },

    // Free-text explanation actually shown to the user. Structured fields are
    // for reporting; this is for the person.
    explanation: { type: String, default: '', maxlength: 4000 },

    // Content as it was when actioned, so an appeal reviewer sees what the
    // decision was actually about.
    contentSnapshot: {
      title: { type: String, default: '' },
      body: { type: String, default: '' },
      capturedAt: { type: Date, default: Date.now },
    },

    territorialScope: { type: String, default: 'global' },

    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedByRole: { type: String, default: '' }, // 'system' | 'moderator' | 'admin'

    // The user must be told they can appeal, and by when.
    appealable: { type: Boolean, default: true },
    appealDeadline: { type: Date, default: null },
    notifiedAt: { type: Date, default: null },

    // Pseudonymised submission to the Commission's database.
    submittedToDatabaseAt: { type: Date, default: null },
    databaseReference: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

statementSchema.index({ affectedUser: 1, createdAt: -1 });
statementSchema.index({ targetType: 1, target: 1 });
statementSchema.index({ space: 1, createdAt: -1 });
// The transparency report aggregates over these.
statementSchema.index({ ground: 1, restrictionType: 1, createdAt: -1 });
statementSchema.index({ automated: 1, createdAt: -1 });
// Sweep for statements not yet submitted to the Transparency Database.
statementSchema.index({ submittedToDatabaseAt: 1 }, { sparse: true });

// Immutable, same as AdminAuditLog. Only the two delivery timestamps may be
// set afterwards, and those go through the statics below rather than a general
// update path.
const blockUpdate = function blockUpdate(next) {
  const update = this.getUpdate() || {};
  const setKeys = Object.keys(update.$set || {});
  const allowed = ['notifiedAt', 'submittedToDatabaseAt', 'databaseReference'];
  if (setKeys.length && setKeys.every((key) => allowed.includes(key))) return next();
  return next(Object.assign(new Error('Statements of reasons are immutable'), { status: 400 }));
};
statementSchema.pre('findOneAndUpdate', blockUpdate);
statementSchema.pre('updateOne', blockUpdate);
statementSchema.pre('updateMany', blockUpdate);

statementSchema.statics.GROUNDS = GROUNDS;
statementSchema.statics.RESTRICTION_TYPES = RESTRICTION_TYPES;
statementSchema.statics.DETECTION = DETECTION;

module.exports = mongoose.model('StatementOfReasons', statementSchema);
