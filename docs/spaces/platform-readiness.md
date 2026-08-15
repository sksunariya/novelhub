# Community Platform Readiness — Everything the Architecture Doc Doesn't Cover

**Status:** Research findings, for folding into the implementation plan
**Date:** 2026-08-14
**Parent doc:** [`architecture.md`](./architecture.md)
**Purpose:** The architecture doc specifies a correct Reddit-class system. This one covers what turns a correct system into a platform that can legally operate, survive contact with abusers, be found in search, be used by everyone, and not fall over. These are the things that sink UGC platforms — none of them are optional at scale, and several are cheaper to build now than to retrofit.

---

## 0. The five that are not negotiable

Everything in this document matters. These five will stop the platform dead if they are missing:

1. **Illegal-content reporting and CSAM handling** (§1.3). Not a feature — a criminal-liability question. US providers must report apparent CSAM to NCMEC's CyberTipline as soon as reasonably possible on obtaining actual knowledge, and preserve the associated data.
2. **SSRF protection on the link preview fetcher** (§3.1). The architecture doc specifies a server-side URL fetcher. Link unfurling is one of the most commonly exploited SSRF entry points in existence, and on a cloud host it reaches the instance metadata endpoint. **This is the single most dangerous thing in the current plan.**
3. **Statement of reasons on every moderation action** (§1.1). EU law requires a clear, specific explanation to the user each time content is removed or restricted, plus an internal complaints mechanism to appeal it. The data model has to record this from the first removal, not from the first legal letter.
4. **Account deletion and data export** (§7.1). GDPR-class rights. Deleting a user who has 4,000 posts and 30,000 votes is a genuinely hard cascade problem, and the wrong answer destroys other people's threads.
5. **Rate limiting that survives multiple instances** (§3.4). The existing limiter is explicitly per-instance and documented as such. That is fine as an abuse brake on payments; it is not sufficient for a public write endpoint that anyone can hit.

---

## 1. Legal and regulatory

### 1.1 EU Digital Services Act

Applies to any platform offering services to EU users, regardless of where it is hosted. Concretely, the DSA requires:

| Requirement | What must be built |
|---|---|
| **Notice and action** | An electronic mechanism for *anyone* — not just logged-in users — to report specific items of allegedly illegal content, acted on without undue delay |
| **Statement of reasons** | A clear, specific explanation to the affected user on every removal, restriction, payment restriction, suspension or termination |
| **Internal complaints** | An effective electronic appeals mechanism, for both the content author and the reporter |
| **Transparency reporting** | Periodic published figures on removals, appeals, and enforcement outcomes |
| **Trusted flaggers** | Reports from designated entities processed with priority |
| **Point of contact** | A published electronic contact for authorities and for users |

**Build items:**

- `Report` gains `reporterEmail` and `reporterType` so anonymous, non-account reports are accepted. Add an unauthenticated `POST /api/reports/public` behind a strict rate limit and a captcha.
- Every removal writes a `StatementOfReasons` record: the legal or policy ground, the specific rule cited, whether detection was automated, the content snapshot, and the appeal deadline. This must be a first-class record, not a free-text `reason` string.
- `Appeal` model: one appeal per action, status, handler, outcome, reasoning. Appeals get human review — that is the whole point of the mechanism.
- A transparency report generator reading `ModAction`, `Report` and `Appeal` rollups, exportable and publishable.
- A `TrustedFlagger` flag on `User` that priority-sorts their reports in the queue.

### 1.2 UK Online Safety Act

Applies to user-to-user services likely to be accessed by UK children. Duties include an illegal-content risk assessment, a children's access assessment repeated at least annually and before significant design changes, and **highly effective age assurance** where the service carries primary priority content. Ofcom is explicit that self-declaration alone is not effective age assurance.

**Build items:**

- `spaces.safety.childrenAccessAssessment` — a stored, versioned assessment document with a review date and an admin reminder, so the annual obligation is tracked rather than remembered.
- Age assurance integration point: an `ageAssurance` object on `User` (`method`, `verifiedAt`, `provider`, `assuranceLevel`) and a pluggable provider interface. Do not build the verification itself — integrate a vendor.
- Gate NSFW spaces behind verified adult status, not a self-declared checkbox, in any jurisdiction where that is required.
- `spaces.safety.jurisdictionMode` — `standard | uk | eu | strict` — selecting which duties are enforced, so one deployment can serve multiple regimes.

### 1.3 Child safety — the one with criminal exposure

US electronic service providers must report apparent CSAM to NCMEC's CyberTipline as soon as reasonably possible after obtaining actual knowledge, including the content, metadata, uploader account information and IP addresses. The REPORT Act extended these obligations, and reporting providers must **preserve** the reported material and surrounding context.

**Build items — required before any user-uploaded image goes live:**

- **Perceptual hash matching on every upload**, before the image is publicly readable. PhotoDNA (free to qualifying platforms via Microsoft) or Thorn's Safer. This is not optional for a platform accepting user images.
- A `ChildSafetyIncident` model, quarantined from normal moderation: content preserved and access-restricted rather than deleted, uploader account and IP retained, report status tracked. **A moderator must not be able to delete their way out of a preservation obligation** — this is why the record must be outside the normal removal flow.
- A restricted escalation queue visible only to a named admin role, not to community moderators.
- A documented internal runbook: who reports, within what window, what is preserved, who is notified.
- Written retention policy for preserved material, which necessarily overrides the user's deletion rights.

