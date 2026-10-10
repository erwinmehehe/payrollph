# HCM payroll overpayment reconciliation preview

## Scope

This is a **read-only worksheet** for authorized company-wide payroll checkers.
It helps identify *possible* differences between an immutable **Released**
payroll register and an independent gross/net calculation. It does not
establish that an employee owes money, that wages can legally be withheld, or
that a past payroll amount was incorrect.

**Default state:** OFF. The server only enables the GET and POST preview routes
when the deployment has explicitly set
`HCM_OVERPAYMENT_PREVIEW_ENABLED=true`.
Otherwise both return 404 and the Compensation preview card stays hidden.
No separate public/browser feature flag is needed.

## Operator workflow

1. On an isolated staging environment, configure
   `HCM_OVERPAYMENT_PREVIEW_ENABLED=true`. Use an authorized
   **company-wide owner/admin/payroll checker** with fresh MFA for a preview.
2. Open Compensation → **Overpayment reconciliation preview**. Select the
   employee (including separated workers) and the **Released** source payroll.
3. Enter *independently verified* gross and net amounts, a case/evidence
   reference and a written calculation rationale. The tool never guesses a
   corrected wage or reconciles actual bank receipts.
4. Preview the separate gross and net differences. Positive differences in
   both fields are labeled *possible overpayment*, **not recoverable wages**.
   Mixed signs and underpayments are explicitly distinguished.
5. Capture the SHA-256 original payroll-entry fingerprint and use an approved
   external HR/payroll case-management process to preserve source documents,
   receipts, statutory reconciliation, applicable employment-law analysis and
   employer/employee communication. **The preview and supplied text are NOT
   persisted by this app.** Refreshing or navigating away loses the result.
6. Do not alter the employee's base pay, statutory contributions, tax filings,
   loan obligations, released payroll, final pay or bank disbursement through
   this preview. Any actual repayment, deduction or correction is a distinct,
   independently signed-off product and legal workflow.

## Safety and data boundaries

- Both routes require authenticated company-wide
  `PAYROLL_TAX_APPROVER_ROLES` rights. GET returns only modest employee
  selection labels and recent Released run metadata. It never returns bank
  account numbers, government IDs or payroll entry line-item/trace bodies.
- POST additionally requires same-origin checking, recent MFA and distributed
  sensitive-action throttling. Organization and run IDs are validated before
  any payroll data is read. Queries independently bind the run and employee to
  the requested organization.
- The employee's original run must be **Released**, unambiguously contain
  **exactly one** employee entry, and pass org-unit scope checks. Historical
  legal-entity mismatch is flagged for review.
- All numeric comparisons use integer centavos with strict decimal syntax;
  there is no JavaScript floating-point salary arithmetic. Unexpected source
  gross/net/deduction arithmetic is reported as a warning.
- The returned SHA-256 fingerprint covers the source entry's run/worker IDs,
  gross, deductions, net, status, line items and calculation trace, without
  disclosing sensitive details in the API response.
- No `db.insert`, `db.update`, `db.delete`, HR transition, loan offset,
  audit outbox, job enqueue, salary revision, payout or remittance call is
  executed by the preview. This feature needs **no SQL migration**.
- Responses always return `reviewOnly=true`, `saved=false` and
  `automatedRecoveryAllowed=false`. The server never accepts a
  `recover`, `approve`, `deduct` or `release` action.

## Testing and release requirements

- Exact-head TypeScript, unit tests, PostgreSQL CI, Next build, CodeQL,
  security smoke and payroll golden regression.
- Staging tests with **two tenant accounts** prove that choosing an
  employee/run from another company does not expose private payroll evidence.
- Staging with two rows for the same employee/run must fail rather than
  arbitrarily choosing a source. Test a separated employee case, staff moved
  between org units, and old run/source fingerprint tampering.
- Independently reconcile one real-looking synthetic released register
  showing tax, SSS, PhilHealth, Pag-IBIG, benefit and reimbursement scenarios.
  Compare to the separate offline payroll reference; never infer legal recovery.
- Confirm the default-OFF state returns 404 even for an owner/checker, and
  the client stays hidden in companies where this feature is not enabled.
- Obtain finance/HR/privacy and Philippine labor/payroll reviewer acceptance
  before showing this feature to employers. Default-off code merge is **not**
  approval to make real employee deductions or changes.

## Deliberate exclusions

This feature does **not** create a persistent recovery case, refund or
negative adjustment, and never modifies the separate reviewed-positive-
underpayment candidate in PR #642. Tax-only amendments, signed salary
corrections, loans, separated-worker final-pay settlement and bank chargebacks
must be designed and reviewed as distinct controlled workflows.

No production records, government submissions or cash operations are changed.
