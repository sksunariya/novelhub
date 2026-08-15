// Comment threading.
//
// THE PROBLEM: a post with 10,000 comments cannot ship as one payload, and a
// naive tree fetch is N recursive queries — one per node.
//
// THE SHAPE OF THE SOLUTION, two queries regardless of tree size:
//
//   1. Top-level comments, sorted by the requested sort, limited to a page.
//      This is what the user actually chose an ordering for.
//   2. Their descendants, in one indexed range scan on { post, sortPath },
//      bounded by depth and by a total node cap.
//
// Everything deeper loads on demand by parent. The client receives a flat array
// with `depth` and `parent` and assembles the tree — sending nested JSON wastes
// bytes and makes pagination inside a thread awkward.

const PostComment = require('../../models/PostComment');
const PostRevision = require('../../models/PostRevision');
const Post = require('../../models/Post');
const User = require('../../models/User');
const counterService = require('../counterService');
const jobDispatcher = require('../jobDispatcher');
const sanitizeHtml = require('../../utils/sanitizeHtml');
const ranking = require('./rankingService');
const { POST_STATUS, COMMENT_SORTS, PUBLIC_USER_FIELDS } = require('../../config/constants');

const fail = (message, status = 400, details = null) =>
  Object.assign(new Error(message), { status, details });

const SORT_SPEC = {
  [COMMENT_SORTS.BEST]: { bestScore: -1, _id: -1 },
  [COMMENT_SORTS.TOP]: { score: -1, _id: -1 },
  [COMMENT_SORTS.NEW]: { createdAt: -1, _id: -1 },
  [COMMENT_SORTS.OLD]: { createdAt: 1, _id: 1 },
  [COMMENT_SORTS.CONTROVERSIAL]: { controversyScore: -1, _id: -1 },
};

const MENTION_PATTERN = /(^|[^\w/])@([A-Za-z0-9_-]{3,30})\b/g;

/**
 * Extract @mentions, resolved to real accounts.
 *
 * Parsed once at write time and stored as ids: re-parsing on render is wasteful
 * and, more importantly, breaks the moment a mentioned user is renamed.
 *
 * The leading `[^\w/]` guard stops an email address or a URL path from being
 * read as a mention.
 */
const resolveMentions = async (text, { limit = 10 } = {}) => {
  if (!text) return [];
  const names = new Set();
  let match = MENTION_PATTERN.exec(text);
  while (match && names.size < limit) {
    names.add(match[2]);
    match = MENTION_PATTERN.exec(text);
  }
  MENTION_PATTERN.lastIndex = 0;
  if (!names.size) return [];

  const users = await User.find({ username: { $in: [...names] } })
    .select('_id')
    .lean();
  return users.map((u) => u._id);
};

/**
 * Create a comment or reply.
 *
 * The sortPath is derived from the parent's path plus this comment's sibling
 * rank at insertion. The rank comes from the parent's `directReplyCount`, which
 * is incremented atomically — two simultaneous replies get distinct ranks
 * without a transaction. A collision would only reorder siblings, never lose
 * one, because `_id` is the tiebreak everywhere the path is used.
 */
