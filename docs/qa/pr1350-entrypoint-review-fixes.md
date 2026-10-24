## October 24: controlled activation and isolated proof repair

The new pre-run gate is registered as PAYROLL_PRE_RUN_READINESS_ENABLED and defaults OFF. Both Create & process and /process consult the server registry after authorization and before the new source loader. Dashboard metadata controls the UI only; a client cannot override the server flag. Legacy calculation, release assurance, maker/checker and payout readiness remain independent. No statutory verification dates, engine arithmetic or production settings changed.

Dedicated pre-run and second-pass HTTP workflows explicitly turn the flag ON only for disposable fixtures. Normal money-lifecycle/connected payroll workflows retain their successful flag-OFF calculation expectations. The strict ON tests continue to require rejection of missing verification/input evidence; they are not positive financial acceptance.

The Create & process HTTP negative control now seeds encrypted fictional payout destinations for its own disposable employer before testing pre-run rejection. It previously stopped at the earlier PAYOUT_DETAILS_REQUIRED gate and therefore never reached the intended source gate. Victim records remain untouched. Only the shifted existing proof references were updated; no coverage credits added.

Local PostgreSQL 18 integration passed: flag-OFF populated calculation, ON recalculation blocked with unchanged run/entries, strict ON creation blocked before insert/audit, foreign/anonymous denials, draft-only creation and separating/mixed cohort findings. Target: dedicated synthetic payroll_draft_test_20261024, not a hosted database. Deterministic readiness/rule-watch/release-flag tests and source/inventory guards passed. New exact-head HTTP/PG16/full-CI results are still required.

Official-source verification and positive flag-ON acceptance remain activation prerequisites. A passing flag-OFF journey does not certify official statutory provenance, real-employer payroll or settlement.

---

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
