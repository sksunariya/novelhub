# Community Implementation Plan

One file per phase. Each is self-contained: goal, files to touch, data model notes, the FREE and BLOCKING items with their rationale, tests, and a definition of done.

**Reference docs** (read once, refer back): [architecture](../architecture.md) · [platform-readiness](../platform-readiness.md) · [scalability](../scalability.md) · [monetization-phase2](../monetization-phase2.md)

---

## Status

| Phase | Title | Status | Blocks launch |
|---|---|---|---|
| [0](./phase-00-foundations.md) | Foundations | ✅ **Complete** | — |
| [1](./phase-01-spaces-membership.md) | Spaces and membership | ✅ **Complete** | — |
| [2](./phase-02-posts-votes-feeds.md) | Posts, votes and feeds | ✅ **Complete** | — |
| [3](./phase-03-comments.md) | Comments | ✅ **Complete** | — |
| [4](./phase-04-rich-content.md) | Rich content | 🟡 **Core landed** | ⚠ needs a hash provider before `spaces.media.enabled` |
| [5](./phase-05-moderation.md) | Moderation | ✅ **Complete** | — |
| [6](./phase-06-admin-portal.md) | Admin portal | ✅ **Complete** | — |
| [7](./phase-07-public-ui.md) | Public UI | 🟡 **Substantially complete** | — |
| [8](./phase-08-polish-scale.md) | Polish and scale | Not started | — |
| [9](./phase-09-hardening.md) | Hardening | Not started | ⚠ Deletion, export, backups |
| [10](./phase-10-compliance.md) | Compliance | Not started | ⚠ DMCA, policies, privacy |

---

## Dependency graph

```
0 Foundations
└── 1 Spaces & membership
    └── 2 Posts, votes, feeds
        ├── 3 Comments ──┐
        ├── 4 Rich content (parallel with 5)
        └──────────────── 5 Moderation
                          ├── 6 Admin portal ─┐   (6 and 7 share no files
                          └── 7 Public UI ────┤    and can run in parallel)
                                              └── 8 Polish & scale
                                                  └── 9 Hardening
                                                      └── 10 Compliance
```

Phase 4 can start as soon as Phase 2 lands. Phases 6 and 7 are genuinely parallel.

---

## The three markers

**BLOCKING** — must ship with its phase. Legal, safety or security exposure otherwise. There are 18 across the plan.

**FREE** — costs essentially nothing now (a schema field, an interface, a naming decision, a test) and is expensive or impossible to retrofit. There are 51. This is the bulk of what the plan adds beyond the architecture doc, and the reason it is worth reading before starting a phase rather than after.

**No marker** — normal build work.

---

## How this ships safely

`spaces.enabled` defaults to `false`. **Phases 0–6 can land in production entirely unseen**, be exercised by admins, and be switched on when genuinely ready. Nothing in the first seven phases is visible to a user until that flag flips.

---

## One decision still outstanding

| Decision | Needed before | Consequence of deciding late |
|---|---|---|
| **Which jurisdictions are in scope** | Phase 10 | Changes that phase's size by roughly 4×, and may add an age-assurance vendor integration |

**Settled 15 Aug 2026 — no SSR or prerendering.** The community ships as part of the existing Vite SPA. The cost (generic link previews, absence from AI crawlers, unreliable indexing) and the reversal path are recorded in [Phase 7](./phase-07-public-ui.md). The SEO work in that phase still applies — it is cheap, correct regardless, and it is what keeps a later reversal inexpensive.

Everything else previously open has been resolved into either a FREE item in a phase, or a deferred stage in [scalability](../scalability.md) §6.

---

## What is deliberately not here

No Redis, no message queue, no search cluster, no extracted services, no sharding. Each sits behind an interface that exists by the end of Phase 4, so adopting any of them later is a swap rather than a rewrite. The triggers are in [scalability](../scalability.md) §6, and the symptom-to-fix runbook is §8.

Monetization is out of scope entirely — see [monetization-phase2](../monetization-phase2.md).
