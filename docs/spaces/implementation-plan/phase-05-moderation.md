# Phase 5 — Moderation

**Status:** ✅ Complete — 609 unit tests passing (39 new). Both BLOCKING items shipped.
**Depends on:** Phases 2, 3
**Unblocks:** Phase 6
**Reference:** [architecture](../architecture.md) §4.7, §4.8, §8 · [readiness](../platform-readiness.md) §1.1, §2, §13.5

---

## Goal

Reports, moderator tools, automated guards, and the legal record-keeping that has to exist from the first removal rather than from the first legal letter.

---

## Files to create

```
backend/src/models/Report.js
backend/src/models/ModAction.js
backend/src/models/StatementOfReasons.js
backend/src/models/Appeal.js
backend/src/services/community/communityGuardService.js
backend/src/services/community/moderationService.js
backend/src/controllers/moderationController.js
backend/tests/moderation.integration.test.js
```

---

## BLOCKING — `StatementOfReasons`

The DSA requires a clear, specific explanation to the affected user on **every** removal, restriction, suspension or termination, plus an internal complaints mechanism to appeal it.

A free-text `reason` string does not satisfy this, and it cannot be upgraded retroactively for actions already taken. The record must carry:

```js
{
  action,             // ref to the ModAction
  targetType, target,
  ground,             // 'illegal_content' | 'terms_violation'
  legalBasis,         // when ground is illegal_content
  ruleId,             // stable ID from the Community Guidelines
  automated,          // was detection automated
  automatedDetail,    // which classifier, what score
  contentSnapshot,    // as it was when actioned
  territorialScope,
  appealDeadline,
  notifiedAt,
}
```

**BLOCKING — `Appeal`.** One appeal per action; status, handler, outcome, reasoning. Appeals get human review — that is the entire point of the mechanism. Available to both the content author and the reporter.

---

## `communityGuardService` — pre-publish guard

Extends the pattern already set by `contentGuardService`. Runs on every post and comment before save:

1. Rate limits — posts/hour, comments/hour, per user and per space
2. Account gates — minimum age, minimum karma, verified email
3. Banned words — global `spaces.moderation.bannedWords` plus a per-space list; action `block | flag | hide`
4. Link policy — allow/deny, domain allowlist and blocklist, minimum karma to link
5. Duplicate detection — same URL in the same space within the configured window
6. Media validation — already handled by `dynamicUpload`
7. New-user approval queue — first N posts land `pending` when the space enables it
8. `classificationService` (Phase 0) — per-category thresholds

Any trip either rejects with a specific reason, or publishes with an auto-generated `Report` of `source: 'automod'`.

**Self-harm content gets its own path** — not silent removal, but a support-resource interstitial. Silently deleting someone's cry for help is the worst available outcome.

---

## Removal semantics

Removing a post hides it from feeds but keeps it reachable by direct link **to its author and moderators**, with a removal banner. This matches Reddit and avoids the "my post vanished with no explanation" failure mode, which is the single largest driver of moderation support load.

`status: 'removed'` is a moderation state and stays queryable. `deletedAt` is the author deleting their own content. Different events, both recoverable, never conflated.

---

## FREE items with rationale

| Item | Why now |
|---|---|
| **`Report.reporterEmail` / `reporterType`** | The DSA requires *anyone* — not just account holders — to be able to report. Having the fields makes the public endpoint a route addition rather than a schema migration |
| **`Report.claimedBy` / `claimedAt`** | Two moderators must not action the same item. Trivial now, awkward once a queue is live |
| **`Report.classificationScores`** | Lets thresholds be calibrated from real data later. Worthless if collection starts after the tuning is needed |
| **`Report.snapshot`** | A user reports a post, the author edits it to something innocuous. Without a snapshot the report is silently invalidated |
| **Community Guidelines with stable rule IDs** | Rules that exist only as prose cannot be cited, counted or appealed against consistently — and `StatementOfReasons.ruleId` needs one |
| **Shadowban filtering in the permission resolver** | Must be consistent across feed, search, notifications and direct link. Scattered checks guarantee a leak |
| **User blocking at the same choke point** | A safety feature users request in week one. Content hidden both ways |
| **`ModAction` written for admin actions too** | A community must be able to see that an admin acted in their space. Opacity here is how trust dies |

---

## Also in this phase

- **Slow mode and lockdown** wired to the `Space` fields added in Phase 1.
- **Modmail** — moderators need a channel with a user about a ban. Close to mandatory.
- **Ban appeals** with a cooldown so the queue is not spammed.
- **Mod notes** on users, visible to that space's mod team.
- **Macro actions** — one click applying a removal reason, ban duration and templated message.
- **Auto-hide** at `spaces.moderation.autoHideReports`.
- **Partial index** on the report queue (`reportCount > 0`).

