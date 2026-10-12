# Inline First Payroll: PR #868 implementation and release acceptance

Status: **DRAFT — do not merge or activate.** Original `main` fetched at `4d81636122c55ac5e512b2f4c393101f00e55d83` (2026-10-12); re-fetch before merging because `main` is often rewritten.

## Source of truth and flag

- `src/lib/first-payroll-journey.ts` remains the single canonical seven-step order and state mapping: **company → people → time → reviewers → payroll → approval → exports**.
- New, server-evaluated, default-off release flag: `FIRST_PAYROLL_INLINE_UI_ENABLED`; only **exact** `true` enables. For initial release the inline UI is limited to paid self-service company-wide owner/admin/bookkeeper/HR/payroll/checker accounts, never demo, manager/employee, or legacy pilot tenants.
- The old `FirstPayrollReadinessCard` is unchanged for the flag OFF, demo, scoped roles or existing tenants. The separate `saas-onboarding-quickstart.tsx`, `setup-wizard.tsx` and `hris-onboarding-checklist.tsx` are **not yet consolidated** across all product entrypoints; duplicate entrypoints remain a follow-up and cannot be declared complete.
- Existing `src/lib/payroll-engine.ts` arithmetic is **unchanged**; its synchronous `calculateEmployeePay` function is only exported for use on a read-only SELECT path.

## Screen-by-screen inventory

| Screen | Flag-ON permitted viewer | Initial / empty | Loading | Error | Core action |
| --- | --- | --- | --- | --- | --- |
| First Payroll seven-step dashboard | Company-wide self-service owner/admin/bookkeeper/HR/payroll/checker | Seven drawers, per-step owner; zero-data blockers | Team handoffs loading | Progress GET error with retry | Open any drawer; authorized owner/HR sends to assigned role, no permission grant |
| Company inline | Authorized viewers; writes restricted by existing organization/settings API | Current employer and pay schedule | Existing settings states | Existing server validation/MFA | Edit profile and refresh underlying readiness |
| People inline | Existing People permissions; editor only authorized roles | No employees, add modal, import form, incomplete payout | Existing People fetch/import | Existing validation or request failure | Create employee, import via governed endpoint, edit payout |
| Time inline | Existing workforce/HR permissions only | No punches or timesheet evidence | Timesheet/attendance locks loading | Network/authorization/error notices | Actual time review, corrective actions and cutoff lock; never a fake approval |
| Reviewers inline | Tenant-wide authorized team administrators | No maker/checker | Team/invitations load | Existing authorization/MFA errors | Invite/assign distinct payroll officer and checker |
| Payroll preview | Company-wide enabled viewers with payroll/HR/checker role | No worker or invalid date with explicit blockers | Button indicates computing | API error with retry; null monetary values for unsupported advanced inputs | Read-only per-employee gross, SSS, PhilHealth, Pag-IBIG, WHT, net; separate, explicitly confirmed draft button only for authorized payroll maker |
| Approval inline | Payroll/checker roles only | No pending runs | Existing approvals states | Existing server errors | Independent maker-checker; unchanged release rules |
| Exports inline | Authorized payroll records viewers | No released runs, unavailable filings | Existing filing/exports states | Existing export errors | Existing governed post-release files; downloading is NOT agency acceptance |

The ten listed browser widths/screenshots are in the new synthetic Chromium runner; the workload is 2 roles × 5 viewports × 2 flag states = 20 images. Tables scroll inside a container; the test requires no **page-level** horizontal overflow at 320, 375, 390, 430 or 1440px. Frontend controls remain 44px minimum where inherited styles apply, but touch target/accessibility checks have **not yet been witnessed**.

## Read-only preview boundary and limitations

`POST /api/first-payroll/preview` is behind the flag and same-origin/session/member/role checks; it is never invoked by payroll draft creation or the background payroll queue. Service uses `db.select`, existing `statutoryRuleVersionsForDate`, existing `nationalHolidayCalendarForDate` and the unchanged pure `calculateEmployeePay` calculator. It reads the **primary active legal entity only**: supporting additional legal employers is deliberately deferred to the separately reviewed multi-entity PR.

