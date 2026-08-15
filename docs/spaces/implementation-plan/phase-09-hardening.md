# Phase 9 — Hardening

**Status:** Not started
**Depends on:** Phase 8
**Blocks:** public launch
**Reference:** [readiness](../platform-readiness.md) §6, §7, §8, §13.9 · [scalability](../scalability.md) §3, §9

---

## Goal

The work that has to be finished before `spaces.enabled` is flipped to `true`. All four BLOCKING items are legal or data-integrity obligations, not polish.

---

## BLOCKING — account deletion cascade

Deleting a user with 4,000 posts and 30,000 votes has no single right answer, and the wrong one destroys other people's threads.

| Data | Action | Why |
|---|---|---|
| Posts and comments | **Anonymize**, do not delete | A comment with 40 replies cannot vanish. Mirrors `contentGuardService.anonymizeUser`, which already does this for financial records |
| Votes | **Keep, anonymized** | Deleting them silently rewrites every score on the site |
| Owned spaces | Transfer to longest-serving moderator, else archive | Policy implemented in Phase 1 — never orphan a space |
| Memberships, saved items, drafts | Delete | Personal, referenced by nobody |
| Preserved child-safety material | **Retained** | Overrides erasure. The retention policy must say so explicitly |

**30-day reversible grace period.** Prevents the rage-quit-and-regret ticket, which is otherwise a guaranteed recurring support cost.

---

## BLOCKING — data export

Self-serve, machine-readable JSON: posts, comments, votes, memberships, saved items, messages. Generated through `jobDispatcher`, delivered as a download link, expiring.

---

## BLOCKING — retention purge jobs

- `spaces.privacy.ipRetentionDays` (90) — IP addresses stored for abuse detection.
- `spaces.analytics.retainRawDays` (90) — raw event rows behind the rollups. Rollups are kept indefinitely.
- Vote fingerprints on the same window as IPs.

Data minimisation is a legal obligation, and unpurged IP logs are a liability with no upside.

---

## BLOCKING — backup restore, actually tested

The community adds eleven new collections. A backup script written for the novel platform may not include them, and an untested backup is not a backup.

- Verify every new collection is captured.
- **Perform a real restore into a scratch environment.**
- Point-in-time recovery specifically for `ModAction`, `AdminAuditLog` and `StatementOfReasons`.
- Documented RTO and RPO.

---

## Security review

- Full IDOR sweep against the Phase 1 permission matrix.
- Mass-assignment audit on every write endpoint.
- SSRF suite re-run against the live link fetcher.
- Stored-XSS corpus against the sanitizer.
- Rate limits verified under concurrency.
- Account security: 2FA, session list with remote revoke, email-change confirmation to both addresses, re-authentication before deleting a space or transferring ownership, breach-password check at registration.
- Dependency audit.

---

## Load test — against the capacity model

Validate the numbers in [scalability](../scalability.md) §3 rather than asserting them:

| Target | Threshold |
|---|---|
| Feed page | < 100ms at 1M posts |
| Vote round trip | < 50ms |
| Post detail, 500 comments | < 200ms |
| Peak write throughput | 3× projected average |

Also confirm: index plans hold at volume, working set fits RAM at the projected one-year mark, no N+1 has crept in, and counter contention behaviour on a single hot post is understood.

---

## Monitoring

**Database:** working set vs RAM, `totalIndexSize` per collection, write conflicts/sec, replication lag, slow queries/min, pool saturation.

**Application:** p50/p95/p99 per endpoint, **queries per request**, cache hit rate, error rate.

**Product:** votes/sec, posts/hour, comments/hour, report queue depth, largest comment tree, joined-space p99.

**Two alarms set now**, because both are silent until severe:

1. **Queries per request on the feed.** Should be a small constant. The day it scales with page size, an N+1 has been introduced.
2. **Vote index size as a percentage of instance RAM.** Crossing 60% is the signal to schedule archival — months before it becomes an incident.

Also: structured logging with a request ID threaded through `requestLogger`, error tracking with source maps, business-metric alerts (a drop in posts/hour is an outage signal long before a health check fails — note that `/health` deliberately does not touch the database and will pass during a total outage), and a status page.

---

## Accessibility audit

axe-core CI green, plus a manual screen-reader pass on: feed, post detail with a deep comment tree, composer, and the space creation wizard.

---

## Definition of done

- [ ] Account deletion tested against a user with content in every collection
- [ ] Export produces valid, complete JSON
- [ ] Purge jobs verified to actually purge
- [ ] Backup restored into a scratch environment successfully
- [ ] Security review closed with no open high findings
- [ ] Every load target met
- [ ] Both alarms firing correctly in a test
- [ ] Screen-reader pass complete
