# Compensation Management — Phase 1 implementation contract

Status: design/acceptance contract only; NOT a shipped feature.
Date: 2026-10-09
Owner: HCM
Baseline: existing job architecture, approved positions, published workforce plans, pay profiles and shared approvals.

## Goal
Enable People and Finance users to define salary ranges and prepare a compensation review *without* changing payroll or employee salary until an explicit, separately authorized effective-dated pay action is approved.

## Scope for first implementation PRs
1. **Compensation band policy** — organization-scoped, versioned, effective-dated ranges keyed by job profile + level + work location; currency PHP, pay basis, lower/mid/upper amount, status draft/active/retired. Enforce lower <= mid <= upper, no overlapping active effective windows for the same key, immutable historical versions, no hard-coded default bands.
2. **Range visibility** — HR/Finance can view the authorized bands; managers see only permitted org-unit employee summaries; employees never receive confidential comparative pay data. Respect current authorization and payroll-cost permissions.
3. **Read-only position/employee comparisons** — compute compa-ratio (current authorized base pay / active band midpoint) and range penetration ((base - min)/(max - min)); return not-applicable when missing, zero-width or incompatible pay basis; flag out-of-range without auto-correcting pay. Resolve band and pay as-of a specified date.
4. **Review-cycle drafts** — record proposed individual adjustment and reason, funding pool, budget and manager attribution. A submitted proposal is NOT payroll authorization. Use decimal-safe PHP math with specified rounding; preserve current and proposed annualized bases.
5. **Governed approval** — integrate with existing shared approval engine, maker-checker and delegation rules. Freeze band/policy/position/pay snapshots at submission; prevent self-approval, cross-tenant access, stale pay-base application and double-application. Explicit People/Finance approval and MFA prior to salary mutation.
6. **Separate pay-change action (later phase)** — only a final approved compensation decision may create an effective-dated salary revision via existing payroll pay-profile mechanism. Idempotent transaction with audit evidence and period-boundary protections. Keep this step OFF until independently reviewed.

## Suggested delivery slices
- PR A: migration + typed service for versioned salary bands, authorization checks, collision constraints and tenant tests.
- PR B: read-only salary band comparison API and People/Finance UI with privacy/cost-redaction tests.
- PR C: review-cycle/proposal/approval state machine and budget accounting, immutable submission snapshots.
- PR D: opt-in approved salary revision adapter, payroll regression suite and E2E.
- PR E: privacy-safe pay equity and compensation budget reporting after verified source data.

## Acceptance gates
- Every table/query is tenant-scoped; deny unknown org/department scope on server.
- Permission-denied and cross-tenant mutations have automated tests; no sensitive salary leak through totals, exports, audit detail, or log messages.
- Effective-date queries are deterministic and historical reads never reinterpret a past cycle using a revised band.
- Mixed cadence (monthly vs semi-monthly) and salary basis conversions must be explicitly defined; never treat take-home/net pay as base salary.
- No open or submitted review may rewrite an approved payroll run.
- Managers cannot set their own pay; salary effective dates and approvals produce immutable evidence.
- Employer contributions and projected loaded labor cost remain clearly labeled estimates based on versioned payroll rules, not guarantees.
- Double submission and retry paths are idempotent.
- Typecheck, migration integrity, unit/integration tests, RBAC sandbox, CodeQL/security and pilot payroll checks pass on the exact review head before merge.

## Out of scope
- Automatic merit recommendations from performance ratings
- Compensation benchmarking based on unverified third-party datasets
- Equity/stock administration and payroll auto-disbursement
- New independent approval/employee/user data model
- Payroll-engine refactors unrelated to compensation

## Integration decisions
Use the existing governed job-profile/level/position and pay-profile models, shared approval/delegation engine, audit and MFA controls. If their current schema does not support a requirement, introduce a reviewed additive migration instead of overwriting history. Performance scores may be referenced only with proper permission and never trigger pay changes by themselves.

## Completion definition
Phase 1 is NOT done when the policy document merges. It is done when salary bands can be created and versioned, authorized users can view accurate scoped range positioning, regression/security tests pass and the feature is deployed with its rollout gate explicitly controlled. Separate compensation approval-to-payroll activation is a later release.
