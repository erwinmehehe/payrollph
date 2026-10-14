# PR #886 — reconcile into existing HCM survey and goals foundations

**Source-only draft. Not a production release or privacy certification.**

## Why the original candidate was superseded

PR #889 has already merged a distinct, gated HCM survey and goals/review implementation. Its survey model stores only tenant-level sum and count and a separate employee participation record **without individual scores or timestamps**. Its goals/reviews entrypoint reuses the existing governed Performance model. PR #886 previously proposed another HMAC/score survey response table, another goal table, another pair of feature flags, and parallel URLs. Combining them would create two conflicting sources of truth. No legacy PR #886 data migration is authorized or assumed.

## What this revision keeps

- Existing mainline `ENGAGEMENT_SURVEY_ENABLED` and `GOALS_REVIEW_CYCLE_ENABLED` flags (strictly OFF unless separately approved).
- Existing `engagement_surveys`, `engagement_survey_participants`, Performance goals and review cycles.
- Existing 5-person, **closed-only** disclosure; now also fail-closed on impossible sums and malformed counts.
- Transactional creation/closure and their matching append-only audit receipts. If audit insertion fails, the survey state also rolls back. The legacy service-only close path now records an explicitly **unattributed** receipt instead of bypassing the audit; this is not evidence of human HR approval.
- Disposable PostgreSQL regression tests for atomic rollback, actual duplicate-open constraint handling, concurrent/tenant-isolated close idempotency, receipt metadata, legacy-call auditing, and malformed aggregate suppression. Audit receipt reads are ordered deterministically. The dedicated `HCM Gaps Focused Acceptance` job runs this test file alongside existing survey tests.
- An expected HTTP 409 duplicate-open-survey response is now tied to the specific `engagement_surveys_one_open_per_org` index; unrelated uniqueness/audit failures remain HTTP 503. Regression cases cover wrapped Postgres causes and false-positive conflicts.

## Scope removed from PR #886

No new HCM tables, unnumbered SQL proposals, privacy keys, parallel survey or goal APIs, duplicate employee interfaces, or new release-critical flags. Historical commits are preserved in the Git ancestry, but the PR's effective diff against main retains only the incremental corrections above.

## Still not complete

Privacy/DPO approval and retention decisions, canonical migration/receipt reconciliation for PR #889's schema, real employer/role/mobile acceptance, accessibility review, and the HCM/WFM source freeze remain separate gates. Do **not** enable surveys, apply live DDL, infer anonymity certification, or merge through a failing pilot-freeze check. Merge only after exact-head CI, real database acceptance, and the repository's authorized source review policy are met.
