const mongoose = require('mongoose');

// The internal complaints mechanism the DSA requires alongside a statement of
// reasons.
//
// TWO THINGS THAT ARE EASY TO GET WRONG:
//
//   1. BOTH SIDES CAN APPEAL. The author of removed content, and the person
//      whose report was dismissed. A system that only lets authors appeal is
//      half a mechanism.
//   2. APPEALS GET HUMAN REVIEW. That is the entire point — an automated
//      decision reviewed automatically is the same decision. `reviewedBy` is
//      required to close one, and there is no automated-resolution path.

const APPEAL_STATUS = {
  OPEN: 'open',
  UPHELD: 'upheld', // the original decision stands
  OVERTURNED: 'overturned', // the decision was wrong; content restored
  PARTIAL: 'partial', // e.g. restored but with a warning
  WITHDRAWN: 'withdrawn',
  EXPIRED: 'expired',
};

const appealSchema = new mongoose.Schema(
  {
    statement: { type: mongoose.Schema.Types.ObjectId, ref: 'StatementOfReasons', default: null },
    report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null },

    appellant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 'author' appeals a removal; 'reporter' appeals a dismissal.
    appellantRole: { type: String, enum: ['author', 'reporter'], required: true },

    targetType: { type: String, required: true },
    target: { type: mongoose.Schema.Types.ObjectId, required: true },
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', default: null },

    reason: { type: String, required: true, maxlength: 4000 },

    status: { type: String, enum: Object.values(APPEAL_STATUS), default: APPEAL_STATUS.OPEN },

    // Required to close an appeal. There is deliberately no path that resolves
    // one without a person.
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', maxlength: 4000 },
    outcomeExplanation: { type: String, default: '', maxlength: 4000 },

    // A moderator must not review an appeal against their own decision.
    originalDecisionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One appeal per person per decision. Otherwise the queue is a resubmission
// loop rather than a review.
appealSchema.index(
  { statement: 1, appellant: 1 },
  { unique: true, partialFilterExpression: { statement: { $type: 'objectId' } } }
);
appealSchema.index({ status: 1, createdAt: 1 }); // oldest first — fairness
appealSchema.index({ space: 1, status: 1, createdAt: 1 });
appealSchema.index({ appellant: 1, createdAt: -1 });

/**
 * May this person review this appeal?
 *
 * Nobody reviews an appeal against their own decision. Without this the
 * mechanism is a formality — the same person confirming they were right.
 */
appealSchema.methods.canBeReviewedBy = function canBeReviewedBy(user) {
  if (!user) return false;
  if (!this.originalDecisionBy) return true;
  return String(this.originalDecisionBy) !== String(user._id);
};

appealSchema.statics.STATUS = APPEAL_STATUS;

module.exports = mongoose.model('Appeal', appealSchema);
