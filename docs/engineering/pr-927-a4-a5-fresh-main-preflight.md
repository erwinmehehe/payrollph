# PR #927 — A4 merged, A5 candidate integration source evidence

**Development-only. Historical A1–A6 integration source is retired.** The previous 77-file source snapshot stays in Git history and is not part of the current PR diff or test execution.

## Confirmed mainline change

Spend/expense reimbursements **PR #896 was squash-merged** as 361bd6b5d9a9706a2930b0c48a8e0e431fd10bfe, not integrated by replaying the former feature branch. Its category policies, expense claims, receipt evidence, settlement code, and receipt-object orphan recovery now belong to main.

The private employee 201-file vault remains in **draft PR #902** and its merged-source candidate includes the above mainline commit. The two originally conflicting files were reconciled specifically:
- src/db/schema.ts: preserve all canonical A4 tables/indices and other main fields, with **only** the additive hcm_document_expiry_notices table for A5.
- src/lib/data-retention.ts: preserve the existing COE and A4 Spend pending-object sweepers while adding A5 private-vault pending-object recovery even when the vault flag is OFF.

## What the read-only gate verifies

scripts/qa/a4-a5-source-inventory.mjs reads pinned Git commit trees only. It verifies that the merged #896 SHA is an ancestor of main; the current main SHA is an ancestor of #902; A2/A3 predecessor schema still exists; the entire A4 main schema is **byte-identical** to #902's version after removing the sole A5 expiry-ledger addition; and the entire A4 retention scheduler is byte-identical after removing exactly the three small A5 import/tick/result additions; and both `src/lib/critical-release-flags.ts` and `src/proxy.ts` are byte-identical to current main. Flag/proxy parity is emitted as `null` (not inspected) if ancestry validation fails, never incorrectly as `false` (unchanged).

The workflow runs eight historical baseline guards plus eleven A4-merged/A5-candidate source-fixture tests (**19 tests total**), including a regression that checks the PR event's immutable base-SHA pin. Evidence is emitted as a bounded JSON report of SHAs, booleans, and blocker reasons, with **no real employee, policy, or private file content**.

A green inventory means **only** that the reviewed two-file source reconciliation matches the pinned main. It does not exercise the A5 application code, schema migration, object store, scanner, PostgreSQL concurrency, maker/checker or payroll arithmetic. PR #902's **exact-head** CI, including these suites, is the separate executable acceptance evidence.

## What remains

Before shipping or merging A5 under repository policy, resolve any exact-head #902 CI failures; check whether P0-3 source-freeze and independent approval rules require an explicit source exception or owner-reviewed policy decision. Real provider and production approvals have been deferred for this no-customer development phase and must **not** be represented as passed.

### 14 October 2026 — main advanced after original green check

On reconciliation of this QA branch to `main@bef23ef79b3574664868280cd8c7fd6115cdc9b5` (which includes #963), the A5 owner branch #902 still pointed to `94435b43f98de209065a373d4959af3db8e14b69` and was **two commits behind** main. Those latest mainline files are disjoint from the A5 owner diff, but that is **not** evidence of a successful source merge. The strict ancestry check must report `BLOCKED` until the **#902 owner** reconciles its actual head to current main and reruns exact-head development CI. Do not edit #902 source, claim an inventory success from an older main SHA, or weaken the ancestor precondition to force a green check.

This #927 diff remains QA-only and cannot certify combined A4/A5 execution. Its new source-only checks also reject unexpected A5 changes to release flags and the HCM HTTP proxy guard.

No numbered production migrations, Neon writes, real employee files, live S3/R2/scanner credentials, payouts, filings, source-policy bypass, or production flags were changed by this rehearsal.

### Repeatable CI checkpoint after fast-moving main updates

The read-only GitHub Actions workflow now **pins `A4_A5_BASE_SHA` to the exact `github.event.pull_request.base.sha` on pull-request events**. This is the same target-base commit GitHub assigned to that run, instead of looking up a moving `origin/main` ref minutes later. `workflow_dispatch` resolves main once at launch. The #902 owner ref is fetched once and read only by immutable SHA. A5 still must contain the pinned event-base commit, and all four source-invariant files must match; a stale candidate **fails closed**.

A green run proves only the explicitly recorded SHA pair, not future main commits. If main advances again after the event, the owner #902 and #927 must still reconcile with it, retest exact heads, and separately pass the protected repository's merge rules. Pinned source evidence never substitutes for live cross-service/database payroll testing.

For the 14 October development checkpoint, A5 #902 was synchronized again to `main@9c0f68e7a03fcc67e544546dd79107c1715075b5` as `9f65c0eaf1b07d4369f1f13436f22e56a1a8d826`, preserving all 34 owned A5 files with no overlap. #927 was also reconciled to the same main. Later source/CI status should always be read from the exact run, not inferred from this historical note.
