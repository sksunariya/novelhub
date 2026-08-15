const mongoose = require('mongoose');

// Edit history for posts and comments.
//
// WRITTEN FROM THE FIRST EDIT, NOT ADDED LATER. Edit history cannot be
// reconstructed retroactively — the previous text is gone the moment it is
// overwritten. Starting on day one costs one insert per edit; starting later
// means every edit before that point is permanently unrecoverable.
//
// A public diff is also the strongest available deterrent to the bait-and-
// switch edit: posting something agreeable, collecting upvotes, then rewriting
// it into something else. The title lock in postService handles the worst case;
// this handles the rest.
//
// No softDelete plugin. A revision that can be deleted defeats the purpose, and
// deleting the parent post already hides the whole thread.

const postRevisionSchema = new mongoose.Schema(
  {
    targetType: { type: String, enum: ['post', 'comment'], required: true },
    target: { type: mongoose.Schema.Types.ObjectId, required: true },

    // Who made this edit. Usually the author, but a moderator with
    // managePosts can edit too, and that distinction matters in a dispute.
    editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    editorRole: { type: String, default: 'author' },

    // The content AS IT WAS BEFORE this edit. Storing the previous state rather
    // than the new one means the current document is always the latest version
    // and the revisions read as a backwards history — no reconstruction needed
    // to answer "what did it say before?".
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    bodyText: { type: String, default: '' },

    revision: { type: Number, default: 1 },
    reason: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The history view for one item, newest first.
postRevisionSchema.index({ targetType: 1, target: 1, createdAt: -1 });
// "Show me everything this user has quietly rewritten" — a moderation signal.
postRevisionSchema.index({ editor: 1, createdAt: -1 });

// Immutable, same as AdminAuditLog. A history that can be rewritten is not a
// history.
postRevisionSchema.pre('findOneAndUpdate', function blockUpdate(next) {
  next(Object.assign(new Error('Revisions are immutable'), { status: 400 }));
});
postRevisionSchema.pre('updateOne', function blockUpdate(next) {
  next(Object.assign(new Error('Revisions are immutable'), { status: 400 }));
});

/**
 * Record the pre-edit state.
 *
 * Called before the document is mutated, so `previous` is still the old
 * content. Failing to write a revision must not fail the edit — the user's
 * change is the primary action — so callers treat this as best-effort.
 */
postRevisionSchema.statics.record = async function record({
  targetType,
  target,
  editor,
  editorRole = 'author',
  previous = {},
  reason = '',
}) {
  const count = await this.countDocuments({ targetType, target });
  return this.create({
    targetType,
    target,
    editor,
    editorRole,
    title: previous.title || '',
    body: previous.body || '',
    bodyText: previous.bodyText || '',
    revision: count + 1,
    reason,
  });
};

module.exports = mongoose.model('PostRevision', postRevisionSchema);
