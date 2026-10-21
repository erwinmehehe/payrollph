# Governed backdated salary correction cases (#641)

Status: built behind `HCM_SALARY_CORRECTION_CASES_ENABLED` (default OFF).
Requires migration `drizzle/0135_salary_correction_cases.sql`, applied only
through the protected reviewed-migration workflow. Not yet reviewed by a
Philippine payroll/tax professional; keep the flag OFF for real employers
until that review and a no-money pilot are done.

## What a case is

A case records that an employee's pay rate should have been different from a
past effective date, lists every Released payroll that date affects, and
proves each one was dealt with. **It never calculates, posts or releases
money.** Released payroll is never edited.

- Back pay for each affected run goes through the existing underpayment flow
  (`/api/payroll-underpayments`). Payroll staff enter the amount from their
  own recalculation, and a separate reviewer approves it under
  `PAYROLL_UNDERPAYMENT_POSTING_ENABLED`. The case only links to that request.
- The rate going forward is fixed through the normal compensation approval
  flow. A case cannot be submitted until the employee's current pay profile
  already shows the corrected rate.

## Rules

| Rule | Where it is enforced |
| --- | --- |
| Effective date is in the past and inside the current Philippine tax year | create (`PRIOR_TAX_YEAR`, `EFFECTIVE_DATE_NOT_PAST`) |
| Employee belongs to the employer and the selected legal employer | create, plus every query scoped by `organization_id` |
| Pay history did not change since the preview (`expectedLatestRevisionId`) | create (`STALE_PAY_HISTORY`) |
| Every affected Released run is listed, at most 50, one entry each, same legal employer | create and refresh |
| Retrying with the same idempotency key returns the same case; a different correction with that key is refused | create, unique index |
| One open case per employee | partial unique index |
| Each run is either linked to an underpayment request or marked "no shortfall" with a 20-500 character reason | submit and approve (`CASE_INCOMPLETE`), table CHECK |
| A request is linked to at most one case run, for the same employee, run, entry and entry fingerprint | link, partial unique index |
| Declared total equals the sum of linked request amounts, in whole centavos | submit and approve (`TOTAL_MISMATCH`) |
| Source runs are still Released with unchanged entries | submit and approve (`SOURCE_CHANGED`) |
| A newly Released run blocks until refreshed into the case | submit and approve (`AFFECTED_RUNS_CHANGED`) |
| No payroll run for the period is still in progress | submit and approve (`RUN_IN_PROGRESS`) |
| Linked requests are still pending or posted (not rejected) | submit and approve (`LINKED_REQUEST_INVALID`) |
| The forward rate is already applied | submit and approve (`FORWARD_RATE_NOT_APPLIED`) |
| The approver is not the person who opened the case | approve (`SELF_REVIEW`) and table CHECK |

Statuses: `draft` → `submitted` → `approved`, or back to `changes_requested`
when the reviewer returns it. Open cases can be `cancelled`. Cancelling
withdraws every link so the requests can be reused, and the audit event keeps
the previous links. Every action writes an audit event.

## API

`/api/hcm/salary-corrections/cases` (same-origin, MFA, rate-limited,
company-wide access):

- `GET ?organizationId=` lists cases with their runs and linked request status
  (payroll view roles).
- `POST` opens a case: `organizationId, legalEntityId, employeeId,
  effectiveDate, correctedPayBasis, correctedRateAmount, evidenceReference,
  reason, idempotencyKey, expectedLatestRevisionId?` (payroll operator roles).
- `PATCH` with `organizationId, caseId, action`:
  - maker (payroll operator roles, and only the person who opened the case for edits):
    `link_underpayment` (`caseRunId, underpaymentRequestId`),
    `mark_no_shortfall` (`caseRunId, reason`), `clear_run` (`caseRunId`),
    `refresh`, `submit` (`declaredTotal`), `cancel` (`reason`);
  - checker (payroll tax approver roles): `approve` or `reject` (`reviewReason`).

## Not covered

- Overpayments (negative differences). Use the overpayment recovery flow.
- Corrections that reach into a previous tax year. They change the annual
  reconciliation and BIR 2316 and belong to the year-end adjustment process.
- The tax and contribution treatment of posted back pay is the one the
  underpayment flow already uses (taxable, in SSS and Pag-IBIG base). A
  Philippine payroll/tax reviewer must confirm it before real use.

## Tests

- `tests/hcm-salary-correction-cases-postgres.test.ts`: real PostgreSQL;
  covers idempotency, concurrent create and submit, stale pay history, wrong
  employer, completeness, reconciliation, in-progress and newly Released runs,
  source change, rejected request, return and resubmit, self-approval (app and
  database), cancellation and link reuse, rollback and audit.
- `scripts/qa/salary-correction-case-tenant-proof.mjs`: real HTTP against a
  flag-on server with two attacker employers and a victim employer.
- Both run in `.github/workflows/salary-correction-cases-qa.yml`.
