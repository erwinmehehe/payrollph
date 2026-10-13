# WFM #691 — development-first acceptance, no separate staging project

**Updated:** 2026-10-13. **Environment:** PayrollPH is currently under development; the owner reports no real employees or live payroll processing. **Decision:** Use the existing development application. A second Vercel staging project is **NOT** a prerequisite for WFM-12 or developer WFM-01..14 testing. This runbook complements [the canonical WFM-01..14 matrix](../wfm-pilot-acceptance-matrix.md), [the local UAT recorder](local-owner-wfm-journey-uat.md), and [issue #691](https://github.com/erwinmehehe/payrollph/issues/691).

## Distinguish development validation from later pilot sign-off

| Gate | What it means | Requires a separate staging deployment? |
| --- | --- | --- |
| **DEV-CHECK** | Run isolated automated regression tests and use the existing development UI with fictional workers. Record actual results and defects. This is enough to continue building and improving UX. | **No.** |
| **PILOT-ACCEPTANCE** | Before external employers or real employee data: complete the independently witnessed WFM-01..14 matrix, DPO/privacy and physical-device checks, secure data handling, authorized deployment configuration, and owner approval. The same dev application may be used only if its separation and reviewer access are demonstrably suitable. | Not inherently, but stronger isolation/release controls may be needed. |
| **PRODUCTION-GO** | Obtain DBA migration, incident recovery, payroll reconciliation and release/security approvals. | Separate from WFM development testing; **not authorized** by DEV-CHECK or code merge. |

**Avoid the false blocker:** absence of a custom Vercel staging project does **not** stop developer testing. A developer may run initial app scenarios without an independent reviewer; label those results `DEV-CHECK`, not `PILOT-PASS`.

## Verify the existing development application first

1. Record the exact Git SHA, app URL/localhost, PostgreSQL database identity (host, name and branch **without credentials**), test roles, feature flags, browser/device and Asia/Manila work dates. Keep these with test results so they are reproducible.
2. Confirm every employee, shift, punch, payroll record and provider in the dev database is synthetic. A prior **read-only** Neon inspection saw **8 employee rows and 3 payroll runs** on its default `main`; these could be fixtures, but the database must **not be assumed empty** or disposable. Do not delete/reset it or run `db:push` against the connected Neon database.
3. Use the current development UI for roster/shift/phone/approval exploration. Use **GitHub Actions disposable PostgreSQL** (or a fresh, explicitly disposable loopback `app_db`) for destructive 1,000-row seeding, migrations and timing/retry workload tests. Do not create another Vercel project.
4. Keep real payout providers, worker/push notification integrations and government submission endpoints disabled. All employee and employer actors are fictional. Testing offline photos should use fake test images, never an actual biometric capture absent the privacy review.
5. If a scenario requires a background scheduler, run the existing centrally leased worker only against the disposable test DB, and confirm no external notification/payout route is active. Developer testing may establish behavior, but later pilot acceptance still requires independently witnessed results.

## WFM-12 — execute now with existing automated and dev-UI tools

### Automated part: existing isolated GitHub CI

[PR #936](https://github.com/erwinmehehe/payrollph/pull/936) updates WFM-12's synthetic evidence mapping to include:
- `tests/wfm-roster-scale-postgres.test.ts`: insert 1,000 **fictional** schedule assignments; scan all six keyset pages (five full pages of 200 plus the empty terminal); resolve schedules in ten 100-worker batches; ensure a tenant-B record is excluded.
- `tests/wfm-clock-in-watch-paging.test.ts`: 1,000-row complete scan and fail-closed truncated/duplicate cursor handling.
- `tests/workforce-roster-scale-rules.test.ts`: a **13-hour shift followed by five hours of rest** creates exactly `MAX_DAILY_HOURS` and `MIN_REST_BETWEEN_SHIFTS` findings, both blocking. Validate overlaps, workweek and unapproved overtime.
- `tests/wfm-clock-in-watch.test.ts`: conservative, advisory attendance-watch signal suppression and no automatic payroll deduction.

Run [the WFM Synthetic Evidence workflow](../../.github/workflows/wfm-pilot-synthetic-evidence.yml) against **exact candidate SHA**. Retain its sanitized artifact. Until #936 passes its own checks and authorized merge review, do not claim the enhanced map is merged. The existing tests may still be run by normal isolated CI on `main`.

A direct local execution is optional, *only* if a fresh throwaway PostgreSQL 16/18 is available on loopback:

```bash
# DO NOT run db:push against an existing Neon/dev/shared database.
# First provision an empty throwaway localhost PostgreSQL app_db.
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/app_db'
export CI='true'
export GITHUB_ACTIONS='true'
export BANK_DATA_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export PII_ENCRYPTION_KEY="$(openssl rand -hex 32)"
npm ci
npm run db:push  # guarded by the repository: 127.0.0.1/app_db only
npx tsx --test --test-concurrency=1 tests/wfm-roster-scale-postgres.test.ts tests/workforce-roster-scale-rules.test.ts
```

### Actual development UI part

Use the **existing** dev app. With fake manager, employee, HR and checker accounts: inspect the weekly roster and pagination; set a 13-hour/5-hour pair; verify precisely two blocking findings and no automatic publish; create/decline a shift swap; verify that employee/tenant switching cannot leak data; review the correction/timecard-to-payroll **preview** without real money or employee inputs. On mobile, test a narrow viewport and unreliable connection. **No separate staging URL is needed.**

Record each result as `DEV-PASS`, `DEV-NEEDS-FIX` or `DEV-NOT-RUN` with SHA, browser, actual observed output and a fictional/opaque evidence reference. Automated source tests do not count as a performed UI check. For actual leased-scheduler paging/retry at 1,000 rows, use only the disposable DB and record real runtimes, not estimated p50/p95.

## WFM-01..14 and benchmark-driven development

Complete developer regression of the existing [matrix](../wfm-pilot-acceptance-matrix.md) in order: tenant data isolation and stale requests; seven-day roster and rule publishing; availability, leave and credentials; night/rest/holiday/OT behavior; offline punches/corrections/reviewer boundaries; approved timesheets; read-only payroll preview; swaps; mobile. Record missing behaviors as defects. The physical offline/device/photo scenarios remain **DEV-NOT-RUN** until executed on appropriate equipment and with privacy controls.

Use [the reviewed Rippling / Deputy / UKG audit](../wfm-rippling-deputy-ukg-gap-audit.md):
- **Rippling:** check a single authoritative employee/time-to-payroll data flow, never auto-approve unreviewed punches.
- **Deputy:** measure clicks/time to fix a coverage gap, navigate the weekly roster and swap without confusing panel switches, and assess 375px usability.
- **UKG:** evaluate issued-versus-actual aggregate forecast evidence and staffing preview; no automatic shift publishing or fabricated demand-accuracy claims.

Do not start a broad redesign until the current experience has recorded defects and measurable acceptance criteria. No need to pause all feature work while waiting for a new staging account.

## Later: external employer pilot and production are separate

An actual pilot still requires real reviewers to independently witness and sign the applicable #691 UAT cases, physical-device and privacy controls, plus one authorized **no-money** employer payroll reconciliation #579. Only a future production launch requires independently clearing DBA #910, Neon restore incident #899, security/secrets #112, and an exact release SHA. These later gates **do not block the fictional development tests above**.

**Immediate task:** execute WFM-12 synthetic CI and the actual development UI journey, record `DEV-` status and defects; fix defects in small reviewable PRs. Do **not** create or require a new staging environment.