const create = async ({ user, post, space, input, settings, perms }) => {
  if (!perms.can.comment) {
    throw fail(perms.reason === 'banned' ? 'You are banned from this space' : 'You cannot comment here', 403);
  }
  if (post.locked && !perms.can.managePosts) throw fail('Comments are locked on this post', 403);
  if (post.status !== POST_STATUS.PUBLISHED) throw fail('This post is not accepting comments', 403);

  const karma = (user.karma && user.karma.total) || 0;
  const minKarma = settings.get('spaces.posting.minKarmaToComment');
  if (minKarma > 0 && karma < minKarma) throw fail(`You need ${minKarma} karma to comment here`, 403);

  const { html, text } = sanitizeHtml.process(input.body || '', 'comment');
  if (!text.trim()) throw fail('Write something first', 400, { field: 'body' });

  const maxLength = settings.get('spaces.posting.maxCommentLength');
  if (ranking.graphemeLength(text) > maxLength) {
    throw fail(`Comment must be ${maxLength} characters or fewer`, 400, { field: 'body' });
  }

  let parent = null;
  let depth = 0;
  let ancestors = [];

  if (input.parent) {
    parent = await PostComment.findById(input.parent);
    if (!parent || String(parent.post) !== String(post._id)) {
      throw fail('The comment you are replying to no longer exists', 404);
    }
    depth = parent.depth + 1;
    const maxDepth = settings.get('spaces.posting.maxCommentDepth');
    if (depth > maxDepth) throw fail(`Replies can only go ${maxDepth} levels deep`, 400);
    ancestors = [...parent.ancestors, parent._id];
  }

  // Atomic sibling rank. `findOneAndUpdate` returning the updated document
  // means two concurrent replies cannot claim the same index.
  let rank = 0;
  if (parent) {
    const bumped = await PostComment.findByIdAndUpdate(
      parent._id,
      { $inc: { directReplyCount: 1 } },
      { new: true, select: 'directReplyCount sortPath' }
    );
    rank = bumped.directReplyCount - 1;
  } else {
    rank = await PostComment.countDocuments({ post: post._id, parent: null });
  }

  const comment = await PostComment.create({
    post: post._id,
    space: space._id,
    author: user._id,
    parent: parent ? parent._id : null,
    ancestors,
    depth,
    sortPath: PostComment.childPath(parent ? parent.sortPath : '', rank),
    body: html,
    bodyText: text,
    mentions: await resolveMentions(text),
    isOp: String(post.author) === String(user._id),
    upvotes: 1, // the author's implicit upvote, mirroring posts
    score: 1,
    bestScore: ranking.confidenceScore(1, 0, settings.get('spaces.ranking.confidenceZ')),
  });

  await counterService.increment(
    'post',
    post._id,
    { commentCount: 1 },
    { lastActivityAt: new Date() }
  );

  // Every ancestor's total descendant count moves, not just the parent's.
  if (ancestors.length) {
    await PostComment.updateMany({ _id: { $in: ancestors } }, { $inc: { replyCount: 1 } });
  }
  if (parent) await counterService.increment('comment', parent._id, { replyCount: 1 });

  // Notifications are dispatched, never inline — a reply on a busy post must
  // not wait on a fan-out.
  jobDispatcher.enqueue('comment.notify', {
    commentId: String(comment._id),
    parentAuthor: parent ? String(parent.author) : String(post.author),
    mentions: comment.mentions.map(String),
  });

  return comment;
};

/**
 * Fetch a page of the comment tree.
 *
 * Two queries. The node cap is a hard ceiling on the response, because an
 * unbounded tree fetch is how a single popular post takes the site down.
 */
const tree = async ({ post, sort, cursor = null, settings, viewer = null }) => {
  const sortKey = SORT_SPEC[sort] ? sort : settings.get('spaces.ranking.defaultCommentSort');
  const spec = SORT_SPEC[sortKey];
  const initialDepth = settings.get('spaces.posting.initialCommentDepth');
  const maxNodes = settings.get('spaces.scale.commentTreeMaxNodes');
  const pageSize = Math.min(settings.get('spaces.feed.pageSize'), maxNodes);

  // --- 1. top-level, in the requested order -------------------------------
  const topFilter = { post: post._id, parent: null };
  if (cursor) {
    const [field] = Object.keys(spec);
    const decoded = decodeCursor(cursor);
    if (decoded) {
      const direction = spec[field] === -1 ? '$lt' : '$gt';
      const value = field === 'createdAt' ? new Date(decoded.v) : decoded.v;
      topFilter.$or = [
        { [field]: { [direction]: value } },
        { [field]: value, _id: { [direction]: decoded.id } },
      ];
    }
  }

  const pinnedFirst = { isPinned: -1, ...spec };
  const top = await PostComment.find(topFilter)
    .sort(pinnedFirst)
    .limit(pageSize + 1)
    .lean()
    .read(settings.get('spaces.scale.readPreference'));

  const hasMore = top.length > pageSize;
  const topPage = hasMore ? top.slice(0, pageSize) : top;

  // --- 2. their descendants, one indexed range scan -----------------------
  let descendants = [];
  if (topPage.length && initialDepth > 1) {
    const remaining = Math.max(maxNodes - topPage.length, 0);
    if (remaining > 0) {
      descendants = await PostComment.find({
        post: post._id,
        ancestors: { $in: topPage.map((c) => c._id) },
        depth: { $lte: initialDepth - 1 },
      })
        .sort({ sortPath: 1 })
        .limit(remaining)
        .lean()
        .read(settings.get('spaces.scale.readPreference'));
    }
  }

  const nodes = [...topPage, ...descendants];
  const hydrated = await hydrate(nodes, post, viewer, settings);

  const last = topPage[topPage.length - 1];
  const [field] = Object.keys(spec);

  return {
    comments: hydrated,
    sort: sortKey,
    cursor: hasMore && last ? encodeCursor(last[field], last._id) : null,
    hasMore,
    truncated: nodes.length >= maxNodes,
  };
};

