# HCM lifecycle notification tenant boundary (review-only)

**Scope:** GET and PATCH /api/hcm/lifecycle-notifications. This is a separate HCM lifecycle-notification family; it does not alter filing outcomes, document upload, payroll-tax rules, enterprise administration, financial operations, or the shared tenant-isolation coverage manifest.

## Threat and correction

- Before the change, GET selected an organization-owned notification task but joined its employee using employee ID alone. The schema has two independent foreign keys; a mismatched task can therefore project an employee name and number from a different organization. The read now correlates task and employee organization IDs inside the SQL JOIN, and keeps the existing role/owner filter.
- PATCH previously selected the task for the organization, but the update used only the global task ID. Its task state, lifecycle event and audit receipt were separate database writes. PATCH now locks the organization-scoped task with a same-employer employee in one transaction, rechecks owner/admin authority while locked, writes the business update with an organization predicate, then writes event and audit through the same transaction. Any insert failure rolls the update back.
- Invalid/unsafe organization or task IDs are rejected. Sensitive responses are private/no-store. Same-origin and sensitive-action rate limits remain in place. Audit/database errors return a generic 500 rather than a successful or misleading conflict response.

## Evidence in this PR

- A real PostgreSQL fixture test uses two synthetic employers, two synthetic employees and an intentionally mismatched task: the Alpha viewer cannot read the Beta employee identity, whether acting as an administrator or a task owner. The Beta employer's proper task remains readable.
- A source-contract test guards the correlated join, tenant-predicated updates, row lock, transaction-scoped event/audit inserts, and request protection. Existing HCM lifecycle tests remain in CI.
- A dedicated new source-current CI workflow exercises two independent authenticated employers, a real higher-ID victim, all four successful PATCH actions, company-admin and assigned-manager visibility, forged victim organization/task/owner identifiers, a corrupt cross-employer employee FK, and an injected audit INSERT veto for all four action types. Each veto must roll back the task update and event, and every victim database snapshot must remain unchanged. It runs only on fictional PG16 against 127.0.0.1 with providers/workers disabled; final-job results still determine whether this proof is valid.

## Executed historical caller reproof (one changed input only)

[GitHub Actions 42493142487 / job 128769634350](https://github.com/erwinmehehe/payrollph/actions/runs/42493142487/job/128769634350) **passed** on exact head `81fc9fe54d8485780f46fb0bb2529d6ca592fc11`. This job re-ran the original fictional PG16/HCM queue + four-action HMO caller suite with the updated HCM lifecycle-notifications route. Its actual log reports `DOCUMENT_CALLER_REPROOF`, `PASS`, 3 employers, 2 attacker accounts, 0 new credits and 0 provider calls.

Exactly one original transitive input changed: the HCM lifecycle-notifications route (`313428af8364c07b38010b5871a5b7f1d5246511` to `2ad17eb7fe188c72b9c11e0a094d01870adcc921`). The other 207 inputs must still match the original immutable historical receipt. The independent source-current [candidate receipt](../../scripts/qa/tenant-hcm-lifecycle-caller-source-refresh.json) and [fail-closed verifier](../../scripts/qa/tenant-hcm-lifecycle-caller-source-refresh-verify.mjs) certify **only the re-executed caller** for this exact source. The overall workflow was not green because the separate stronger audit-veto test failed on a cache-directive-order assertion; that assertion was corrected in a later commit and its dedicated rerun is required. No audit-veto success is claimed here.

## Verification and limits

- Run: npm ci; npm run typecheck; node --test tests/tenant-hcm-lifecycle-contract.test.mjs tests/tenant-hcm-lifecycle-boundary-http.test.mjs; run the dedicated workflow .github/workflows/tenant-hcm-lifecycle-boundary-http.yml for the real PostgreSQL/HTTP tests. The corrupted-FK direct DB test is opt-in and refuses non-disposable targets before import. Full repository CI and independent review must pass on the final proposed source.
- The dedicated workflow supplies an authenticated two-attacker, real-HTTP, audit-veto candidate, subject to a successful source-current run. Its results do **not** establish production behavior, full concurrent race safety or independent security acceptance. The historical caller proof receipt is immutable and must be supplemented, never silently re-pinned, when the changed route is validated.
- **No new tenant-isolation method credit.** Both GET and PATCH were already COVERED in the authoritative baseline manifest before this PR, from an older PG16 HCM queue proof; they are not two new recoveries. The human-readable inventory had stale GAP labels and must be reconciled with that baseline. Re-proof of this changed source and caller pins is mandatory before merge; independent review remains PENDING. No production data, workers, payroll release, external messages or provider calls are involved; no feature flags changed.
- Rollback: revert this PR. No schema migration.