---

## Two audit trails, deliberately separate

| | Scope | Visible to | Mutable |
|---|---|---|---|
| `ModAction` | One space | That space's mods, admins, optionally public | No |
| `AdminAuditLog` | Site-wide | Admins only | No — existing pre-hooks block updates |

Site-admin actions write to **both**. Conflating them means either moderators can read the site audit log, or admin actions vanish from the community's own record.

---

## Tests

- Every automod rule, at and around its boundary.
- Removal, restore, subtree cascade, and the audit entry written for each.
- `StatementOfReasons` generated on every action type.
- Appeal flow end to end, including the reporter's appeal.
- Shadowban invisibility across feed, search, notifications and direct link.
- Blocked-user invisibility in both directions.
- Report claiming prevents double-action.

---

## Landed early: community-policed hiding

Pulled forward from the rest of Phase 5 because it is the mechanism that makes media viable without a CSAM scanner at launch.

**How it works.** Enough *distinct* reporters hide content immediately; a moderator reviews and either restores or confirms removal; the author is told at every step.

**What stops it being a weapon:**

- **Distinct reporters, not report count.** A unique index on `{targetType, target, reporter}` means one person cannot hide anything by clicking five times.
- **Weighted.** A trusted flagger counts triple; someone with negative karma counts half. Bounded so that no single reporter — however trusted — can reach the default threshold alone.
- **Severity-tiered.** "Off topic" needs the full quorum. `minor_safety`, `hate`, `violence` and `self_harm` hide on the FIRST report, because for those the delay *is* the harm and being wrong costs an hour of one person's visibility.
- **Only `minor_safety` escalates** to the restricted safety queue. Hate speech hides fast but stays in ordinary moderation — the queue with legal preservation attached is for one thing.
- **Severity is never sent to the client.** Knowing which reason hides content fastest is exactly what an abuser wants.
- **The reporter is not told whether it worked.** "That worked, it's gone" turns the button into something you can calibrate; "not yet" tells you how many more you need.

**`hidden` is deliberately not `removed`.** Hidden is automatic, reversible, and carries no accusation — the author still sees their content with an explanation and a moderator sees it in context. Removed is a human decision with a reason and a rule ID attached.

**The UI states** are in the post serializer: `moderation.state` is `hidden` or `removed`, with `automatic`, a plain-English `message`, and a timestamp. Never the moderator's private note.

---

## Both BLOCKING items shipped

**`StatementOfReasons`** is a first-class record, not a `reason` string. It carries the ground (illegal content vs terms violation), a legal basis where relevant, the rule cited **by stable ID with its text frozen at the time**, whether detection was automated and with what score, a content snapshot, territorial scope, and an appeal deadline. Immutable except for two delivery timestamps.

It exists as a model because it cannot be added retroactively — every action taken before the record exists is permanently undocumented, and the structured fields are what a transparency report aggregates over. A free-text string cannot be queried, counted or exported.

**`Appeal`** is open to **both sides**: the author of removed content, and the reporter whose report was dismissed. A mechanism that only hears authors is half a mechanism. `canBeReviewedBy()` refuses the person who made the original decision — without that, the mechanism is the same person confirming they were right. Closing an appeal requires a human reviewer and a written explanation; there is deliberately no automated resolution path.

**`ModAction`** is the per-space log, separate from `AdminAuditLog`. Conflating them means either moderators can read the site-wide trail, or admin actions vanish from the community's own record. Site-admin actions write to **both**. Indexed by `actorRole` — that is how an admin finds a moderator abusing their space, and no other view answers it.

**`communityGuardService`** runs pre-publish, cheapest checks first: account age, lockdown, banned words, link policy, duplicate detection, new-user approval, then classification last because it is the only slow and probabilistic one.

Two details in the guard worth knowing:

- **Word matching normalises evasions** (`sp4m`, `$pam`, `spám` → `spam`) but matches on **word boundaries**, so a list containing "ass" does not trip on "class" or "assemble". That false positive is what makes word lists infuriating rather than useful.
- **A block never names the word that tripped it.** Telling someone exactly which term failed is a free tutorial in evading the filter.

**Self-harm is not a moderation outcome.** It does not block, hide or flag — the content publishes and the author is shown support resources. Deleting it, or treating it as a violation, is the worst thing the system could do.

---

## Definition of done

- [ ] Every moderation action produces a `StatementOfReasons` and a `ModAction`
- [ ] Appeals reviewable end to end
- [ ] Shadowban leaks nowhere — all four surfaces tested
- [ ] Automod guards enforce every configured rule
- [ ] Admin actions appear in both audit trails
- [ ] Self-harm classification routes to resources, not deletion
