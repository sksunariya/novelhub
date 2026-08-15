# Known Issues

Bugs found but deliberately not fixed yet, with enough detail to pick each one up cold.

None of these are caused by the community/spaces work — that is the point of writing them down separately rather than fixing them mid-feature.

| # | Issue | Severity | Found |
|---|---|---|---|
| [001](./001-emailqueue-teardown-crash.md) | `emailQueue` timer crashes the test process after teardown | Medium — masks other failures, breaks CI exit codes | 15 Aug 2026 |
| [002](./002-pre-existing-test-failures.md) | Nine pre-existing test failures across five suites | Medium — the suite is not a trustworthy signal until these are green or quarantined | 15 Aug 2026 |

## Conventions

One file per issue, numbered. Each states the symptom, the reproduction, the actual cause where known, the proposed fix, and why it was deferred. An issue is deleted when it is fixed, not marked closed — git history is the record.
