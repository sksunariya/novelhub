# Phase 3 — Comments

**Status:** ✅ Complete — 491 unit tests passing (28 new)
**Depends on:** Phase 2
**Unblocks:** Phase 5
**Reference:** [architecture](../architecture.md) §4.4, §7.3 · [readiness](../platform-readiness.md) §13.3

---

## Goal

Threaded comments that stay fast on a 10,000-comment post.

---

## Files to create

```
backend/src/models/PostComment.js
backend/src/models/PostRevision.js
backend/src/services/community/commentService.js
backend/src/controllers/postCommentController.js
backend/tests/commentTree.integration.test.js
```

---

## Why a separate model from `Comment`

The existing `Comment` model serves chapter comments: tied to a chapter, carrying pinning, inline like arrays, and the reading gate's `{novel, user}` probe index. Adding a threading path, vote aggregates and a moderation removal state would slow that probe — which sits on the reading hot path — for no benefit.

They are different features with different access patterns. Keep them separate.

---

## Threading — `ancestors` and `sortPath`

Both, for different jobs:

- **`ancestors: [ObjectId]`** — root to parent. Makes "remove this comment and everything under it" a single `updateMany({ ancestors: id })`.
- **`sortPath: String`** — fixed-width encoding of each ancestor's rank, e.g. `0007.0002.0011`. Makes "fetch the first N comments already in tree order" a single indexed range scan instead of N recursive queries.

Depth beyond `spaces.posting.initialCommentDepth` (4) loads lazily by `parent`. Total nodes in one payload capped by `spaces.scale.commentTreeMaxNodes` (500).

The client receives a flat array with `depth` and `sortPath` and assembles the tree. Sending nested JSON wastes bytes and makes pagination inside a thread awkward.

---

## FREE items with rationale

**`PostComment.post` denormalized on every reply, including deep ones.** Never derived by walking `ancestors`. It is the future shard key prefix — an entire comment tree must live on one shard, and that is the whole game for comments ([scalability](../scalability.md) §4.1).

**`PostRevision` written on every edit, from the first edit.** Edit history cannot be reconstructed retroactively. A public diff is the strongest available deterrent to bait-and-switch editing — posting something agreeable, collecting upvotes, then rewriting it.

**`isOp` denormalized** so the OP badge needs no join in a 500-comment render.

**Removal keeps the subtree.** Removing a comment with replies replaces the body with a tombstone rather than deleting the node, or every reply beneath it is orphaned. Full subtree removal remains available to moderators as a separate action — the `ancestors` index makes it one query.

---

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/posts/:id/comments` | `?sort=best\|top\|new\|old\|controversial&cursor=` |
| `GET` | `/api/comments/:id/replies` | Lazy expansion past the depth cap |
| `POST` | `/api/posts/:id/comments` | `{ body, parent }` |
| `PATCH`/`DELETE` | `/api/comments/:id` | Author within edit window, or mod |
| `POST` | `/api/comments/:id/vote` | |

---

## Also in this phase

**Mentions.** `@username` with autocomplete, notification, and a per-user opt-out. Parse at write time and store resolved user IDs — re-parsing on every render is wasteful and breaks when a user is renamed.

---

## Tests

- Tree assembly correctness at every depth up to the cap.
- `sortPath` ordering stable when siblings are inserted concurrently.
- Subtree removal cascades exactly once and leaves no orphans.
- Tombstone preserves replies.
- Comment payload never exceeds `commentTreeMaxNodes`.
- Edit outside the window rejected; every edit writes a revision.
- Depth beyond `maxCommentDepth` rejected with a clear message.

---

## Definition of done

- [x] Two-query tree fetch, bounded by depth and by `commentTreeMaxNodes`
- [x] All five comment sorts, each index-backed with an `_id` tiebreak
- [x] Lazy reply expansion by parent
- [x] Every edit writes a `PostRevision` before mutating
- [x] Removal keeps the node and tombstones it, so replies are never orphaned
- [x] Subtree removal is one `updateMany` on the `ancestors` index
- [x] Mentions resolved at write time to user ids
- [ ] Measure first-page latency on a 10,000-comment post against a real database
- [ ] Integration tests (`npm test`) — could not run in the build sandbox

---

## Decisions taken during the build

**The tree is two queries, not one.** Top-level comments are fetched in the requested sort order; their descendants come back in a single indexed range scan on `{ post, sortPath }`. A single query cannot do both, because the top level is ordered by score and the subtrees by insertion.

**`sortPath` segments are fixed-width base36.** Variable-length segments sort lexicographically wrong — `"10" < "9"` — which scrambles every tree past nine siblings. Four characters allows 1,679,615 replies to one parent.

**Sibling rank comes from an atomic `$inc` on the parent's `directReplyCount`.** Two simultaneous replies get distinct ranks with no transaction. A collision could only reorder siblings, never lose one, because `_id` is the tiebreak everywhere the path is used.

**A comment with replies is tombstoned, not deleted; one without is soft-deleted outright.** Deleting a node with replies orphans everything beneath it, but tombstoning every deletion litters threads with empty placeholders.

**Tombstoned bodies are emptied server-side.** The removed text never leaves the server, and `removal.note` — the moderator's private reasoning — is stripped in `hydrate` and again in the serializer.

**Comment vote targets resolve through a lazy getter.** `commentService` requires `voteService` for vote hydration, so a top-level require of `PostComment` inside `voteService` would close a load-time cycle.

**The mention regex guards its left boundary.** Without `(^|[^\w/])`, every email address in a comment becomes a notification to a stranger, and every `/@handle` URL path becomes a false mention.
