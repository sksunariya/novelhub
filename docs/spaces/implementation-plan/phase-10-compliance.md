# Phase 10 — Compliance

**Status:** Not started — **scope depends on an unresolved decision**
**Depends on:** Phase 5 (data model), Phase 9 (retention)
**Blocks:** public launch in the affected jurisdictions
**Reference:** [readiness](../platform-readiness.md) §1, §13.10

---

## ⚠ Decide first: which jurisdictions are in scope

This phase's size varies by roughly 4× depending on the answer.

| Answer | What it pulls in |
|---|---|
| US only | DMCA, CSAM reporting (already Phase 4), COPPA via a 13+ minimum, policy documents |
| **+ EU** | Full DSA: public reporting endpoint, transparency reports, trusted flaggers, published point of contact |
| **+ UK** | Online Safety Act: risk assessments, children's access assessment, **highly effective age assurance** — a vendor integration and a real cost |

The DSA applies to any platform offering services to EU users regardless of where it is hosted. In practice, an open community on the public internet is in scope for all three unless access is actively restricted.

`spaces.safety.jurisdictionMode` (declared in Phase 0) selects which duties are enforced, so one deployment can serve multiple regimes.

---

## BLOCKING — DMCA safe harbour

Safe harbour is conditional. Losing it means direct liability for every infringing post on the platform.

- **Registered agent** with the US Copyright Office, published on the site.
- **Dedicated takedown intake**, separate from the general report queue — different legal timeline, different retention.
- **Counter-notice flow** with the statutory waiting period and restoration if no suit is filed.
- **Repeat-infringer policy, tracked and actually enforced.** Courts have voided safe harbour over exactly this. `CopyrightClaim` with strike accounting per user; `User.strikes` already exists from Phase 1.

---

## BLOCKING — policy documents

Not code, but launch-blocking. Every enforcement action references a rule by ID, which is why the guidelines need stable identifiers (established Phase 5).

- Terms of Service, covering the UGC licence
- **Community Guidelines with stable rule IDs**
- Privacy Policy and Cookie Policy
- Moderator Code of Conduct
- Law Enforcement Response Guide

---

## BLOCKING — privacy operations

- **Records of processing** — what community data is collected, why, retained how long, shared with whom.
- **`ConsentRecord`** for analytics and marketing email: timestamp, policy version, withdrawal.
- **Breach runbook with a named owner.** A 72-hour notification obligation means detection and an owner, not a document.
- **13+ minimum** enforced at signup, unless verifiable parental consent is being built — which it is not.

---

## DSA, if the EU is in scope

- `POST /api/reports/public` — unauthenticated, rate-limited, captcha-protected. The DSA requires *anyone* to be able to report, not just account holders. `Report.reporterEmail` and `reporterType` already exist from Phase 5, so this is a route addition.
- **Transparency report generator**, publishable, over `ModAction` / `Report` / `Appeal` rollups.
- **Trusted flaggers** — `User.trustedFlagger` (Phase 1) priority-sorts their reports.
- **Published electronic point of contact** for authorities and users.
- `StatementOfReasons` (Phase 5) already satisfies the Article 17 requirement, provided the pseudonymised submission to the DSA Transparency Database is wired up.

---

## UK Online Safety Act, if in scope

- **Illegal content risk assessment**, stored and versioned.
- **Children's access assessment**, repeated at least annually and before significant design changes. `spaces.safety.childrenAccessAssessment` stores it with a review date and an admin reminder, so the obligation is tracked rather than remembered.
- **Highly effective age assurance** where primary priority content exists. Ofcom is explicit that self-declaration is not sufficient. `User.ageAssurance` (Phase 1) is the integration point — **integrate a vendor, do not build verification.**
- NSFW spaces gated on verified adult status, not a self-declared checkbox.

---

## Definition of done

- [ ] Jurisdiction decision made and `jurisdictionMode` set
- [ ] DMCA agent registered and published
- [ ] Counter-notice flow tested end to end
- [ ] Repeat-infringer strikes accruing and enforced
- [ ] All policy documents published; rule IDs referenced by live enforcement actions
- [ ] Records of processing complete
- [ ] Breach runbook owned and rehearsed
- [ ] EU: public reporting endpoint live, transparency report generating
- [ ] UK: assessments stored, age assurance integrated if required
