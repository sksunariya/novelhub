const mongoose = require('mongoose');
const softDelete = require('./plugins/softDelete');

// Post and user flair within a space.
//
// A separate collection rather than an array on Space, because flair carries a
// use count that is written on every post — an embedded array would rewrite the
// whole space document on every submission.

const flairSchema = new mongoose.Schema(
  {
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
    kind: { type: String, enum: ['post', 'user'], required: true },

    text: { type: String, required: true, trim: true, maxlength: 64 },
    // Contrast-validated at save time, same as the space accent — a flair pill
    // that cannot be read is a flair that does not work.
    textColor: { type: String, default: '#ffffff' },
    bgColor: { type: String, default: '#3f3f46' },

    // Only moderators may assign this one. Used for "Verified", "Announcement",
    // "Solved" — labels that mean nothing if anyone can self-apply them.
    modOnly: { type: Boolean, default: false },

    order: { type: Number, default: 0 },
    useCount: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

flairSchema.index({ space: 1, kind: 1, order: 1 });
// Duplicate flair text within one space and kind is always a mistake.
flairSchema.index(
  { space: 1, kind: 1, text: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

flairSchema.plugin(softDelete);

module.exports = mongoose.model('Flair', flairSchema);
