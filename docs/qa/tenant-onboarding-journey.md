# Onboarding to first-payroll readiness: fictional tenant proof

This main-based batch targets exactly four previously uncredited methods:

| Method | Executed owned behavior |
| --- | --- |
| POST employees | Create worker, pay profile, five onboarding tasks and an assigned fictional workstation/device |
| PATCH employees | Encrypted government identity, start-date correction, effective rest-day revision, audited pay-profile revision and separate initial payout setup |
| POST employees/import | Legacy create and validation-only batch; preview/receipt-bound atomic commit; duplicates and invalid rows refused |
| POST recruitment/hire | Submit and retry the same pending request, genuine independent HR approval over HTTP, then convert exactly once |

## Reproduced defects and fixes

1. A real employee PATCH with `startDate: "2026-01-06"` returned HTTP 400 because
   the existing start-date regex matched escaped text instead of digits. Reuse
   the existing `validIsoDate` calendar validator for employee creation, start-date,
   pay-effective and rest-day-effective corrections, and candidate hire intake.
   Impossible dates such as February 30 now fail validation before PostgreSQL.
   The existing future-date, payroll-history and chronological revision guards
   remain in place.
2. A real legacy CSV create persisted `legalEntityId: null`, even though the
   fictional employer had an active primary legal employer. Canonical payroll
   preview then classified that worker as belonging to another legal employer.
   The legacy import now resolves the employer inside the existing transaction
   and inserts that employer with every worker. An inactive employer returns
   422 and rolls back, matching the existing preview-import safety boundary.

The employee-directory GET and import-history GET bodies are unchanged. No
schema or migration, provider call, live feature flag, payroll calculation,
release rule, independent approval rule or existing shared proof line is changed.

## Executed local evidence

Native PostgreSQL 16.14 in a **new task-owned cluster**, localhost port 5434,
with a production-mode Next.js server on port 3014. Every positive run begins
with a fresh database. Legacy and preview-enabled imports run separately.
No existing developer database was reset or migrated.

Across the two profiles:

- 38 successful owned actions, for two independently authenticated attackers;
- 38 real victim-employer denials, 30 forged-reference denials;
- 64 additional refusal/negative cases and 19 cross-attacker discrimination checks;
- actual populated victim rows have higher IDs than both attackers and exceed 6;
- victim employees, entities, units, profiles, assets, devices, imports, candidate/
  position/assignment/process/approval records, payroll rows and business audit
  fields remain unchanged after every owned action and denial;
- separate HR checker approves a real pending task; the maker is refused;
- duplicate intake/conversion, invalid dates, invalid CSV, inactive employer,
  stale preview receipt and foreign department are refused without partial writes;
- replacing a new employee proof with a no-op makes the live run fail with
  `proof accepts another employer's data`; restored proof reruns pass.

The actual canonical first-payroll GET includes the direct-entry and hired
workers, is read-only, and correctly returns `previewReady: false` with `null`
amounts while required company schedule/reviewer evidence is missing. **This
does not claim a ready first payroll, verified statutory calculations, bank
settlement or a successful release.**

See [the sanitized source-bound receipt](tenant-onboarding-receipt.json). The
runner grants zero credits. Only this explicit scoped command generates the four
reviewable provisional method credits and recalculates the inventory and closure
plan:

```text
node scripts/qa/tenant-table-credit.mjs --onboarding --run-label "<receipt runLabel>"
```

Starting main `ff0ba9f27503aebf69837c3aa18425f5be16c18c` has 354 COVERED,
134 GAP and 10 PUBLIC methods of 498. The proposed branch is 358 / 130 / 10.
Counts are provisional, not merged-main recovery or tenant-wide certification.
No methods from open Performance, planning, PII or prior-evidence PRs are borrowed.

## Acceptance and limits

Local final-tree verification: full tenant suite 996 passed / 7 skipped / zero
failures; focused receipt/inventory checks 34 passed; existing import/hire/date
regressions 34 passed / 1 CI-only PostgreSQL case skipped. Full lint has zero
errors and 10 existing baseline warnings; TypeScript, YAML, source-size and
repin checks pass (1708 unchanged citations, 20 new, zero repinned/review).

The dedicated `tenant-onboarding-http.yml` workflow executes both profiles in
disposable PG16 and uploads actual run summaries. New exact-head CI and reviewer
acceptance are pending. Locally, the CI-owned app_db-only payout-export integration
is NOT_RUN; its existing guard remains unchanged and CI is still required.

Multi-entity enabled paths, Treasury Controls enabled payout-request creation,
self-serve billing-provider activation and real-employer payroll are outside this
bounded proof. The initial payout action only stores fictional encrypted setup
before any payroll entry; it does not transmit money or bypass later review.
Only disposable, process-local import-preview and read-only first-payroll flags
are enabled. Provider, payout execution, worker and scheduler flags stay OFF.

Keep the PR draft until exact-head checks and review complete. Ordinary revert is
the rollback; preserve the date and legal-employer corrections if reverting only
proof infrastructure. No production or payroll deployment authorization is granted.
