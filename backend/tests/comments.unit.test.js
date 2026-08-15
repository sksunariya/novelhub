// Comment threading: sortPath encoding, mention parsing, and the model shapes
// the two-query tree fetch depends on.

const PostComment = require('../src/models/PostComment');
const PostRevision = require('../src/models/PostRevision');
const commentService = require('../src/services/community/commentService');
const { COMMENT_SORTS } = require('../src/config/constants');

describe('sortPath encoding', () => {
  it('pads every segment to a fixed width', () => {
    // Variable-length segments sort lexicographically wrong — "10" < "9" —
    // which scrambles every tree past nine siblings.
    for (const index of [0, 1, 35, 36, 1000, 999999]) {
      expect(PostComment.pathSegment(index)).toHaveLength(PostComment.PATH_WIDTH);
    }
  });

  it('keeps numeric order under string comparison', () => {
    const indexes = [0, 1, 9, 10, 11, 35, 36, 100, 1295, 1296];
    const segments = indexes.map((i) => PostComment.pathSegment(i));
    expect(segments).toEqual([...segments].sort());
  });

  it('uses base36 for a wide sibling range in four characters', () => {
    expect(PostComment.pathSegment(35)).toBe('000z');
    expect(PostComment.pathSegment(36)).toBe('0010');
    // 36^4 - 1 siblings before the encoding runs out.
    expect(PostComment.pathSegment(36 ** 4 - 1)).toBe('zzzz');
  });

  it('builds a root path with no separator', () => {
    expect(PostComment.childPath('', 0)).toBe('0000');
    expect(PostComment.childPath(null, 3)).toBe('0003');
  });

  it('appends a segment per level', () => {
    const root = PostComment.childPath('', 0);
    const child = PostComment.childPath(root, 5);
    const grandchild = PostComment.childPath(child, 12);
    expect(child).toBe('0000.0005');
    expect(grandchild).toBe('0000.0005.000c');
    expect(grandchild.split(PostComment.PATH_SEPARATOR)).toHaveLength(3);
  });

  it('sorts a subtree depth-first under a plain string sort', () => {
    // This is the property the whole design rests on: one indexed range scan
    // on { post, sortPath } returns a tree already in order, instead of N
    // recursive queries.
    const a = PostComment.childPath('', 0);
    const b = PostComment.childPath('', 1);
    const paths = [
      b,
      PostComment.childPath(a, 1),
      a,
      PostComment.childPath(PostComment.childPath(a, 0), 0),
      PostComment.childPath(a, 0),
    ];
    expect([...paths].sort()).toEqual([
      a,
      PostComment.childPath(a, 0),
      PostComment.childPath(PostComment.childPath(a, 0), 0),
      PostComment.childPath(a, 1),
      b,
    ]);
  });
});

describe('mention parsing', () => {
  const names = (text) => {
    const found = [];
    let match = commentService.MENTION_PATTERN.exec(text);
    while (match) {
      found.push(match[2]);
      match = commentService.MENTION_PATTERN.exec(text);
    }
    commentService.MENTION_PATTERN.lastIndex = 0;
    return found;
  };

  it('finds a mention at the start and mid-sentence', () => {
    expect(names('@alice hello')).toEqual(['alice']);
    expect(names('hey @bob and @carol_x')).toEqual(['bob', 'carol_x']);
  });

  it('ignores an email address', () => {
    // Without the leading-boundary guard, every email in a comment becomes a
    // notification to a stranger.
    expect(names('write to me at someone@example.com')).toEqual([]);
  });

  it('ignores a URL path', () => {
    expect(names('see https://site.com/@handle for more')).toEqual([]);
  });

  it('ignores a name shorter than the username minimum', () => {
    expect(names('@ab is too short')).toEqual([]);
  });

  it('resets its lastIndex between calls', () => {
    // A module-level regex with /g keeps state. Forgetting to reset it makes
    // every second call silently miss the first mention.
    expect(names('@alice')).toEqual(['alice']);
    expect(names('@alice')).toEqual(['alice']);
  });

  it('returns nothing for empty input', async () => {
    expect(await commentService.resolveMentions('')).toEqual([]);
    expect(await commentService.resolveMentions(null)).toEqual([]);
  });
});

