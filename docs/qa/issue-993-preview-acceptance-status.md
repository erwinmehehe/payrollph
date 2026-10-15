# Issue #993 — engineering acceptance status and independent handoff

**Updated:** 2026-10-15. **Decision:** Source implemented; automated verification in progress; independent human and real-employer acceptance **NOT_RUN**. Production use **NO-GO**.

## Verifiable evidence and scope

- Source: [PR #1072](https://github.com/erwinmehehe/payrollph/pull/1072), merged at `cf3e77297d4ee16f6757a415fb99d4168ab312b3`. Canonical read-only input assembly, strict selected legal-employer/worker/cutoff scope, per-worker fail-closed blockers, same authoritative pay calculator, timesheet hash refresh in one read-only repeatable-read transaction.
- Completed prior PR checks: [#1072](https://github.com/erwinmehehe/payrollph/pull/1072/checks) 36/36 green on its reviewed head. The HRIS PostgreSQL 16 fictional suite includes **five employees compared to a separately calculated no-release payroll run**, an unrelated second employer with overlapping employee number, approved punches/leave/OT/holiday/loan/allowance, centavo comparisons for gross/net/statutory deductions, snapshot-staleness detection, and no preview persistence.
- New engineering work: [`issue-993-pg18-preview-parity.yml`](../../.github/workflows/issue-993-pg18-preview-parity.yml) runs the same five-worker suite against an independently verified **empty disposable PostgreSQL 18** backend, with guarded first schema creation and no production/Neon target. **Do not mark PG18 PASS until this workflow finishes successfully at the exact candidate SHA**.
- Synthetic mobile/API extension: [`first-payroll-zero-tenant-browser.mjs`](../../scripts/first-payroll-zero-tenant-browser.mjs) exercises signed-in foreign-employer 403 and same-employer HR-role 403 on the actual *preview* GET endpoint, verifies response contains no money rows, and requires `private, no-store`. Existing browser fixtures cover 375px/390px geometry, inline recovery and fictional employer switch. Automated Chromium is **not** a physical-device or human observation.

## Required human and production evidence — NOT_RUN / BLOCKED

| Gate | Evidence required | Current disposition |
| --- | --- | --- |
| #852 novice HR | Two distinct untrained HR operators; five tasks each, desktop + physical phone, A/B tenant switches, private timing and failure observations | NOT_RUN |
| #853 first employer journey | Independently witnessed 27 actual cases, employer A & B nine-stage journeys, distinct maker/checker, observed phone interruption/retry and source SHA/fixture/signatures | NOT_RUN |
| #691 WFM-01..14 | Cross-role observed shift-to-pay, real phone and external-device WFM-14 where supported | NOT_RUN / NOT_RUN_EXTERNAL |
| #579 real employer | Consent/DPA/private vault, entire completed pay period compared component-by-component to incumbent with zero unexplained variances greater than PHP 0.01, separate Philippine payroll checker, **no money movement** | NOT_RUN |
| Live DB/recovery | Authorized DBA evidence for production migration ledger/target identity, restore test, exact reviewed schema, security and deployment approvals | BLOCKED |

Do not promote source-merged or fictional synthetic PASS to real operator, production schema, historical filing, bank-portal or payout certification. No real salaries, bank data, identifiers, device logs or private proof links in GitHub. Human reviewers should use the existing [#853 acceptance pack](issue-853-acceptance-pack.md), [#579 private reconciliation handoff](579-private-no-money-reconciliation-handoff.md), and [#691 witness handoff](wfm-691-independent-witness-handoff.md), recording their own factual outcomes against a **verified running application SHA**, not merely the Git branch.

**Next gates:** run exact-head PG18 and authenticated browser CI, resolve new defects if any, then hand the existing witness packets to actual authorized independent reviewers. Until evidence exists, keep feature/payout/filing releases disabled and #993 OPEN.
