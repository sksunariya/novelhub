# Phase 8 — Polish and Scale

**Status:** Not started
**Depends on:** Phases 6, 7
**Reference:** [readiness](../platform-readiness.md) §9, §12, §13.8 · [scalability](../scalability.md) §7

---

## Goal

The things that decide whether the community survives its first month: people find it, come back to it, and it stays fast while they do.

---

## Notifications

New `NOTIFICATION_TYPES`: `POST_REPLY`, `COMMENT_REPLY`, `POST_MENTION`, `SPACE_INVITE`, `SPACE_JOIN_REQUEST`, `MOD_ACTION`, `SPACE_ANNOUNCEMENT`, `POST_MILESTONE`.

Each gets an in-app/email default in the existing channel matrix and a per-user toggle, reusing `notificationService.dispatchNotification`.

**Batching is mandatory, not an optimisation.** Ten replies in a minute is one notification. Without it, a popular post makes the platform feel like an attack.

**Fan-out batched** — `insertMany`, never a write per recipient in a loop, and dispatched through `jobDispatcher` so a chapter-style publish never blocks on it.

---

## Email — the part that quietly breaks everything

The system currently sends transactional mail only. Digests change the problem, and a bad bulk reputation takes the password-reset mail down with it.

- **SPF, DKIM and DMARC.** Without them digests land in spam.
- **Dedicated subdomain for bulk mail**, keeping transactional reputation separate. This is the single most important item here.
- **RFC 8058 one-click unsubscribe** — effectively required by major providers for bulk senders.
- Bounce and complaint handling with automatic suppression.
- Digest batching and per-user frequency caps.
- Preview and test-send from the admin portal before a broadcast.

---

## Karma

`spaces.karma.*` settings already declared. Implement the accrual on the vote path (through `counterService`), the per-space karma on `SpaceMember`, and the nightly `community.karmaRecompute` job that rebuilds from the `Vote` ledger and corrects drift.

`spaces.karma.perPostCap` matters more than it looks — uncapped, one viral post permanently outranks years of sustained contribution.

---

## Search

MongoDB text indexes on `Space` and `Post`, behind `searchService.searchCommunity()`. Adequate to roughly 100k posts.

**The abstraction is the deliverable.** Swapping to Atlas Search or Meilisearch later is one file, and only if [scalability](../scalability.md) Stage 6 triggers.

Search results respect the permission resolver — private spaces, shadowbans and blocks must not leak through search. This is the surface people forget.

---

## Rollups and jobs

| Job | Schedule key |
|---|---|
| `community.rescore` | `spaces.ranking.rescoreCron` — advances time decay on posts nobody is voting on |
| `community.karmaRecompute` | `spaces.karma.recomputeCron` |
| `community.rollup` | `spaces.analytics.rollupCron` → `SpaceStatsDaily` |
| `community.closePolls` | `*/5 * * * *` |
| `community.expireBans` | `0 * * * *` |
| `community.linkPreviews` | `*/10 * * * *` — retry failed fetches |
| `community.voteArchive` | `spaces.scale.voteArchiveCron` |
| `community.recount` | manual trigger |

---

## Scale settings switched on

Add the remaining `spaces.scale.*` keys ([scalability](../scalability.md) §7) and turn on feed caching. Anonymous Popular and All feeds are identical for every visitor and are the highest-volume queries on the site — they are what `cacheService` was built for.

**Vote archival** is the one piece of real scaling work in the whole plan. Votes older than `voteHotWindowDays` on posts older than the same window are aggregated into `VoteArchive`. This keeps the online vote collection roughly flat instead of growing forever, and postpones sharding indefinitely.

---

## Growth — the most likely way this fails

The cold-start problem is a bigger risk than every technical item in this document combined.

- **Onboarding interest picker at signup**, auto-joining 3–5 spaces. Without it the Home feed is empty and the user leaves and does not come back.
- **Seeded content** — admin-created spaces with real posts before public launch. An empty forum reads as abandoned.
- **First-post support** — templates, prompts, a visible "new here" flair so the community is gentler.
- **Retention loops** — digest of top posts in your spaces, reply notifications. Hard rule: notifications must never become the product.
- **Per-space health metrics surfaced to space owners, not only admins.** A moderator who can see their community dying can act on it. An admin who can see it usually cannot.
- **Discovery** — trending spaces, similar spaces, topic browse.
- **Contributor recognition** — top contributor of the month, milestone badges. Cheap to build, disproportionate retention effect.

---

## Definition of done

- [ ] SPF, DKIM, DMARC configured; test send passes a deliverability check
- [ ] One-click unsubscribe working; bounces suppress automatically
- [ ] Reply notifications batched, verified under a burst
- [ ] Karma rebuild converges from deliberately corrupted state
- [ ] Search respects every permission and shadowban path
- [ ] Feed cache measurably reduces database load on anonymous traffic
- [ ] Vote archival keeps the online collection flat across a simulated year
- [ ] New signup lands on a non-empty Home feed
