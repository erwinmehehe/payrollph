# Inline first payroll

Apply `drizzle/0115_inline_first_payroll_journey.sql` to the target database,
then set `INLINE_FIRST_PAYROLL_ENABLED=true` on the server and restart/redeploy.
Missing or any other flag value leaves the existing workspace experience intact.
CI uses disposable PostgreSQL with `db:push`; production must apply the migration.

The journey's seven step definitions, default responsible roles and descriptions
are in `src/lib/first-payroll-journey.ts`. The existing five workspace readiness
checks remain evidence predicates; employee provisioning and initial owner-account
creation remain separate workflows. Quickstart labels now use the same inventory.

Inline account controls let each member enroll MFA without leaving the journey;
sensitive actions retain their production MFA requirement.

Company setup records employer details and a canonical semi-monthly cutoff/pay date.
People, attendance, payroll, approval and exports embed the existing workflow controls.
Adding employees and drafting payroll open dialogs in the current workspace. Invitation
acceptance must still be performed by the invited person. Existing paid-access, MFA,
custom role gates, governed hire, maker-checker and release controls still apply.

Progress is keyed by employer and step. A handoff records the responsible role and
actor, preserving existing schedule data. A different company-wide member resumes
steps assigned to their role. “Send to role” is an internal assignment; it does not
send email or Slack messages. No checklist completion flag authorizes attendance,
payment, filing or approval. Time review is derived from an actual authorized cutoff lock.

Preview is computed on demand from current employer data and is never cached as
completion evidence. It uses the existing production loader and calculator, inside a
PostgreSQL REPEATABLE READ, READ ONLY transaction. It skips schema repair, account
sealing, queue jobs, audit writes, payroll runs, payroll entries and payslips. Preview
authentication validates the same session policies without updating last-seen or
revoking sessions; invalid or over-limit sessions fail closed. Preview does not
replace the real run's attendance, timesheet, approval, assurance or release checks.

Validation:
- `node --import tsx --test tests/inline-first-payroll*.test.ts` executes the existing
  calculator through a database double that rejects and counts every write.
- The PostgreSQL test runs only against the disposable GitHub Actions `app_db`.
  It checks tenant isolation, a second member's shared progress, preserved schedules,
  real preview calculations, unchanged database records and PostgreSQL write rejection.
- `.github/workflows/inline-first-payroll-qa.yml` exercises a zero-employee employer
  in Chromium: owner setup, HR resume/add/review, finance resume/preview, foreign
  tenant and checker denial, unchanged run/register/ledger/audit/progress/session data.
- The regular CI workflow remains responsible for typecheck, warning-debt lint,
  the complete Manila-timezone test suite and all golden payroll suites.

Local validation in this workspace cannot prove browser or PostgreSQL acceptance:
there is no disposable PostgreSQL service or Chromium runtime configured. These
checks must pass in CI before claiming completion or enabling the feature.