/** Lazy expansion below the initial depth, or past a "load more" boundary. */
const repliesOf = async ({ comment, settings, viewer, post, limit = null }) => {
  const maxNodes = settings.get('spaces.scale.commentTreeMaxNodes');
  const take = Math.min(limit || 50, maxNodes);

  const rows = await PostComment.find({
    post: comment.post,
    ancestors: comment._id,
    depth: { $lte: comment.depth + settings.get('spaces.posting.initialCommentDepth') },
  })
    .sort({ sortPath: 1 })
    .limit(take + 1)
    .lean()
    .read(settings.get('spaces.scale.readPreference'));

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return { comments: await hydrate(page, post, viewer, settings), hasMore };
};

/**
 * Attach authors and viewer vote state.
 *
 * Two batched queries for the whole tree, never one per node. Tombstoned bodies
 * are replaced here rather than at render, so a removed comment's text never
 * leaves the server.
 */
const hydrate = async (comments, post, viewer, settings) => {
  if (!comments.length) return [];

  // Lazy require: voteService requires this module's siblings, and a static
  // import here would create a cycle at load time.
  const voteService = require('./voteService');
  const { VOTE_TARGET_TYPES } = require('../../config/constants');

  const authorIds = [...new Set(comments.filter((c) => !c.deletedAt).map((c) => String(c.author)))];
  const [authors, votes] = await Promise.all([
    User.find({ _id: { $in: authorIds } }, PUBLIC_USER_FIELDS).lean().read('secondaryPreferred'),
    voteService.forTargets(viewer, VOTE_TARGET_TYPES.COMMENT, comments.map((c) => c._id)),
  ]);
  const authorById = new Map(authors.map((a) => [String(a._id), a]));

  const hideDownvotes = settings.get('spaces.voting.hideDownvoteCount');

  return comments.map((comment) => {
    const tombstoned = comment.status !== POST_STATUS.PUBLISHED || Boolean(comment.deletedAt);

    const out = {
      ...comment,
      author: tombstoned ? null : authorById.get(String(comment.author)) || null,
      viewerVote: votes[String(comment._id)] || 0,
    };

    if (tombstoned) {
      // The node survives so replies beneath it are not orphaned; only the
      // content goes. Never send the removed text — a client-side hide is not
      // a removal.
      out.body = '';
      out.bodyText = '';
      out.mentions = [];
      out.tombstone = comment.deletedAt ? 'deleted' : 'removed';
      out.removedReason = comment.removal ? comment.removal.reason : '';
      delete out.removal; // the moderator's private note never leaves the server
    }

    if (hideDownvotes) {
      delete out.upvotes;
      delete out.downvotes;
    }

    return out;
  });
};

const encodeCursor = (value, id) =>
  Buffer.from(JSON.stringify({ v: value, id: String(id) })).toString('base64url');

const decodeCursor = (cursor) => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return parsed.v !== undefined && parsed.id ? parsed : null;
  } catch (error) {
    return null;
  }
};

