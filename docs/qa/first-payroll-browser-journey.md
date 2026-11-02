# First payroll: browser-driven lifecycle

`scripts/qa/first-payroll-browser-journey.mjs` runs against the real local
production-mode Next application and disposable PostgreSQL 16. It does not mock
localhost responses or call payroll lifecycle endpoints from the test driver.

Fixture-only setup creates an employer, worker/pay profile, historical attendance,
a fictional CSV mapping, and distinct Payroll Officer, Checker and Owner sessions.
The sessions have fictional MFA timestamps. Password login, invitation delivery,
MFA enrollment and actual human independence are not exercised or certified.
No provider credentials are permitted, workers and payment providers are off,
and browser network requests outside the exact loopback app origin are blocked.

The browser then performs:

1. Payroll Officer opens Create payroll, selects the cutoff and clicks Create &
   process. A real server calculation produces the register. No release action is
   exposed to this role.
2. Payroll Officer clicks Submit to checker, selects the distinct Checker and
   confirms submission.
3. Checker opens Review payroll from the dashboard, reviews the authorized
   Approvals evidence, clicks Approve payroll and confirms. No release action is
   exposed to this role.
4. Owner opens payroll details and confirms release in the release dialog.
5. Owner expands the worker's register row and downloads the generated PDF.
   The file signature and exact net centavos are checked.
6. Owner opens exports, chooses the fictional CSV mapping and generates the bank
   file. The actual browser download must contain exact employee/account/net bytes.

Post-flow SQL reads independently require one Released run, reconcile the entries,
and verify gross 15000.00 and net 13271.30. Browser page exceptions fail the test.
Desktop and 390px Owner screenshots plus a sanitized, Git-revision-pinned receipt
are emitted under `outputs/`. The first-payroll CI workflow repeats both the
existing HTTP negative-boundary suite and this browser lifecycle on disposable
PG16; local success is not a claim of pending CI success.

## Defect found

The Checker's dashboard comparison/review buttons opened Payroll, whose register
read is unavailable to this role. They now open Approvals, where the existing
authorized Checker variance view and decision confirmation live. No API grants,
role permissions or approval guards were broadened.

This proves a local fictional browser lifecycle, not deployed real sign-in, real
employer reconciliation, email delivery, bank UAT, statutory certification or
settlement. Zero API coverage credits and no production changes are claimed.
