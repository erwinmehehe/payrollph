# PayrollPH — populated workforce and payroll-gate QA, 2026-10-16

**Scope:** isolated QA branch only, fictional worker data only, no live money movement, real filing, changes to the original/default Neon database or production deployment.

## Environment / evidence

- Neon project: `calm-wave-70219564`; isolated branch: `br-green-hat-b77qj8fs`; endpoint: `ep-old-paper-b7k36yuc`; database: `neondb`.
- Git branch: `qa/neon-repaired-preview-20261016`. This evidence is **not** for cherry-picking or merging into main unreviewed.
- Protected Vercel QA run (temporary one-time harness): `dpl_C3kAx2GL3DBEc1VeGDTHD4Ba9jL8`, commit `c3bafdec4f877fd112dc729dbaa206dc12f74a2a`. `GET /api/health` returned `200 {"ok":true}` verifying the exact SQL-session target from the app.
- The one-time test harness was removed after execution; its one-time database gate was consumed and dropped; no test user session remains.

## Fictional fixtures added (only organization ID 2)

- One shift, `09:00–17:00`, 60-minute break.
- One 7-day pattern (`QA-5X2-20261016`), five scheduled weekday segments, weekend rest.
- Two employee assignments (one each to QA-A and QA-B) effective October 1, anchored October 12, 2026 (Monday).
- October 15 punches: Employee A `09:02–17:00`; Employee B `10:15–17:00` (intentionally late). Both are fictional and marked as QA fixture data.
- One **fictional and explicitly unregistered** legal-employer context was added to organization 2; the **two newly created QA employees** were assigned to it. No bank/payout identifiers, statutory accounts or real customers were added.
- No original employer 1 worker/punch/pay-profile/run/entry was updated.

## 9/9 authenticated, in-process GET-handler checks passed

The temporary QA-only, single-use endpoint generated real application sessions for fictitious `qa-acceptance-` accounts, invoked the actual GET route handlers, and deleted every session afterward. It was not a browser login.

| Scenario | Status | Expected assertion |
|---|---:|---|
| Unit A HR: scheduled employee date 2026-10-15 | 200 | Resolved 09:00–17:00 pattern segment |
| Unit A HR: query Unit B employee schedule | 403 | Cross-unit resource denied |
| Unit A HR: attendance analysis | 200 | Exactly own worker; no late-arrival exception |
| Unit A HR: Live Floor | 200 | One worker, zero unresolved schedules, no leaked other-unit segment |
| Unit B HR: scheduled employee date 2026-10-15 | 200 | Resolved 09:00–17:00 pattern segment |
| Unit B HR: query Unit A employee schedule | 403 | Cross-unit resource denied |
| Unit B HR: attendance analysis | 200 | Exactly own worker; `late_arrival` detected |
| Unit B HR: Live Floor | 200 | One worker, zero unresolved schedules, no leaked other-unit segment |
| Employee B: `GET /api/self/workforce` | 200 | Linked employee identity and exactly one own historical completed punch |

**All nine handler assertions returned `pass:true`.** No raw employee data or credentials were returned by the harness.

## QA-only schema repair

The schema used by `GET /api/workforce/schedules` expected `workforce_schedule_guardrail_policies`, absent on **both** Neon branches. Added that exact Drizzle table contract to **QA only** with 10 columns, no policy rows; app uses its declared default advisory rules. Guarded reproduction: [QA-only SQL](./2026-10-16-schedule-guardrail-qa-only.sql). The original branch still lacks this table and **must not be changed without separate production approval**.

Earlier QA-only correction for `employee_worksite_assignments.decision`: [QA-only SQL](./2026-10-16-worksite-decision-qa-only.sql). This also still needs a formally reviewed production migration.

## Payroll/reconciliation NO-GO (actual observed blocker)

The verified protected QA endpoint `GET /api/first-payroll/preview?organizationId=2&periodStart=2026-10-01&periodEnd=2026-10-15&payDate=2026-10-16` returned **HTTP 404**: `{"error":"First-payroll preview is unavailable."}`.

Its release gate `firstPayrollInlineAvailable()` is default OFF and additionally checks `first_payroll_journey_progress`, absent on **both** branches. The `workforce_attendance_period_locks` and `workforce_attendance_lock_policies` tables are also missing on **both** branches. The experiment **did not** enable the release gate, bypass approvals, forge paid/payable entries, mark timesheets approved, or trigger the payroll worker. Complete payroll-calculation, reconciliation and filing acceptance are **not passed**.

The three existing fictitious original payroll runs also have mismatches, present before QA; see #1102:

| Original run | Header gross minus entry gross (PHP) | Header net minus entry net (PHP) |
|---|---:|---:|
| 1 | -5,000.00 | -1,755.00 |
| 2 | -1,550.00 | +1,168.00 |
| 3 | -900.00 | +1,724.00 |

The original payroll data was not corrected in this milestone.

## Real browser login remains untested

The browser connector available in this ChatGPT chat can **read existing tabs only** (no navigation, typing or login UI actions). All eight QA accounts have local-password sign-in disabled and had no reusable credentials provisioned. Therefore there is **no claim of real browser login/MFA/SSO acceptance**. Run a human-operated or Work-mode/authorized browser test against the protected QA preview with separately provisioned, nonproduction credentials; do not send passwords into chat or disable deployment protection.

## Safety and cleanup

- QA scheduling harness removed from QA Git source after the 9/9 pass; temporary test grant table dropped; **0** synthetic user sessions remain.
- Preserved original employer's 8 employees, 3 payroll headers, 18 payroll entries and 16 original punches. QA now has 2 employers, 10 fictional employees and 2 additional synthetic punches.
- Production original/default Neon branch `br-lucky-sound-b79i56jw` remained untouched. No bank transfer, real government filing, production migration, or real customer work.

## Release decision and follow-up

**GO (narrow scope):** isolated QA schedule/attendance read API and unit-scoped HR/employee self-service reads with populated fictional fixtures.

**NO-GO:** first-payroll preview, centavo reconciliation, actual browser sign-in, production schema and payment/filing release. Review the current migration graph and implement source-controlled, independently verified schema fixes (#1113). Resolve seeded payroll totals at fixture source (#1102) and only then rerun an isolated payroll calculation/approval/reconciliation journey. Prior authentication acceptance evidence: #1061.

