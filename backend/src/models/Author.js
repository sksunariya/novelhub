const mongoose = require('mongoose');
const softDelete = require('./plugins/softDelete');

// An author, for grouping earnings.
//
// Deliberately not a payouts system: deals are negotiated off-platform, so
// there is no payout method, no tax form, no statement generation. What this
// exists for is making "what has this author earned" a question with one
// answer — `Novel.author` is free text, so "Sci-Fi Sam" and "Sci Fi Sam"
// would otherwise split one person's earnings across two rows.
const authorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    email: { type: String, lowercase: true, trim: true, default: '' },
    // Optional link if the author also reads on the platform.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Free text on purpose. The terms are whatever was agreed in conversation;
    // encoding them as structured fields would imply the platform enforces
    // them, which it does not.
    dealTerms: { type: String, default: '', maxlength: 2000 },
    notes: { type: String, default: '', maxlength: 2000 },

    status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active' },
  },
  { timestamps: true }
);

authorSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
authorSchema.index({ status: 1, name: 1 });

authorSchema.plugin(softDelete);

module.exports = mongoose.model('Author', authorSchema);
