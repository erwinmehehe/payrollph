# #853 First employer journey — execution handoff (development, no money)

## Current verified engineering baseline

The existing source-connected workflow [Nine-Stage Connected Payroll Development Acceptance](https://github.com/erwinmehehe/payrollph/actions/runs/38519665067) passed on source commit `e0b4f83c44b1efe69dfbdd6f5d754441d463d02e` using disposable PostgreSQL, a virtual September 30, 2026 Manila date, authenticated fictional role sessions, the same worker/timecard/payroll register, and draft-only BIR/SSS/PhilHealth/Pag-IBIG worksheets. **This older success is not a pass for a newer commit.** A later change must have its own exact-SHA checks.

The **Hire** step in this synthetic workflow uses direct authorized employee creation, NOT candidate offer → approved Hire BP → worker. The separate five-worker WFM suite uses historical seeded punches and does NOT prove a real-time Web Bundy event created those historical punches. Do not conflate the suites.

## Executable development checks

- Validate workflow coverage: `node --test tests/first-employer-workflow-triggers.test.mjs`.
- Require exact-head passing **Nine-Stage Connected Payroll Development Acceptance (No Money)** after payroll, authorization, WFM, or first-payroll UI changes. It performs the same-worker connected nine-stage flow, approved Web Bundy punch, correction/stale timesheet, checker and owner separation, release of records only, and hashes draft worksheets. Trigger filters now include the inline first-payroll UI, employer settings, first-payroll APIs and approval APIs.
- Require exact-head passing **HRIS Integrated Journey Browser QA (Synthetic Only)** after first-payroll UI or API changes. It checks inline employer setup, fictional employee creation and pay profile, HR time-review handoff, read-only preview, a separately confirmed draft, role isolation, narrow viewport/desktop layout and resumable employer-scoped state.
- Require **WFM Five-Worker Development Acceptance (No Money)** for five fictional scheduling/attendance/pay-premium cases (overnight, OT, incomplete punch, rest day). Its historical rows are seeded; its no-release payroll preview is not the same-source nine-stage record-release test.
- Run the existing **Independent Journey #853 Receipt Integrity (Offline)** unit tests and prepare the private `NOT_RUN` template using `docs/qa/independent-journey-853.md`. This validates evidence *structure*, not real witnesses.

No source merge, CI PASS, simulated browser or prefilled evidence template is an independent operator result, production deployment permission or real-employer payroll certification.

## Human walk-through — two fictional employers, five fictional employees

**Prerequisites:** an approved protected development test app with an independently verified exact deployed SHA; isolated fictional employers Alpha and Beta; valid role-scoped test accounts for HR, manager, employee, Payroll Officer, Checker, Owner and independent QA witness; real desktop and phones; safe flags preventing payment, payout and agency submission. **Never `db:push` into or restore a shared Neon production/default branch.** Use disposable local PostgreSQL for destructive fixture setup, not a live customer's tenancy.

Run three separate exercises. Do not present their combined outcome as one source-connected lineage unless the exact same source event is demonstrated.

1. **Core nine-stage lineage (one worker):** HR creates an employee and completes worker-bound onboarding; an authorized planner publishes a work shift; employee clocks IN and OUT using authenticated Web Bundy in the exact test cutoff; authorized manager reviews corrections and approves the updated timesheet; Payroll Officer calculates that exact cutoff; separate Checker approves; Owner releases payroll **records only**; payroll/HR reviewer downloads four draft worksheets and verifies their bytes against recorded SHA-256. Confirm no funds or provider submissions and that after-cutoff edits are refused.
2. **Five-worker WFM scenarios (separate rehearsal):** regular day; cross-midnight night differential; one hour of separately approved overtime; missing-out punch with separately approved correction; rest-day premium. Check expected worked minutes, timecard approval, payroll calculation trace and statutory treatment for each employee. The existing WFM synthetic suite does not certify independently witnessed device data.
3. **Two-employer, role and mobile navigation:** Owner and Payroll Officer switch Alpha → Beta → Alpha, with no stale worker, pay or reviewer state. Attempt foreign employee, time and payroll IDs as nonmembers; verify deny responses and no state mutations. On actual phones test keyboard, 375px layout, resume after reload, back navigation, interrupted request/retry and understandable errors. Have novice HR users find employee, onboard, request leave and complete assigned approvals.

For each human check, record *privately*: source SHA, environment/build, legal test scope, role, device/OS/browser, expected action, observed result, timings, errors, retry/help required, sanitized evidence ID, reviewer identity and dated PASS/NEEDS_FIX/NOT_RUN. Never upload names, wages, IDs, bank accounts, screenshots with PII or full evidence to public GitHub. Do not invent timing or human signatures.

## Acceptance and blockers

- All nine source-linked journey stages independently observed, plus the ten cross-cutting checks in `scripts/qa/independent-journey-853.mjs`; preserve `NOT_RUN` until tested by actual operators.
- Same employee ID, pay cutoff and attendance/approved source trace; no unexplained wage/deduction differences, stale approvals, unauthorized read/write or money movement.
- Two untrained HR users complete #852's five everyday tasks, including tenant switches, without developer assistance. If they cannot, log a specific UX defect and fix/retest it.
- Keep real physical biometric/offline WFM-14 **NOT_RUN_EXTERNAL** until a supported device is actually tested. Do not infer hardware certification from a mobile browser.
- Before an actual employer shadow period (#579), satisfy applicable production isolation, security/privacy/encryption/DBA gates and obtain consent plus independent payroll reviewer. Compare every worker/component with zero unexplained > PHP 0.01 variance; **no transfer of funds**. Bank portal/agency import acceptance is later and separate.

**Decision:** Development evidence can advance after exact-head green checks. External pilot remains **NO-GO** until true witness records, real employer parallel payroll and all applicable release gates are independently accepted.
