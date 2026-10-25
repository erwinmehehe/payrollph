# F-04 — Immutable payroll calculation history

## Contract

When the explicit default-OFF `PAYROLL_CALCULATION_HISTORY_ENABLED=true` release gate is approved and activated, every **committed** employee calculation performed by the canonical queued payroll worker appends one historical revision to `payroll_calculation_history`. Current `payroll_entries` and payslips remain the replaceable draft working register; historical revisions are **not** the source of truth for bank transfers, payroll release, remittance or payslips.

- Key: tenant/organization, legal employer, payroll run, employee, processed payroll job and monotonically increasing `revision` per run/employee.
- Snapshot: period/pay date, rule version, exact 2-decimal gross/deductions/net, result status, signed line items and the rule/calculation trace. The already-sealed `trace.payment` data (account, name and phone) is deliberately **omitted** to avoid propagating sensitive payout information into long-lived audit history.
- Integrity: each revision records `previous_snapshot_hash` and a stable SHA-256 `snapshot_hash` over its JSON-safe snapshot. JSONB key ordering is normalized before hashing. These hashes are a change-detection aid, **not** externally signed evidence, hardware WORM storage or proof against a privileged database administrator.
- Write boundary: the worker checks a claimed processing job and a row-locked, eligible run/chunk. It inserts **all** chunk history, working register rows, payslips, run totals and job cursor/state in **one** database transaction. On error, no partial historical revision is committed. A repeated already-committed chunk cannot increment the history/release again.
- Revision 1 starts on the first committed calculation **after** this migration is applied. Re-enqueue of an eligible draft may replace current entries but must never delete previous history. Released/approved/certified period recalculation protections remain authoritative and unaffected.
- Preview: canonical first-payroll dry-run remains read-only. It neither creates a worker job nor writes revisions.

## SQL backstop and lifecycle

`drizzle/0137_immutable_payroll_calculation_history.sql` is the forward-only **reviewed** migration after 0136. It establishes unique job+employee and run+employee+revision indexes, consistency and chain validation on INSERT, immutability triggers rejecting UPDATE/DELETE/TRUNCATE, and grants the application role only SELECT/INSERT. It holds historical numeric IDs rather than FK-referencing replaceable draft runs/jobs/employees, so deleting those mutable records cannot erase calculations. Whole-organization deletion remains an **explicit privacy/retention operation** via the organization FK's cascade; routine payroll recalculation never purges history.

The DB trigger verifies tenant/legal employer, claimed job, run dates and previous hash/revision consistency. With the flag OFF the worker still completes its ordinary, now-atomic current-register calculation but does not touch the new history table. The history GET returns HTTP 503 without attempting SQL while the flag is OFF. It does not recalculate Philippine payroll formulas or cryptographically authenticate a writer with elevated DB permissions. Even hash-chained history requires database privilege isolation, backups, audit and independent reconciliation in production.

**Do not backfill** older histories from the current mutable register and falsely represent them as earlier calculation versions. Existing historic rows are unknown. If migration preflight finds an unexpected table, drift or conflicting 0137 migration, stop for DBA reconciliation.

## Authorized read

`GET /api/payroll-runs?runId=<id>&include=history` reuses the existing employee-sensitive payroll operator, assigned org-unit, tenant and legal-employer authorization gates. It returns newest first, at most 100 records, with keyset `beforeId` for older pages and `nextBeforeId` when more records exist. Unlike the payout/bank API, this is calculation evidence only. No unauthenticated or worker/ESS-wide history read is introduced.

## Deployment and rollback boundary — T3

The source branch/PR is **not a live migration**. The release-critical registry declares `PAYROLL_CALCULATION_HISTORY_ENABLED` **OFF** by default, preventing schema-less deployments from accidentally starting history writes. Apply 0137 only through the protected migration runner following a DBA-confirmed, exact-SHA schema receipt, isolated rehearsal and an approved production rollback/backup plan. Only **after** migration, role/isolation testing and an approved payroll cutover should an operator set the exact string `true` on the worker/API. Enabling the flag without the schema fails closed instead of silently skipping evidence. Activate with no in-flight recalculation to avoid a mixed historical record. After any committed history, never roll back by dropping, deleting or overwriting the ledger. A rollback should first suspend new payroll worker processing for reconciliation, then revert the activation flag or compatible application logic while retaining the 0137 table and evidence. Disabling evidence capture after activation must be explicitly recorded as a gap; it must not be used to disguise unrecorded payroll calculations.

Separate business approvals remain necessary for real payroll release, money movement, bank files and agency submissions. This PR does not certify wages, external statutory rules, tenant RLS, a live installation, or production use.

## Evidence and checks

- Unit/source tests: `tests/payroll-calculation-history.test.ts` cover hash invariance, privacy, tamper detection, safety guards and GET authorization boundaries.
- Golden worker path: `tests/payroll-e2e-fictional-postgres.test.ts` asserts 51 preserved employee versions through an identical draft recalculation and an actual source correction, cross-tenant scope and released-run immutability.
- SQL execution: `tests/payroll-calculation-history-postgres.test.ts` exercises exact 0137 SQL on **disposable localhost CI only**, including revision chain, tenant mismatch, replay rejection, disallowed UPDATE/DELETE/TRUNCATE, run deletion preservation and intentional whole-tenant erasure. Its explicit `PAYROLL_F04_ISOLATED_POSTGRES=disposable-ci-only` guard rejects Neon/remote/non-CI targets.
- `.github/workflows/payroll-calculation-history-f04.yml` runs this isolated forward-SQL check on PostgreSQL 16 and 18. It does **not** apply migration to any shared or production DB.

All evidence is candidate/source evidence until exact-head CI passes and owner/DBA accepts migration and employer-specific operational gates. Avoid recording fictional CI as real-employer payroll sign-off.