> This is the one section where "we'll add it later" is not a scheduling decision.

### 1.4 Privacy — GDPR, India's DPDP, and friends

**Build items:**

- **Right of access / portability:** a self-serve export producing machine-readable JSON of posts, comments, votes, memberships, saved items and messages.
- **Right to erasure:** see §7.1 — the cascade is the hard part.
- **Consent and lawful basis:** a `ConsentRecord` for analytics and marketing email, with timestamp, version and withdrawal.
- **Records of processing:** what community data is collected, why, retention period, who it is shared with.
- **Breach process:** 72-hour notification obligation means detection and an owner, not just a plan.
- **Data minimisation:** the plan stores IP addresses for abuse detection. Give them an explicit, enforced retention window (`spaces.privacy.ipRetentionDays`, default 90) with a purge job.
- **Children's data:** if under-13s can register, COPPA applies in the US, with verifiable parental consent. The cheaper answer is a hard 13+ minimum on the community, enforced at signup.

### 1.5 Copyright — DMCA safe harbour

Safe harbour is conditional. Losing it means direct liability for every infringing post.

**Build items:**

- Registered DMCA agent with the US Copyright Office, published on the site.
- A dedicated takedown intake, separate from the general report queue — different legal timeline, different retention.
- A **counter-notice** flow with the statutory waiting period, and restoration if no suit is filed.
- **Repeat infringer policy**, tracked and actually enforced — courts have voided safe harbour over exactly this.
- `CopyrightClaim` model with strike accounting per user.

### 1.6 Platform policy documents

Not code, but blocking: Terms of Service covering UGC licensing, Community Guidelines the moderation actions can cite by rule ID, Privacy Policy, Cookie Policy, Moderator Code of Conduct, and a Law Enforcement Response Guide. Every enforcement action should reference a rule by identifier, which is why the guidelines need stable IDs.

---

## 2. Trust and safety engineering

### 2.1 Vote manipulation

Reddit's detection combines vote velocity and timing analysis, clustering, account-age correlation, device fingerprinting and IP overlap, with graduated enforcement — vote nullification first, suspension for organised manipulation.

**Build items:**

- `VoteAnomaly` detection job: flag posts whose vote velocity exceeds a configurable sigma above the space's baseline; flag accounts whose votes correlate above a threshold with another account's; flag vote clusters from accounts created within the same window.
- **Vote nullification rather than deletion** — nullified votes stay in the ledger with `nullified: true` so the counters can be rebuilt and the evidence survives.
- Device fingerprint on `Vote` (hashed, retention-limited) — the single most useful signal for alt-account detection.
- Graduated enforcement ladder: nullify → warn → rate-limit → suspend → ban, each step recorded.
- `spaces.antiabuse.*` settings for every threshold, all off by default until the site is large enough to be worth gaming.

### 2.2 Sockpuppets and ban evasion

**Build items:**

- Registration signals: email domain reputation, disposable-email blocklist, IP reputation, signup velocity per IP/ASN.
- `AccountLink` — suspected-alt graph built from IP overlap, fingerprint overlap and behavioural correlation, surfaced in the admin user view as a signal, never as an automatic action.
- Ban evasion detection: a banned user's fingerprint or IP reappearing on a new account raises a flag rather than auto-banning, because the false-positive case is a shared household or campus NAT.
- Shadowban infrastructure already has its setting; it needs the filtering layer — the user sees their own content, nobody else does, and it must be consistent across feed, search, notifications and direct link.

### 2.3 Brigading

Sudden vote surges correlating with external referrers is the classic signature. Mitigations used in practice: restricted posting for new accounts, and slow mode during suspicious spikes.

**Build items:**

- Referrer tracking on vote and post events (bucketed by domain, not full URL — no need to store the path).
- **Slow mode** on a space: minimum seconds between posts or comments per user, toggleable by mods and auto-triggerable on a velocity spike.
- **Lockdown mode**: temporarily restrict participation to members above a karma or age threshold. One switch a moderator can hit during a raid.
- Crosspost/external-link detection feeding a brigade alert to mods.

### 2.4 Automated content classification

Banned-word lists catch the lazy 20%. Everything else needs classification.

**Build items:**

- A `classificationService` abstraction with a null implementation, so a vendor (Perspective API, OpenAI moderation, Hive) plugs in without touching call sites.
- Categories: toxicity, threat, sexual content, self-harm, spam.
- Per-category thresholds for `flag` vs `hide` vs `block`, admin-tunable.
- **Self-harm content gets its own path** — not silent removal, but a support-resource interstitial. Silently deleting someone's cry for help is the worst possible outcome.
- Confidence scores stored on the report so moderators can see why something was flagged and calibrate thresholds.

### 2.5 The moderation workflow itself

Effective moderation at scale is a hybrid: automation for detection and scale, human review for appeals and edge cases, with every decision documented and a tiered enforcement model.

**Build items:**

