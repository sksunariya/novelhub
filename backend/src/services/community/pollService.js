// Poll responses.
//
// The rules that must be enforced server-side, because enforcing them only in
// the UI is not enforcing them:
//
//   - a poll closed by time accepts nothing further
//   - `hideResultsUntilEnd` must strip the tallies from the RESPONSE, not just
//     hide them in the client
//   - one response per user, enforced by a unique index rather than a check

const Post = require('../../models/Post');
const PollVote = require('../../models/PollVote');
const counterService = require('../counterService');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const isClosed = (post) =>
  Boolean(post.poll && post.poll.endsAt && new Date(post.poll.endsAt) <= new Date());

/**
 * Record or change a response.
 *
 * Changing a vote adjusts both directions, so a user switching options does not
 * inflate the total.
 */
const vote = async ({ post, user, optionIds, perms }) => {
  if (!post.poll || !post.poll.options || !post.poll.options.length) throw fail('This post has no poll', 400);
  if (isClosed(post)) throw fail('This poll has closed', 409);
  if (!perms.can.vote) throw fail('You cannot vote here', 403);

  const valid = new Set(post.poll.options.map((option) => String(option._id)));
  const chosen = [...new Set((optionIds || []).map(String))].filter((id) => valid.has(id));

  if (!chosen.length) throw fail('Choose an option', 400);
  if (!post.poll.allowMultiple && chosen.length > 1) throw fail('This poll allows one choice', 400);

  const existing = await PollVote.findOne({ post: post._id, user: user._id });
  const previous = existing ? existing.options.map(String) : [];

  const added = chosen.filter((id) => !previous.includes(id));
  const removed = previous.filter((id) => !chosen.includes(id));
  if (!added.length && !removed.length) return { changed: false };

  await PollVote.findOneAndUpdate(
    { post: post._id, user: user._id },
    { $set: { options: chosen } },
    { upsert: true }
  );

  const inc = {};
  for (const id of added) inc[`poll.options.$[o${id}].votes`] = 1;
  for (const id of removed) inc[`poll.options.$[o${id}].votes`] = -1;

  await Post.updateOne({ _id: post._id }, { $inc: inc }, {
    arrayFilters: [...added, ...removed].map((id) => ({ [`o${id}._id`]: id })),
  });

  // Total voters moves only when someone responds for the first time.
  if (!existing) await counterService.increment('post', post._id, { 'poll.totalVoters': 1 });

  return { changed: true, options: chosen };
};

/**
 * Shape a poll for the wire.
 *
 * Strips tallies while results are hidden. Sending them with a "don't show
 * this" flag would leak them to anyone who opens the network tab.
 */
const serializePoll = (post, viewerResponse = null) => {
  if (!post.poll || !post.poll.options) return undefined;
  const closed = isClosed(post);
  const hidden = post.poll.hideResultsUntilEnd && !closed;

  return {
    options: post.poll.options.map((option) => ({
      id: option._id,
      text: option.text,
      votes: hidden ? undefined : option.votes,
    })),
    allowMultiple: post.poll.allowMultiple,
    endsAt: post.poll.endsAt,
    closed,
    resultsHidden: hidden,
    totalVoters: hidden ? undefined : post.poll.totalVoters,
    viewerResponse: viewerResponse ? viewerResponse.options : null,
  };
};

/** Job: finalize polls past their end time so the UI has a definite state. */
const registerJob = (dispatcher) => {
  dispatcher.register('poll.close', async () => {
    const closed = await Post.updateMany(
      { 'poll.endsAt': { $lte: new Date() }, 'poll.closedAt': null },
      { $set: { 'poll.closedAt': new Date() } }
    );
    return { closed: closed.modifiedCount || 0 };
  });
};

module.exports = { vote, serializePoll, isClosed, registerJob };
