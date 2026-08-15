const mongoose = require('mongoose');

// Poll votes.
//
// A separate collection rather than an array on the post, for the same reason
// votes are: an array would rewrite the whole post document on every response
// and cap the poll at whatever fits in 16 MB.
//
// Tallies live denormalized on Post.poll.options[].votes, rebuildable from here.

const pollVoteSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Option subdocument ids. An array because a poll may allow multiple.
    options: [{ type: mongoose.Schema.Types.ObjectId }],
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

// One response per user per poll — what makes the endpoint idempotent.
pollVoteSchema.index({ post: 1, user: 1 }, { unique: true });
pollVoteSchema.index({ post: 1 });

module.exports = mongoose.model('PollVote', pollVoteSchema);