/** Edit a comment. Writes a revision before mutating, from the first edit. */
const update = async ({ comment, user, input, settings, perms }) => {
  const isAuthor = String(comment.author) === String(user._id);
  if (!isAuthor && !perms.can.managePosts) throw fail('You cannot edit this comment', 403);

  if (isAuthor && !perms.isAdmin) {
    const window = settings.get('spaces.posting.editWindowMinutes');
    if (window > 0) {
      const closesAt = new Date(new Date(comment.createdAt).getTime() + window * 60000);
      if (closesAt < new Date()) throw fail('The edit window for this comment has closed', 403);
    }
  }

  const { html, text } = sanitizeHtml.process(input.body || '', 'comment');
  if (!text.trim()) throw fail('Write something first', 400, { field: 'body' });

  const maxLength = settings.get('spaces.posting.maxCommentLength');
  if (ranking.graphemeLength(text) > maxLength) {
    throw fail(`Comment must be ${maxLength} characters or fewer`, 400, { field: 'body' });
  }

  // Best-effort: the user's edit is the primary action and must not fail
  // because history could not be written. A missing revision is logged, not
  // fatal.
  try {
    await PostRevision.record({
      targetType: 'comment',
      target: comment._id,
      editor: user._id,
      editorRole: isAuthor ? 'author' : 'moderator',
      previous: { body: comment.body, bodyText: comment.bodyText },
    });
  } catch (error) {
    console.error('[comments] revision write failed:', error.message);
  }

  comment.body = html;
  comment.bodyText = text;
  comment.mentions = await resolveMentions(text);
  comment.editedAt = new Date();
  comment.editCount += 1;
  await comment.save();

  return comment;
};

/**
 * Delete or remove a comment.
 *
 * The node is KEPT and tombstoned when it has replies — deleting it would
 * orphan every reply beneath. A comment with no replies is soft-deleted
 * outright, so a thread is not littered with empty tombstones.
 */
const remove = async ({ comment, user, perms, asModerator = false, reason = '' }) => {
  const isAuthor = String(comment.author) === String(user._id);
  if (!isAuthor && !perms.can.managePosts) throw fail('You cannot delete this comment', 403);

  const hasReplies = comment.replyCount > 0;

  if (asModerator && !isAuthor) {
    comment.status = POST_STATUS.REMOVED;
    comment.removal = {
      by: user._id,
      byRole: perms.isAdmin ? 'admin' : 'moderator',
      reason,
      at: new Date(),
    };
    await comment.save();
  } else if (hasReplies) {
    comment.status = POST_STATUS.REMOVED;
    comment.removal = { by: user._id, byRole: 'author', reason: '', at: new Date() };
    await comment.save();
  } else {
    await comment.softDelete();
  }

  await counterService.increment('post', comment.post, { commentCount: -1 });
  return { removed: true, tombstoned: hasReplies || asModerator };
};

/**
 * Remove a comment and everything under it.
 *
 * The `ancestors` index makes this one query rather than a recursive walk —
 * which is the entire reason that field exists alongside sortPath.
 */
const removeSubtree = async ({ comment, user, perms, reason = '' }) => {
  if (!perms.can.managePosts) throw fail('You cannot do that', 403);

  const descendants = await PostComment.find({ ancestors: comment._id })
    .select('_id')
    .lean();
  const ids = [comment._id, ...descendants.map((d) => d._id)];

  await PostComment.updateMany(
    { _id: { $in: ids }, status: POST_STATUS.PUBLISHED },
    {
      $set: {
        status: POST_STATUS.REMOVED,
        'removal.by': user._id,
        'removal.byRole': perms.isAdmin ? 'admin' : 'moderator',
        'removal.reason': reason,
        'removal.at': new Date(),
      },
    }
  );

  await counterService.increment('post', comment.post, { commentCount: -ids.length });
  return { removed: ids.length };
};

module.exports = {
  create,
  tree,
  repliesOf,
  hydrate,
  update,
  remove,
  removeSubtree,
  resolveMentions,
  encodeCursor,
  decodeCursor,
  SORT_SPEC,
  MENTION_PATTERN,
};