The initial preview is certified only for a narrow simple monthly-salary cohort with no attendance/policy/benefit/loan adjustment rows. It **blocks pricing** for daily/hourly workers, existing punches, leave, retrospective pay revisions, overtime, active loans, benefits, premium policies and other complex records. It also requires a real payroll rest-day setting and worker TIN/payout destination. Rows not safe to price have `null` monetary columns; a blank is not a zero. Because historical prior-cutoff true-up is not reassembled, month-final cases are **not production approved** even when earlier runs exist. This is an *estimate* and not a certification of complete money inputs. Do not use it to issue payment.

`POST /api/first-payroll/progress` is separate: it writes only an idempotent team-handoff operational case and audit record when an authorized member requests “Send to role”. Cross-user progress reads are supported through the existing tenant case table; actual step completion is **derived** from the authoritative underlying company, employee, payroll and approval records. The payroll **draft** button uses the existing real `/api/payroll-runs` POST with `processNow:false`, requires checkbox acknowledgment, and can never be conflated with zero-write preview.

## Executable test coverage added

- `tests/first-payroll-inline-preview-behavior.test.ts` executes default-OFF flag behavior, seven-step role ownership and allowed UI scope, real/date validation, **existing calculator parity** for gross and statutory deductions, and a two-tenant PostgreSQL fixture. The no-write test repeats the preview and checks payroll runs, entries, payslips, approval tasks, payout batches, filing validations, and audit events **before/after**. It rejects cross-tenant worker names/identifiers.
- `scripts/first-payroll-inline-synthetic-browser.mjs`: actual authenticated Chromium, synthetic only, five widths × owner/payroll × before/after. Tests the seven drawer headers, preview API/UI, authorization, missing payout blocker and overall page overflow. It saves screenshot PNGs plus receipts in `qa-artifacts`.
- `.github/workflows/first-payroll-inline-browser-qa.yml`: isolated Postgres16 fixture, existing local data seeding, app flag-OFF localhost port 3000 and flag-ON port 3001, pinned Chromium, uploads screenshots and evidence receipts as short-retention artifacts.
- Existing `tests/first-payroll-journey.test.ts` and the golden payroll suites remain **unchanged**.

## Gating acceptance — NOT yet evidenced

The following MUST run on the exact final PR head SHA and be recorded before merge:

```sh
npm run typecheck
npm run lint
npm run payroll:golden
npm run payroll:golden:phase2a
npm run payroll:golden:phase2b
npm run payroll:golden:pay-rules
TZ=Asia/Manila npm test
```

Also required: the new before/after browser QA workflow must complete without error, with **real** screenshot artifacts for every new screen and viewport. Perform a separate human walkthrough on a physical phone with owner, HR, payroll and checker, plus a **second-user resume** and offline/error state. Confirm cross-tenant and role authorization via full HTTP requests, not merely a SQL fixture, and review employee schedule/loan/statutory correctness with a payroll specialist. Reconcile actual first-cutoff payroll employee-by-employee to ±₱0.01 without transferring money. Government filing import/acceptance remains separately unverified.

**Current result:** tests and browser workflow are committed, but GitHub Actions have been queued/cancelled during branch changes. No completed TypeScript/lint/goldens/entire suite/Playwright screenshots were observed here; do NOT claim release-ready. No production flag activation, migration or money movement took place.

## What is NOT done

- Full production-input assembler reused by both preview and the chunked payroll engine. The current preview fails closed for complex earnings/attendance and therefore cannot claim every employee preview is priced.
- A server-persisted per-step “acknowledged time complete” state independent of the real timesheet/cutoff approvals (intentionally no checkbox shortcut).
- Unified first-payroll step presentation across the separate SaaS quickstart, initial install wizard, HRIS onboarding checklist and other routes.
- Real browser screenshots/phone UAT, full test outcomes, real employer payroll reconciliation and statutory agency acceptance.
- No new tenant/module opt-in database schema; server flag is rollout-wide but is visible only to gated self-service company-wide roles.

## Activation after independent signoff

Keep unset normally. On a synthetic isolated staging employer only after green CI, set:

```env
FIRST_PAYROLL_INLINE_UI_ENABLED=true
```

Do **not** enable production until independent engineering, payroll, security and UX acceptance. Roll back the interface by setting flag OFF; preserve recorded operational handoffs, case audits and actual payroll drafts. Never delete payroll or approval history as a rollback.
