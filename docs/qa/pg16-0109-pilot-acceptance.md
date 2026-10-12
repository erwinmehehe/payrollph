# PG16 + audit migration 0109: pilot engineering acceptance

**Scope: synthetic engineering only.** This is a repeatable, isolated test and a product-owner review checklist, not an employer payroll, device, bank, agency or independent human certification.

## Why this exists

The Windows local baseline from 2026-10-12 was reported at source SHA `a8f512fc78b7a8139bce0479d20722ca09a431bd`: **3,633 PASS, 5 FAIL, 4 SKIPPED, 0 CANCELLED** across 3,642 TAP tests on real PostgreSQL 16.14 with UTF-8. The five remaining failures were attributed by the local operator to four unsupported Windows symlink operations and one absent `jq` binary; these were not re-run by this document. Initial Windows-1252 and CRLF issues were environment-specific. Do not turn reported local outcomes into a new CI PASS without links to exact job evidence.

Local QA identified that `tests/workforce-issued-demand-db.test.ts` attempted direct `audit_events` deletion. Migration `0109` correctly rejects direct mutation. The test now lets an **isolated fictional organization** be deleted normally, cascading its own synthetic audit rows under the existing FK and 0109's designed nested-trigger handling. An audit regression independently confirms direct mutation is rejected and the owner-cascade cleanup is permitted **with maintenance bypass disabled**. Neither application audit retention policies nor production ownership rules are changed.

The separate CI workflow `audit-0109-pg16-acceptance.yml`:

1. Boots a disposable `postgres:16` service with UTF-8 on localhost.
2. Verifies the exact local CI database URL, zero employer/audit records, engine version and UTF-8. Rejects other environments.
3. Runs schema push and applies the exact source `drizzle/0109_tamper_evident_audit_chain.sql`.
4. Verifies the append-only audit trigger is enabled.
5. Runs affected audit and WFM tests, **all** `npm test` suites, WFM-01..13 mapped synthetic groups, and all four golden payroll suites on that audit-enabled database.
6. Publishes SHA-bound **aggregate counts only** and generated synthetic matrices, not raw payroll records or private credentials.

The existing WFM, HRIS/two-role mobile browser and connected nine-stage payroll QA workflows also enable 0109 in their **own isolated disposable** PostgreSQL services before testing. These remain independent synthetic CI evidence gates.

## Local repeatable review

Work only with a verified disposable PostgreSQL 16 UTF-8 `app_db`. The CI-only migration application script explicitly refuses to run outside GitHub Actions. For local testing, use the project's existing reviewed local schema/migration commands **only after verifying** the connection is on 127.0.0.1, contains no real employer data and has a rollback plan. Never point `drizzle-kit push` or a manual SQL command at production.

On the tested checkout:

- Run the normal `npm test` suite and four `payroll:golden*` scripts; preserve all TAP summary counts and the exact `git rev-parse HEAD`.
- Run `node scripts/wfm-pilot-synthetic-evidence.mjs`; validate each group's nonzero non-skipped counts and explicit `independentUat: NOT_RUN`.
- Use `scripts/pilot-payroll-qa.ts` through the existing isolated `Production Pilot Payroll QA` setup (localhost + disposable DB). Confirm nine `passed-synthetic-only` steps and `governmentPortalAcceptance: NOT_RUN`.
- Use the existing HRIS browser QA fixture for local Owner/Payroll Officer mobile checks. Test on a physical phone **as a separate manual UAT event**, never as a synthetic receipt.
- Execute the existing private parallel-payroll `--pilot` verifier only with **authorized** actual employer inputs in a secure external evidence vault. Synthetic arithmetic tests in CI do not close #579.

## Owner manual walkthrough (no production data)

Use isolated fictional accounts for separate HR, WFM manager, employee, Payroll Officer, Checker and Owner roles.

1. HR: create a fictional eligible worker, review effective employment state and onboarding tasks; verify unauthorized role denial.
2. WFM manager: publish a seven-day roster with overnight/rest days and approved leave; stage/reject/approve changes with a separate role.
3. Employee: on a 375 px mobile browser, view only assigned approved shifts and clock in/out; try duplicate clock-in and failed network recovery.
4. Manager and Payroll Officer: review attendance corrections, stale approval, cutoff locks and Philippine pay premium trace.
5. Payroll Officer → independent-role test Checker → Owner: calculate, review and release *payroll records only*; assert no provider submission.
6. Employee: view authorized released payslip; verify another employee cannot read it.
7. Owner: generate BIR, SSS, PhilHealth and Pag-IBIG **draft worksheet** evidence; verify hashes and clear `DRAFT ONLY` markers.
8. Switch employer A ↔ B rapidly, including an in-flight request; check that tenant A workers, exports and approval records never appear under tenant B.
9. Record expected/actual per item, screenshots in private QA storage, exact app/build SHA, browser/device, tester, date and defects. The Owner can sign a *self-executed usability review* but cannot claim a second independent human reviewer.

## Explicit limitations and security follow-up

- WFM-14 real biometric/offline hardware: `NOT_RUN_EXTERNAL` until an actual approved device and real tester participate.
- #691 and #853 human-operated UAT: not certified by code, bots, synthetic logins or this workflow.
- #579 real employer: zero unexplained employee/component/GL differences greater than PHP 0.01 require genuine incumbent records, independent normalization/checker and Owner signoff. No money movement.
- Agency file acceptance needs genuine agency portal receipts, separate from draft worksheet hashes.
- Production rollout still depends on #112 and #744.
- **Security design review required:** the audit migration presently permits maintenance by a configurable session flag. Review database-role separation and privilege enforcement for actual production app credentials; a session flag by itself is not a substitute for authorization. Do not alter production database permissions through this QA change.

**Merge gate:** exact proposed SHA CI, migration-on full suite, WFM and payroll golden checks, HRIS mobile browser and nine-stage synthetic QA must pass; security reviewer must approve the audit-cleanup change. Keep these separate from independent human, employer, bank and agency gates.