- Queue assignment and claiming, so two mods do not action the same report.
- Macro actions: one click applying a removal reason, a ban duration and a templated message.
- Mod notes on users, visible to the space's mod team.
- **Moderator burnout metrics** in the admin insights: queue depth, time to resolution, actions per mod, mods inactive for N days. Moderator attrition is the most common cause of community collapse and it is entirely measurable.
- User warning system as a step short of a ban.
- Ban appeals with a cooldown so the queue is not spammed.

---

## 3. Security

### 3.1 SSRF in the link preview fetcher — critical

URL preview and link unfurling is a top SSRF entry point. On a cloud host it reaches `169.254.169.254` and the instance metadata service, which is credential disclosure. DNS rebinding defeats naive hostname allowlisting through a time-of-check/time-of-use race: the name validates, then resolves to something internal at fetch time.

**Required implementation, per OWASP:**

- Scheme allowlist: `http` and `https` only. No `file://`, `gopher://`, `ftp://`, `data:`.
- **Resolve the hostname to an IP, validate that IP, then connect to that exact IP** with the `Host` header set. This is what closes the rebinding gap — validating the name and then letting the HTTP client re-resolve is the bug.
- Block: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`, `0.0.0.0/8`, and every IPv4-mapped IPv6 form of the above.
- **Re-validate on every redirect hop**, and cap redirects at 3. A public URL redirecting to `localhost` is the standard bypass.
- Response size cap and hard timeout (`spaces.posting.linkPreviewTimeoutMs` already exists).
- Content-type allowlist for the preview image fetch.
- Run the fetcher in a network-restricted egress path if the host allows it. Defence in depth, because the code-level check will eventually have a hole.
- Never reflect the raw fetch error to the user — error differences are an internal port scanner.

### 3.2 XSS

Post bodies are user-authored HTML from TipTap. The existing `sanitizeContent.js` is a *client-side* presentation cleaner for pasted chapter content — it is not a security sanitizer, and it cannot be one, because it runs in the browser.

**Build items:**

- **Server-side HTML sanitization on write** with a strict allowlist (`sanitize-html` or DOMPurify under jsdom). Never trust the client.
- Store sanitized HTML; sanitize again on render as defence in depth.
- Strip `javascript:`, `data:`, and event handler attributes; force `rel="noopener noreferrer nofollow"` and `target="_blank"` on user links.
- Content-Security-Policy header — the backstop for the sanitizer bug you have not found yet.
- User-uploaded images served from a separate origin or with `Content-Disposition`, so an HTML file that sneaks past the mime check cannot execute in the app's origin.

### 3.3 Authorization

- **IDOR sweep:** every endpoint taking an ID must verify the actor's relationship to it. `spacePermissionService.resolve()` being the single choke point is what makes this auditable — the test matrix in the architecture doc is the guard.
- **Mass assignment:** explicit field allowlists on every update. A `PATCH /api/posts/:id` that spreads `req.body` lets a user set their own `score`.
- **CSRF:** JWT in an `Authorization` header is not automatically CSRF-vulnerable, but any cookie-based path is. Verify before shipping write endpoints.

### 3.4 Rate limiting and DoS

The existing limiter documents itself as per-instance and unsuitable as anything but an abuse brake. Community write endpoints are public and unauthenticated-adjacent.

**Build items:**

- A shared-store limiter (Redis) for community endpoints, or accept and document the N-instance multiplier.
- Per-endpoint, per-user, per-IP and per-space limits.
- Captcha on signup, on space creation, and on public reporting.
- Query-cost limits: cap comment tree depth and breadth per request; reject absurd `limit` values (`spaces.feed.maxPageSize` already does this).
- Search rate limiting — text search is the most expensive query on the site.
- Cloudflare or equivalent in front. Application-layer DDoS protection is not an application-layer problem.

### 3.5 Account security

Reader accounts becoming community accounts raises the value of taking one over.

**Build items:** 2FA (TOTP), session list with remote revoke, email-change confirmation to *both* addresses, suspicious-login notification, re-authentication before destructive actions such as deleting a space or transferring ownership, and breach-password checking against HaveIBeenPwned's k-anonymity API at registration.

---

## 4. Accessibility

The European Accessibility Act has been enforceable since 28 June 2025, with penalties up to €100,000 or 4% of annual revenue. The operative technical benchmark is EN 301 549, which currently incorporates **WCAG 2.1 Level AA**; the version incorporating WCAG 2.2 is expected. Services on the market before the deadline have a transition period to 2030 — a new feature launched now does not benefit from it.

**Build items beyond what the architecture doc already lists:**

- Target WCAG 2.2 AA, since it is a superset and is where the standard is heading.
- Semantic structure: one `h1` per page, ordered headings, landmark regions, skip links.
- The comment tree is the hard part — `role="tree"`, arrow-key traversal, `aria-expanded` on collapse, and an announced comment count.
- Vote buttons as real `<button>` with `aria-pressed` and a live region announcing the new score.
- Infinite scroll needs an accessible alternative — a "load more" button, and focus management so a screen reader is not stranded.
- Every user-uploaded image needs an alt-text field in the composer. Optional, prompted, never auto-filled with the filename.
- Colour contrast validated against **custom space accent colours** — a space owner picking a light accent must not be able to create an inaccessible page. Validate contrast at save time and reject or auto-adjust.
- Respect `prefers-reduced-motion` — the plan leans on framer-motion.
- Zoom to 200% without loss of function; 44×44px minimum touch targets (WCAG 2.2).
- Automated axe-core checks in CI, plus one real screen-reader pass. Automation catches roughly a third of issues.

---

## 5. SEO and discovery

UGC at scale is a crawl-budget problem. Thin content across a large site suppresses the whole domain, and `noindex` still consumes crawl budget because the page must be fetched to see the directive — blocking at `robots.txt` stops it earlier.

**Build items:**

- **Canonical URLs**: `/c/:slug/p/:postId/:titleSlug` is canonical; every sort, filter and pagination variant canonicalises to it.
- **`robots.txt` blocks** for sort variants, filtered views, search results and pagination beyond page 2. Do not rely on `noindex` alone at this scale.
- **`noindex` for thin content**: posts with zero comments and near-zero score after N days, empty spaces, dead user profiles. Threshold admin-tunable.
- **Segmented XML sitemaps** by content type — spaces, posts, profiles — regenerated by a job, with `lastmod` driven by `lastActivityAt`.
- **Structured data**: `DiscussionForumPosting` on posts, `Comment` on comments, `BreadcrumbList` on navigation. Google has explicit forum markup support and it drives rich results.
- **Rendering: decided, no SSR.** The site is a Vite SPA and the community ships the same way (settled 15 Aug 2026 — see [Phase 7](./implementation-plan/phase-07-public-ui.md)). The consequence is accepted: link previews are generic, AI crawlers see nothing, and Google's JS rendering is a deferred second wave. **Everything else in this section still applies** — canonical URLs, sitemaps, structured data and `nofollow ugc` are cheap, correct regardless, and are what makes a later reversal inexpensive.
- `rel="nofollow ugc"` on user-submitted links — this is precisely what the `ugc` value exists for, and without it the space becomes an SEO spam target within weeks.
- Per-post OpenGraph and Twitter card metadata, plus generated OG images.
- Pagination via `rel="next"`/`prev`, and crawlable pagination links even when the UI uses infinite scroll.

---

## 6. Performance and scale

**Build items beyond the architecture doc:**

- **Caching layer.** `spaces.feed.cacheSeconds` exists as a setting with no implementation behind it. Anonymous Popular and All feeds are identical for every visitor and are the highest-volume queries on the site.
- **Read replicas** for feed queries, with the vote write path pinned to the primary to avoid read-your-writes surprises on the thing users watch most closely.
- **Hot-post comment loading**: a 10,000-comment thread cannot ship as one payload. Top-N plus lazy expansion, which the `sortPath` design already supports.
- **N+1 audit.** The plan specifies batched hydration; it needs a test that asserts query count per feed page, otherwise it regresses the first time someone adds a field.
- **Index verification in CI** — `scripts/syncIndexes.js` exists; assert every documented index is present rather than trusting it.
- **Slow query logging** with a threshold, surfaced in the admin portal.
- Connection pool sizing for a write-heavy workload, which is materially different from the current read-heavy one.
- **Load test before launch**, not after: the vote path and the home feed at realistic depth. The architecture doc's targets — feed under 100ms at 1M posts, vote under 50ms — need to be verified rather than asserted.

---

## 7. Data lifecycle

### 7.1 Account deletion — harder than it looks

Deleting a user with 4,000 posts and 30,000 votes has no single right answer.

- **Posts and comments:** anonymize rather than delete. Deleting them destroys other people's threads — a comment with 40 replies cannot vanish. This mirrors the `anonymizeUser` approach `contentGuardService` already takes for financial records.
- **Votes:** keep, anonymized. Deleting them silently rewrites every score on the site.
- **Owned spaces:** cannot be orphaned. Transfer to the longest-serving moderator, or archive if there is none. Decide before the first deletion request, not during it.
- **A grace period** — 30 days, reversible — prevents the rage-quit-and-regret support ticket, which is otherwise a guaranteed recurring cost.
- **Preserved child-safety material overrides erasure**, and the policy must say so explicitly.

### 7.2 Retention and backup

- Per-collection retention: votes forever, IP addresses 90 days, raw view events per `spaces.analytics.retainRawDays`, moderation logs indefinitely.
- **Test the restore.** An untested backup is not a backup, and the community is a new set of collections that a novel-focused backup script may not include.
- Point-in-time recovery for the moderation and audit collections specifically.
- Documented RTO and RPO.

---

## 8. Observability

- Structured logging with a request ID threaded through, extending the existing `requestLogger`.
- Error tracking (Sentry or equivalent) with source maps.
- **Business metrics as alerts, not just charts:** posts per hour, votes per hour, report queue depth, signup rate. A sudden drop in posts is an outage signal long before a health check fails.
- Uptime monitoring on the real user path — `/health` deliberately does not touch the database, so it will pass during a total database outage.
- Feature-flag kill switches per subsystem. `spaces.enabled` covers the whole community; voting, media and link previews each want their own.
- A status page.

---

## 9. Community health and growth

The cold-start problem is the most likely way this fails, ahead of every technical risk in this document.

**Build items:**

- **Onboarding:** interest picker at signup that auto-joins 3–5 spaces. Without it, the Home feed is empty and the user leaves.
- **Seeded content:** admin-created spaces with real posts before public launch. An empty forum reads as abandoned.
- **First-post support:** templates, prompts, and a visible "new here" flair so the community is gentler.
- **Retention loops:** digest email of top posts in your spaces, reply notifications, streaks — with a hard rule that notifications must never become the product.
- **Health metrics per space:** the ratio of posters to lurkers, comment-per-post ratio, new-member retention at 7 and 30 days, and moderator response time. Surface these to space owners, not just admins — a mod who can see their community dying can act on it.
- **Space discovery:** trending spaces, similar spaces, topic browse, and a genuinely good search.
- **Contributor recognition:** top contributor of the month, milestone badges. Cheap to build, disproportionate effect on retention.

---

## 10. Feature parity gaps

Present in every Reddit-class platform, absent from the current architecture doc. Not all are v1, but each is a decision:

| Feature | Notes |
|---|---|
| **User blocking and muting** | A safety feature, not a nicety. Blocked users' content hidden both ways. Users will ask for this within the first week |
| **Drafts and autosave** | Losing a long post to a navigation is the most infuriating bug a forum can have |
| **Crossposting** | Share a post to another space with attribution |
| **Mentions** | `@username` with autocomplete, notification and an opt-out |
| **Direct messages / modmail** | Modmail is close to mandatory — mods need a channel with users about a ban. DMs are a large abuse surface and a separate decision |
| **Following users** | Feed of people rather than spaces |
| **Space wiki / pinned resources** | Where the FAQ lives, so the same question is not answered 400 times |
| **Scheduled posts** | Mod announcements, recurring threads |
| **Post templates** | Structured submissions per space; dramatically raises post quality |
| **Multi-space feeds** | Custom collections of spaces |
| **Content warnings** | Beyond binary NSFW/spoiler |
| **Best answer / solved** | Turns a Q&A space into a resource |
| **Embeds** | YouTube, video, code blocks with highlighting |
| **RSS feeds** | Per space and per user. Cheap, and it gets the platform into aggregators |
| **Keyboard shortcuts** | Already in the plan; the strongest signal of a serious product |
| **Post edit history** | Public diff. The single best deterrent to bait-and-switch editing |
| **Duplicate detection** | Warn at submit, not after |
| **Translation** | If the audience is international |

---

## 11. Internationalization

If the platform is not English-only:

- i18n framework, with all UI strings extracted from day one — retrofitting this across a large component tree is miserable.
- RTL layout support (Arabic, Hebrew).
- Per-space language, and a language filter on feeds.
- Locale-aware relative dates and number formatting.
- Unicode-safe text handling throughout: length limits counted in graphemes, not bytes; **homoglyph detection on space slugs and usernames**, or impersonation is trivial.
- Non-Latin search — MongoDB text indexes handle CJK poorly, which pushes the search decision earlier than planned.

---

## 12. Email

The plan adds reply notifications and digests to a system currently sending transactional mail only. Volume changes the problem.

- SPF, DKIM and DMARC — without them, digests go to spam and take the password-reset mail with them.
- Dedicated subdomain for bulk mail, keeping transactional reputation separate.
- One-click unsubscribe (RFC 8058) — now effectively required by major providers for bulk senders.
- Bounce and complaint handling with automatic suppression.
- Digest batching and frequency caps, per user.
- Preview and test-send from the admin portal before a broadcast.

---

## 13. Revised phase plan

This supersedes §13 of the architecture doc.

> **Working from this?** Use [`implementation-plan/`](./implementation-plan/) instead — one file per phase, each with the files to touch, schema notes, tests and a definition of done. This section is the summary those files expand on.

**The organising rule: anything that costs nothing to do now, and is expensive or impossible to retrofit, is in the plan.** Everything else is deferred and lives in [`scalability.md`](./scalability.md) or in the deferred list at §13.12.

Three markers:

- **BLOCKING** — must ship with its phase. Legal, safety or security exposure otherwise.
- **FREE** — costs essentially nothing now (a schema field, an interface, a naming decision, a test) and is painful later. This is most of what follows.
- No marker — normal build work.

### 13.0 Phase 0 — Foundations *(complete)*

Shipped: `config/settings/spaces.js`, registry wiring, community constants, `config/linkTypes.js`, `middlewares/dynamicUpload.js`, admin Community tab.

Still to land in this phase:

- **BLOCKING** Server-side HTML sanitizer on write, strict allowlist. `sanitizeContent.js` is a client-side presentation cleaner and cannot serve this purpose (§3.2).
- **BLOCKING** Content-Security-Policy header.
- **FREE** `services/cacheService.js` — `wrap(key, ttl, fn)` / `invalidate(prefix)`, backed by an in-process Map with a TTL and a size cap.
- **FREE** `services/counterService.js` — every denormalized counter update goes through it. Direct `$inc` today; batched or bucketed later without touching a call site.
- **FREE** `services/jobDispatcher.js` — `enqueue(name, payload)`, executing inline today.
- **FREE** `services/classificationService.js` — null implementation returning "no opinion". Vendor plugs in later at one site.
- **FREE** Rate-limit storage extracted behind `{ incr(key, windowMs) -> count }`, in-memory implementation retained.
- **FREE** Per-subsystem kill switches: `spaces.voting.enabled`, `spaces.media.enabled` and `spaces.posting.fetchLinkPreviews` already exist; add one for search and one for notifications.
- **FREE** `spaces.safety.jurisdictionMode` — `standard | uk | eu | strict`.
- **FREE** `ROLES.SAFETY_ADMIN` constant, for the restricted child-safety queue (§1.3). Adding a role later means auditing every `adminOnly` check.
- **FREE** i18n string extraction convention agreed and applied from the first component. Retrofitting this across a finished component tree is miserable and is the single most commonly regretted omission on this list.

### 13.1 Phase 1 — Spaces and membership

- `Space`, `SpaceMember`, `Flair`, `spacePermissionService` including `canCreateSpace` and the approval queue, space CRUD, join/leave, rules, flairs.
- **FREE** Every model carries its future shard-key field from creation (scalability §4.1).
- **FREE** `services/community/` module layout. No community module touches another module's collections directly.
- **FREE** Every array bounded by a setting, with the bound enforced on write (scalability §4.3).
- **FREE** Slug validation: reserved words, and **homoglyph normalisation** — without it, impersonating a space is trivial and renaming after the fact breaks every link.
- **FREE** Contrast validation on a space's accent colour at save time. A space owner must not be able to create an inaccessible page (§4).
- **FREE** `Space.language` field.
- **FREE** `Space.slowMode` and `Space.lockdown` fields, unused until Phase 5. Adding fields to a large collection later is a migration.
- **FREE** `User.ageAssurance` object and `User.spaceCreation` policy (already specced).
- **FREE** Space ownership-transfer policy decided and implemented in the delete path: transfer to longest-serving moderator, else archive. Deciding this during the first deletion request is how spaces get orphaned (§7.1).

### 13.2 Phase 2 — Posts, votes, feeds

- `Post`, `Vote`, `rankingService`, `feedService`, post CRUD, vote endpoint, cursor pagination.
- **BLOCKING** Explicit field allowlists on every update. A `PATCH` that spreads `req.body` lets a user set their own `score`.
- **BLOCKING** IDOR test matrix across every role × action × space state.
- **FREE** `Vote.space` populated on every write, and `Vote.nullified` boolean present from the start. Both are unqueried until later; adding either to a 500M-row collection is a migration measured in hours of downtime.
- **FREE** `Vote.fingerprint` (hashed, retention-limited) — the single most useful alt-account signal, and worthless if collection starts after the abuse does.
- **FREE** ESR field order on every compound index, with tests asserting an `IXSCAN` plan and no in-memory `SORT` stage. An index in the wrong order still gets used and still sorts in memory — it looks correct in a glance at `explain()`.
- **FREE** Sparse and partial indexes where they apply — `linkedRefs`, the report queue, admin-only paths.
- **FREE** Read preference annotated at every call site (scalability §4.7). "My vote state" and post-create redirect are `primary`; feeds are `secondaryPreferred`. Retrofitting this judgement across a hundred call sites is the expensive part of adding replicas.
- **FREE** Batch hydration only. No `populate` in a loop, no `$lookup` in a feed query, plus a test asserting queries-per-request is constant. That test is the N+1 alarm.
- **FREE** `rankingService` kept pure — scores in, scores out, no I/O.
- **FREE** Admin "move post to another space" implemented as delete-and-recreate. A shard key value cannot be updated in place, so the obvious implementation stops working the day sharding arrives.
- **FREE** `rel="nofollow ugc"` on every user-submitted link. Without it the community becomes an SEO spam target within weeks, and adding it later does not undo the reputation damage.
- **FREE** `spaces.scale.maxJoinedSpaces` (default 500) bounding the home feed `$in`.
- **FREE** Post title and body length limits counted in **graphemes**, not bytes or UTF-16 units.
- **FREE** User-uploaded images served with `Content-Disposition` or from a separate origin, so a file that slips past the mime check cannot execute in the app's origin.

### 13.3 Phase 3 — Comments

- `PostComment`, threaded fetch, lazy replies, comment votes.
- **FREE** `PostComment.post` denormalized on every reply including deep ones, never derived by walking `ancestors`.
- **FREE** `spaces.scale.commentTreeMaxNodes` capping one payload.
- **FREE** `PostRevision` written on every edit from the first edit. Edit history cannot be reconstructed retroactively, and a public diff is the strongest deterrent to bait-and-switch editing there is.
- Mentions with autocomplete, notification and opt-out.

### 13.4 Phase 4 — Rich content

- Media upload, link previews, polls.
- **BLOCKING** SSRF-hardened fetcher (§3.1): scheme allowlist, resolve-then-pin-to-IP, private range blocks, re-validation on every redirect hop, redirect cap, size cap, timeout, and no reflected fetch errors.
- **BLOCKING** Perceptual-hash CSAM scanning before any uploaded image is publicly readable (§1.3).
- **BLOCKING** `ChildSafetyIncident` model, outside the normal moderation flow, with preservation semantics a moderator cannot delete around.
- **FREE** `alt` field on every media item, prompted in the composer. Retrofitting alt text means every image uploaded before the change is permanently inaccessible.
- **FREE** EXIF stripping on by default (setting already exists) — without it, user photos leak home addresses.
- **FREE** Link previews, thumbnail generation and hash checks all go through `jobDispatcher`, never inline in the request.
- **FREE** Link domain recorded in a bucketed form on the post, for later brigade and spam analysis.

### 13.5 Phase 5 — Moderation

- `Report`, `ModAction`, `communityGuardService`, mod endpoints, auto-hide, bans.
- **BLOCKING** `StatementOfReasons` as a first-class record — legal or policy ground, specific rule ID cited, whether detection was automated, content snapshot, appeal deadline. A free-text `reason` string does not satisfy the DSA and cannot be upgraded after the fact for actions already taken (§1.1).
- **BLOCKING** `Appeal` model and flow, with human review.
- **FREE** `Report.reporterEmail` and `reporterType`, so the public unauthenticated reporting endpoint the DSA requires is a route addition rather than a schema migration.
- **FREE** `Report.claimedBy` / `claimedAt`, so two moderators cannot action the same item.
- **FREE** `Report.classificationScores`, so thresholds can be calibrated from real data later.
- **FREE** `User.trustedFlagger`, `User.strikes` and `User.warnings` fields.
- **FREE** Community Guidelines given **stable rule IDs**, and every enforcement action referencing one. Rules that are only prose cannot be cited, counted, or appealed against consistently.
- **FREE** Shadowban filtering routed through the single permission choke point, so it is consistent across feed, search, notifications and direct link. Scattered checks guarantee a leak.
- **FREE** User blocking implemented at the same choke point — a safety feature users ask for in week one.
- Slow mode and lockdown wired to the Phase 1 fields; modmail; classification thresholds.

### 13.6 Phase 6 — Admin portal

- `SpacesAdmin`, `SpaceRequestsAdmin`, `SpaceDetailAdmin`, `CommunityPostsAdmin`, `CommunityReportsAdmin`, `CommunityModlogAdmin`.
- Child-safety escalation queue, visible only to `SAFETY_ADMIN`.
- Transparency report generator over `ModAction` / `Report` / `Appeal` rollups.
- Vote anomaly review queue.
- **FREE** Moderator health metrics in the insights rollup: queue depth, time to resolution, actions per mod, mods inactive N days. Moderator attrition is the most common cause of community collapse and it is entirely measurable — but only if the fields are being written from the start.
- Slow-query panel, counter rebuild trigger, index-health view.

### 13.7 Phase 7 — Public UI

- Feed hub, space page, post detail, composer, comment tree, profiles, mod tools.
- **Rendering settled:** client-side only, no SSR or prerendering. Cost and reversal path recorded in [Phase 7](./implementation-plan/phase-07-public-ui.md).
- **FREE** WCAG 2.2 AA built in, not audited in afterwards: semantic headings, landmarks, `role="tree"` with arrow-key traversal on comments, `aria-pressed` vote buttons with a live region, focus management on infinite scroll, `prefers-reduced-motion`, 44×44px targets. Retrofitting accessibility into a finished component tree costs several times what building it in does.
- **FREE** Canonical URLs, with every sort and filter variant canonicalising to the post's canonical path.
- **FREE** Segmented XML sitemaps, `robots.txt` blocks on sort and filter variants, `DiscussionForumPosting` and `Comment` structured data, per-post OpenGraph metadata.
- **FREE** Drafts with autosave. Losing a long post to a stray navigation is the most infuriating bug a forum can have.
- **FREE** axe-core in CI.

### 13.8 Phase 8 — Polish and scale

- Notifications, karma, search, rollups, `CommunityInsights`.
- Email: SPF, DKIM, DMARC, dedicated bulk subdomain, RFC 8058 one-click unsubscribe, bounce and complaint suppression.
- Feed caching switched on; `spaces.scale.*` settings; vote archival job; notification fan-out batched.
- Onboarding interest picker with auto-join; seeded spaces before public launch.
- Per-space health metrics surfaced to space owners, not only admins.

### 13.9 Phase 9 — Hardening

- **BLOCKING** Account deletion cascade: anonymize posts, comments and votes rather than deleting them; transfer or archive owned spaces; 30-day reversible grace period.
- **BLOCKING** Self-serve data export.
- **BLOCKING** Retention purge jobs, including `spaces.privacy.ipRetentionDays` (default 90).
- **BLOCKING** Backup restore actually tested against the new collections.
- Security review, accessibility audit, load test against the capacity model in scalability §3.
- Monitoring, including the two early alarms: queries-per-request on the feed, and vote index size as a percentage of instance RAM.

### 13.10 Phase 10 — Compliance

- **BLOCKING** Registered DMCA agent, takedown intake separate from the general report queue, counter-notice flow, enforced repeat-infringer policy, `CopyrightClaim` with strike accounting.
- **BLOCKING** Policy documents: Terms, Community Guidelines with stable rule IDs, Privacy Policy, Moderator Code of Conduct, Law Enforcement Response Guide.
- **BLOCKING** Privacy records of processing, consent records, breach runbook with a named owner.
- Age assurance vendor integration, if UK or EU children are in scope.
- Children's access assessment, stored and versioned with an annual reminder.

### 13.11 One decision still outstanding

**Which jurisdictions are in scope** — determines whether Phase 10 moves earlier and whether age assurance is required.

**Rendering was settled on 15 Aug 2026: client-side only.** No SSR, no prerendering. The community ships as part of the existing Vite SPA. Cost, the two codebase constraints behind it, and the reversal path are recorded in [Phase 7](./implementation-plan/phase-07-public-ui.md).

Everything else previously listed as an open decision has been resolved into either a FREE item above or a deferred stage in the scalability doc.

### 13.12 Explicitly deferred

Not in any phase. Each is behind an interface that already exists, so adopting it later is a swap rather than a rewrite.

| Deferred | Interface it sits behind | Revisit when |
|---|---|---|
| Redis | `cacheService`, rate-limit store | Scalability Stage 4 |
| Message queue | `jobDispatcher` | Stage 5 |
| Search engine | `searchService` | Stage 6 |
| Bucketed counters | `counterService` | Stage 4.6 |
| Read replicas | Read preference annotations | Stage 3 |
| Sharding | Shard-key fields already present | Stage 8 |
| Service extraction | `services/community/` boundaries | Stage 7 |
| ML classification vendor | `classificationService` | When banned-word lists stop coping |
| Age assurance vendor | `User.ageAssurance` | Phase 10, if in scope |
| Monetization | See [`monetization-phase2.md`](./monetization-phase2.md) | After the community is healthy |
| Direct messages, following, wiki, scheduled posts, crossposts, multi-space feeds, RSS, translation | — | Post-launch, on demand |

---

## Sources

- [The EU Digital Services Act – Europe's New Regime for Content Moderation, Morrison Foerster](https://www.mofo.com/resources/insights/220920-the-eu-digital-services-act-europes-new-regime)
- [Notice and Action Mechanisms in the DSA, Crowell & Moring](https://www.crowell.com/en/insights/client-alerts/notice-and-action-mechanisms-in-the-dsa-balancing-the-removal-of-illegal-content-and-the-freedom-of-expression)
- [The EU Digital Services Act: Ready to meet reporting obligations?, IAPP](https://iapp.org/news/a/the-eu-digital-services-act-ready-to-meet-reporting-obligations)
- [Ofcom — Use of Age Assurance Report 2026](https://www.ofcom.org.uk/online-safety/protecting-children/use-of-age-assurance-report-2026)
- [UK Online Safety Act: Age Assurance and Children's Access Statement, Cooley](https://uklitigation.cooley.com/uk-online-safety-act-age-assurance-and-childrens-access-statement/)
- [Age Assurance in 2026: what do digital businesses operating in the UK and EU need to know?, Lewis Silkin](https://www.lewissilkin.com/insights/2026/04/17/age-assurance-in-2026-what-do-digital-businesses-operating-in-the-uk-and-eu-need-to-know)
- [18 U.S.C. § 2258A — Reporting requirements of providers](https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title18-section2258A&num=0&edition=prelim)
- [The REPORT Act Explained, Thorn](https://www.thorn.org/blog/the-report-act-explained/)
- [New Minor Safety Obligations for Online Services: REPORT Act, Wilson Sonsini](https://www.wsgr.com/en/insights/new-minor-safety-obligations-for-online-services-report-act-expands-child-sexual-exploitation-reporting-requirements.html)
- [How Reddit's Vote Manipulation and Sockpuppet Detection System Works, Conbersa](https://www.conbersa.ai/learn/how-reddit-vote-manipulation-detection-works)
- [Brigading and Vote Manipulation on Reddit, Media Removal](https://mediaremoval.com/brigading-and-vote-manipulation-on-reddit/)
- [Best Practices For Digital Community Safety, TELUS Digital](https://www.telusdigital.com/insights/trust-and-safety/article/digital-community-safety-best-practices)
- [Bluesky 2025 Transparency Report](https://bsky.social/about/blog/01-29-2026-transparency-report-2025)
- [OWASP Server Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [How DNS Rebinding Turns SSRF Into a Cloud Takeover](https://medium.com/@zeeshan1337/how-dns-rebinding-turns-ssrf-into-a-cloud-takeover-c14015d17468)
- [Understanding the European Accessibility Act and WCAG 2.2, OneTrust](https://www.onetrust.com/blog/understanding-the-european-accessibility-act-and-wcag-22/)
- [EU Accessibility Requirements and EAA Compliance, Level Access](https://www.levelaccess.com/blog/eu-accessibility-requirements-and-eaa-compliance/)
- [How to Maintain Indexation Quality on Huge Websites, Hashmeta](https://hashmeta.com/blog/how-to-maintain-indexation-quality-on-huge-websites/)
- [Crawl Budget Optimization for Websites with 100K+ Pages, Hashmeta](https://www.hashmeta.ai/en/blog/crawl-budget-optimization-for-websites-with-100k-pages-a-complete-technical-seo-guide)
