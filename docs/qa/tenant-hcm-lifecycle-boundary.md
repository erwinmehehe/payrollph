# HCM lifecycle notification tenant boundary (review-only)

**Scope:** GET and PATCH /api/hcm/lifecycle-notifications. This is a separate HCM lifecycle-notification family; it does not alter filing outcomes, document upload, payroll-tax rules, enterprise administration, financial operations, or the shared tenant-isolation coverage manifest.

## Threat and correction

- Before the change, GET selected an organization-owned notification task but joined its employee using employee ID alone. The schema has two independent foreign keys; a mismatched task can therefore project an employee name and number from a different organization. The read now correlates task and employee organization IDs inside the SQL JOIN, and keeps the existing role/owner filter.
- PATCH previously selected the task for the organization, but the update used only the global task ID. Its task state, lifecycle event and audit receipt were separate database writes. PATCH now locks the organization-scoped task with a same-employer employee in one transaction, rechecks owner/admin authority while locked, writes the business update with an organization predicate, then writes event and audit through the same transaction. Any insert failure rolls the update back.
- Invalid/unsafe organization or task IDs are rejected. Sensitive responses are private/no-store. Same-origin and sensitive-action rate limits remain in place. Audit/database errors return a generic 500 rather than a successful or misleading conflict response.

## Evidence in this PR

- A real PostgreSQL fixture test uses two synthetic employers, two synthetic employees and an intentionally mismatched task: the Alpha viewer cannot read the Beta employee identity, whether acting as an administrator or a task owner. The Beta employer's proper task remains readable.
- A source-contract test guards the correlated join, tenant-predicated updates, row lock, transaction-scoped event/audit inserts, and request protection. Existing HCM lifecycle tests remain in CI.

## Verification and limits

- Run: npm ci; npm run typecheck; node --test tests/tenant-hcm-lifecycle-contract.test.mjs; npx tsx --test tests/tenant-hcm-lifecycle-boundary.test.ts (the latter requires a disposable schema-migrated PostgreSQL instance). Full repository CI and independent review must pass on the exact final head.
- These tests do **not** constitute authenticated, real-HTTP, two-attacker proof of PATCH success/refusal, event/audit veto rollback, race handling, or all lifecycle action variants. Those need an isolated PG16 HTTP harness and independent security review before any method can be credited.
- **No new tenant-isolation method credit.** Both GET and PATCH remain GAP / testedBy:null in the authoritative ledger. No production data, workers, payroll release, external messages or provider calls are involved; no feature flags changed.
- Rollback: revert this PR. No schema migration.
