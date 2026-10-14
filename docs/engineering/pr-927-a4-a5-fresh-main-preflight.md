# PR #927 — A4 merged, A5 candidate integration source evidence

**Development-only. Historical A1–A6 integration source is retired.** The previous 77-file source snapshot stays in Git history and is not part of the current PR diff or test execution.

## Confirmed mainline change

Spend/expense reimbursements **PR #896 was squash-merged** as 361bd6b5d9a9706a2930b0c48a8e0e431fd10bfe, not integrated by replaying the former feature branch. Its category policies, expense claims, receipt evidence, settlement code, and receipt-object orphan recovery now belong to main.

The private employee 201-file vault remains in **draft PR #902** and its merged-source candidate includes the above mainline commit. The two originally conflicting files were reconciled specifically:
- src/db/schema.ts: preserve all canonical A4 tables/indices and other main fields, with **only** the additive hcm_document_expiry_notices table for A5.
- src/lib/data-retention.ts: preserve the existing COE and A4 Spend pending-object sweepers while adding A5 private-vault pending-object recovery even when the vault flag is OFF.

## What the read-only gate verifies

scripts/qa/a4-a5-source-inventory.mjs reads pinned Git commit trees only. It verifies that the merged #896 SHA is an ancestor of main; the current main SHA is an ancestor of #902; A2/A3 predecessor schema still exists; the entire A4 main schema is **byte-identical** to #902's version after removing the sole A5 expiry-ledger addition; and the entire A4 retention scheduler is byte-identical after removing exactly the three small A5 import/tick/result additions.

The workflow runs eight existing historical guard fixtures plus seven new synthetic A4-merged/A5-candidate source-fixture tests. Evidence is emitted as a bounded JSON report of SHAs, booleans, and blocker reasons, with **no real employee, policy, or private file content**.

A green inventory means **only** that the reviewed two-file source reconciliation matches the pinned main. It does not exercise the A5 application code, schema migration, object store, scanner, PostgreSQL concurrency, maker/checker or payroll arithmetic. PR #902's **exact-head** CI, including these suites, is the separate executable acceptance evidence.

## What remains

Before shipping or merging A5 under repository policy, resolve any exact-head #902 CI failures; check whether P0-3 source-freeze and independent approval rules require an explicit source exception or owner-reviewed policy decision. Real provider and production approvals have been deferred for this no-customer development phase and must **not** be represented as passed.

No numbered production migrations, Neon writes, real employee files, live S3/R2/scanner credentials, payouts, filings, source-policy bypass, or production flags were changed by this rehearsal.
