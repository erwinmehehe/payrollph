# PR 1350 calculation-entry and employment-cohort fixes

Create & process now invokes the same read-only readiness loader as /process
before inserting a payroll run, recording its creation or queuing calculation.
The new-draft identity uses ID zero solely as an unsaved diagnostic identity;
organization, legal employer, unit, role and subscription checks have already
completed. Draft-only creation remains available with processNow=false and does
not calculate entries. Statutory verification records are not fabricated.

The readiness loader and /process timesheet cohort now reuse
payrollEmploymentStatus(periodStart), matching the engine's approved-exit flag
and separation-date eligibility. This prevents a separating-only run being
misreported as empty and prevents separating workers in a mixed run escaping
profile/attendance checks. Flag-off legacy employment selection is preserved.

Local verification: all 13 deterministic pre-run tests, the new real PostgreSQL
entrypoint/cohort regression, 17 isolation inventory/structural guards, scoped
ESLint and project TypeScript passed. PostgreSQL execution used the dedicated
localhost payroll_draft_test_20261024 synthetic fixture; its in-process session
adapter is not a browser or real-HTTP authentication proof. The HTTP second-pass
suite now additionally checks own creation 422, foreign creation 403 and no run
write. That new HTTP case remains pending exact-head CI execution.

No new tenant coverage credit or real payroll/settlement acceptance is claimed.
Official-source verification and successful governed calculation acceptance
remain separate merge blockers for the broader PR. Existing financial tests
have not been changed to treat an expected block as successful calculation.