describe('comment sorts', () => {
  it('maps every declared sort to an index-backed spec', () => {
    for (const sort of Object.values(COMMENT_SORTS)) {
      expect(commentService.SORT_SPEC[sort]).toBeTruthy();
    }
  });

  it('gives every sort an _id tiebreak so cursor paging cannot skip ties', () => {
    for (const spec of Object.values(commentService.SORT_SPEC)) {
      expect(spec._id).toBeDefined();
    }
  });

  it('sorts old ascending and everything else descending', () => {
    expect(commentService.SORT_SPEC[COMMENT_SORTS.OLD].createdAt).toBe(1);
    expect(commentService.SORT_SPEC[COMMENT_SORTS.NEW].createdAt).toBe(-1);
  });
});

describe('comment cursors', () => {
  it('round-trips', () => {
    const cursor = commentService.encodeCursor(0.97, 'abc');
    expect(commentService.decodeCursor(cursor)).toEqual({ v: 0.97, id: 'abc' });
  });

  it('treats junk as no cursor', () => {
    for (const bad of ['xx!!', '', null, Buffer.from('{}').toString('base64url')]) {
      expect(commentService.decodeCursor(bad)).toBeNull();
    }
  });
});

describe('PostComment model shape', () => {
  const hasIndex = (keys) =>
    PostComment.schema.indexes().some(([spec]) => JSON.stringify(spec) === JSON.stringify(keys));

  it('indexes the tree range scan', () => {
    expect(hasIndex({ post: 1, sortPath: 1 })).toBe(true);
  });

  it('indexes ancestors, which makes subtree removal one query', () => {
    // The reason ancestors exists alongside sortPath: "remove this and
    // everything under it" must not be a recursive walk.
    expect(hasIndex({ ancestors: 1 })).toBe(true);
  });

  it('indexes top-level comments for every sort', () => {
    expect(hasIndex({ post: 1, parent: 1, bestScore: -1 })).toBe(true);
    expect(hasIndex({ post: 1, parent: 1, createdAt: -1 })).toBe(true);
    expect(hasIndex({ post: 1, parent: 1, score: -1 })).toBe(true);
  });

  it('denormalizes post, space and isOp', () => {
    // `post` is the future shard key prefix — an entire tree must live on one
    // shard. `isOp` avoids a join when rendering 500 comments.
    for (const field of ['post', 'space', 'isOp']) {
      expect(PostComment.schema.paths[field]).toBeDefined();
    }
    expect(PostComment.schema.paths.post.options.required).toBe(true);
  });

  it('partial-indexes the moderation queue', () => {
    const partial = PostComment.schema
      .indexes()
      .find(([, options]) => options && options.partialFilterExpression);
    expect(partial[1].partialFilterExpression).toEqual({ reportCount: { $gt: 0 } });
  });

  it('separates a moderator removal from an author deletion', () => {
    expect(PostComment.schema.paths.status).toBeDefined();
    expect(PostComment.schema.paths.deletedAt).toBeDefined();
    expect(PostComment.schema.paths['removal.reason']).toBeDefined();
  });

  it('tracks direct replies separately from total descendants', () => {
    // directReplyCount drives the sibling rank and the "N more replies"
    // affordance; replyCount is the whole subtree.
    expect(PostComment.schema.paths.directReplyCount).toBeDefined();
    expect(PostComment.schema.paths.replyCount).toBeDefined();
  });
});

describe('PostRevision model shape', () => {
  it('is immutable', () => {
    // A history that can be rewritten is not a history.
    const hooks = PostRevision.schema.s.hooks._pres;
    expect(hooks.get('findOneAndUpdate')).toBeDefined();
    expect(hooks.get('updateOne')).toBeDefined();
  });

  it('is not soft-deletable', () => {
    expect(PostRevision.schema.paths.deletedAt).toBeUndefined();
  });

  it('records who edited and in what capacity', () => {
    // Author vs moderator matters in a dispute.
    expect(PostRevision.schema.paths.editor).toBeDefined();
    expect(PostRevision.schema.paths.editorRole).toBeDefined();
  });

  it('indexes the history view and the per-editor view', () => {
    const specs = PostRevision.schema.indexes().map(([spec]) => JSON.stringify(spec));
    expect(specs).toContain(JSON.stringify({ targetType: 1, target: 1, createdAt: -1 }));
    expect(specs).toContain(JSON.stringify({ editor: 1, createdAt: -1 }));
  });
});
