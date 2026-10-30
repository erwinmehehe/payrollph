# WRK-02 workforce-planning write-boundary hardening

**Status:** DRAFT / zero new tenant-method credits / NOT ACCEPTED / not production-certified.

## Ownership and scope

This is an independent WRK-02 source-hardening slice. It does not touch open PR #1608's contractor mutations, #1607's PII proof, #1605's schema parity, #1602's Performance methods, or #1593's DL-02 proof promotions. Shared manifest and its inventory guard are updated solely to pin the three changed routes and document zero-credit review.

- `PATCH /api/workforce-planning/scenarios`: A row lock and re-read are bound to the originally authorized employer. Before inserting an approval or writing an audit receipt, verify the scenario still has the same visible unit, linked plan, worksite and immutable snapshot hash. Condition the scenario and linked-plan writes on the same employer and expected state. Conflict aborts the transaction.
- `POST/PATCH /api/workforce-planning/position-executions`: Cancelling, reopening and applying previews include the employer and previously authorized execution hash in the final SQL predicates. The apply transaction also checks the still-locked plan, baseline and hash against the authorized preview before positions change. Missed predicates fail closed, with no success audit.
- `POST /api/workforce-planning/transfer`: Close an assignment only when employer, worker and original position still match. Condition current/target position writes on employer and expected state, and require the target to remain in the originally authorized unit. Require the worker to remain active and in the original unit before writing employment history. Any stale conditional write rolls back all transaction changes and responds 409 before audit, HCM obligations or automation.

Existing same-origin, session, role, org-unit, demo, tenant plan gate, MFA, policy and maker/checker flows remain unchanged.

## Source contract and evidence

- Focused test: `node --test tests/tenant-wrk02-planning-write-boundaries.test.mjs`. Checks individual mutation predicates, authorization ordering, defensive 409 outcomes, unchanged GET source prefixes and negative controls that remove one employer predicate.
- Full API ledger is **unchanged** on starting `main@ff0ba9f27503aebf69837c3aa18425f5be16c18c`: 498 methods = 354 COVERED / 10 PUBLIC-BY-DESIGN / 134 GAP, plus 17 page/action GAPs. Two older WRK-02 GET credits remain provisional, backed only by their pre-existing fictional tenant-table proof. The other five affected POST/PATCH methods remain GAP.
- The `reviewedUncertified` metadata is source-only, exact-blob-pinned and explicitly `coverageCredits: 0`. It does not accept a static check as real tenant-isolation evidence.
- Before merge: focused source-contract test, exact-head CI TypeScript/lint/regression checks, disposable PostgreSQL 16 authenticated own/foreign/forged HTTP proof for each changed method and every action, unchanged victim business/audit/payroll snapshots, and independent tenant-security/coverage-owner review.
- **Not executed in this session:** real HTTP/PG16 proof, full local test suite, deployment or production staging. No real employer data, providers, payouts, bank account details, migrations, feature flags, SQL execution or live payroll are involved.
- **Limits:** This does not eliminate all cross-tenant concurrency windows or independently certify the complete WRK-02 family. Any later source edit invalidates this snapshot and requires renewed review. Roll back with a normal revert.

## Reviewable file set

Three WRK-02 route files, `scripts/qa/tenant-isolation-coverage-manifest.json`, `tests/tenant-isolation-coverage-inventory.test.mjs`, the new focused contract and this note. No changes to the shared SQL schema or workflow jobs are required to inspect the source-only patch.
