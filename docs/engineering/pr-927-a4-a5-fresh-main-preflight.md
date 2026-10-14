# #927 Fresh-Main A4/A5 Rehearsal Preflight (Development Only)

This document replaces the active diff of the historical A1–A6 integration PR with a narrow and safe source inventory. The original #927 code remains in Git history for investigation; it is NOT recopied over the current payroll engine, employer schema, financial settlement or privacy/retention controls. This PR is NOT the combined integration acceptance and must remain Draft until a fresh successor actually passes combined tests.

## Current owner PRs, read at runtime

- A4 / Spend reimbursements: [#896](https://github.com/erwinmehehe/payrollph/pull/896)
- A5 / Private 201-file vault: [#902](https://github.com/erwinmehehe/payrollph/pull/902)
- Canonical single-employer, A1/A2/A3/A6, Careers, Saved Reports and Offline Attendance are already present on main. Never duplicate their migrations or revert their more recent source.

At this design checkpoint (14 Oct 2026), the owner PRs had distinct source deltas with two overlapping paths:
- src/db/schema.ts — additive A4 employer expense policies/receipt evidence and A5 expiry notice schema. Resolve both against current main.
- src/lib/data-retention.ts — A4 receipt-intent sweeper and A5 private-vault-intent sweeper. Retain both, including flag-OFF behavior.

Both owner branches were behind a rapidly moving main. These are timestamped observations; the source inventory workflow reads live PR refs without executing their code and regenerates SHA-pinned JSON evidence for each run.

## What this PR actually tests

- Historical A1–A6 disposable-schema guard with eight fictional Git fixture scenarios.
- A4/A5 read-only Git inventory with five fictional Git fixture scenarios: fresh common base, stale owner ref, shared modified-path conflict, missing already-merged A2/A3 tables and invalid/unauthorized execution.
- Current main must contain canonical A2/A3 tables. Both owner source heads must include the pinned current-main ancestry. Shared paths must be separately resolved before combined source tests.
- The workflow exits BLOCKED rather than falsely green while owner branches lag main or overlap. It emits only commit SHAs, file paths, booleans and reason codes. No real employer information or document contents.

## Follow-on combined rehearsal — NOT RUN

A fresh successor branch must integrate only source-owned, reviewed A4/A5 changes against verified current main, explicitly reconcile schema, retention, and any additional overlap, then run disposable PG16/18 forward/rollback/idempotency, private-object/scan fail-closed tests, cross-employer HR maker/checker, payroll golden centavos, TS/lint/build, security/CodeQL and authenticated browser/mobile source tests. No production schema change, payouts, government filing, candidate deletion, private object writes or toggled feature flag is authorized by this inventory.

Owner development-stage scope: no current customers. Independent human review may be waived for source-only development under an explicit owner decision; that does not bypass repository rules, the HCM/WFM source freeze or future real-data/release gates.
