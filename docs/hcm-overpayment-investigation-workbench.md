# Payroll overpayment investigation — **read-only** evidence workbench

## Purpose and limits

This feature assists company-wide payroll reviewers in investigating a
*suspected* overpayment. It is **not** an adjudicated debt, an employee
notice or consent record, a wage-deduction authorization, a recovered
balance, a refund order, or a final-pay offset. Nothing here creates a
deduction, payment, loan, payroll run, audit case or bank instruction.

The controlled-pilot first release intentionally limits the feature to
a **read-only, unsaved preview**. It can be used to identify which
independent employer/employee documents must be obtained before a
separate lawfully authorized process is designed.

## Access and activation

- Code defaults **OFF**. On the intended staging environment only, enable
  `PAYROLL_OVERPAYMENT_REVIEW_ENABLED=true` after reviewer authorization,
  privacy/security checks and synthetic data acceptance.
- Both source choice GET and private evidence POST require a signed-in user,
  an organization-wide membership with the `payroll.view` permission,
  company-wide rather than departmental scope, and recent privileged MFA
  in production.
- POST uses same-origin enforcement and a sensitive-action rate limit.
  Payroll IDs, amounts and evidence references are sent in request body,
  not query parameters. GET lists permitted workers and the most recent
  Released cutoffs. Do not expose account/bank/government identifiers.
- The server supplies `Cache-Control: private, no-store` on successful
  responses. The UI is not rendered when the server-side feature gate or
  authorization fails.

## Operator workflow

1. Select one employee and the exact *Released* source payroll run.
2. Enter an alleged positive difference in PHP with at most two decimals.
   This is a **claim under review**, not a calculated overpayment.
3. Enter a finance/HR case or worksheet reference and an explanation. Do not
   paste raw TIN, banking credentials, national IDs or unrelated employee PII.
4. Click **Generate read-only investigation**. Review:
   - the specific source run/employee and record fingerprint;
   - gross, deductions, net (which are payroll ledger values, **not proof
     a bank transfer succeeded**);
   - blockers for non-Released runs, zero/multiple employee rows, malformed
     net amounts or alleged amounts greater than the net;
   - extra review flags for separation/final-pay records, existing loan
     balances and previous retro corrections;
   - universal independent-evidence requirements for payroll source,
     disbursement/refund, employee response and lawful authorization.
5. Use **Copy unsaved evidence preview** only within an employer-approved
   confidential case-management channel. It is **not persisted** by Linaw:
   the operator needs to preserve original source documents securely and
   obtain independent confirmation. A hash fingerprint is not a signature
   or proof of bank acceptance.

## Philippine legal boundary

Philippine Labor Code Article 113 limits wage deductions to permitted
grounds; its implementing rules include conditions around written
authorization in relevant situations. Department Order No. 195, series of
2018, amended the rule concerning certain authorized deductions for
payment to the employer or third persons. **A purported overpayment alone
does not establish that a given deduction is lawful.** A Philippine labor
law reviewer must determine the applicable basis, consent/authorization,
employee notice/dispute handling, and wage/final-pay protections for the
particular case. A written reference in this workbench is not proof of
genuine consent.

Official references:
- DOLE Labor Code Book III, Article 113:
  https://dole.gov.ph/book-3-conditions-of-employment/
- Supreme Court E-Library, Department Order 195 (2018):
  https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/35/91259

## Release / QA checklist

- [ ] Exact-head TypeScript, Node and Next build checks, CodeQL/security
  and existing golden payroll suites pass.
- [ ] Cross-tenant and department-scoped staff cannot access a different
  employee's payroll or discover the feature; MFA and origin denial work.
- [ ] A Released, single-entry source produces a stable fingerprint and
  never reports bank payment as verified.
- [ ] Missing/duplicated payroll rows, wrong org unit, wrong company,
  invalid amount, non-Released runs and suspicious claims fail closed.
- [ ] Separated workers, open loans, final-pay history and older retro
  corrections surface manual-review warnings with no change in balance.
- [ ] No INSERT, UPDATE, DELETE, payroll release or bank/provider API
  is invoked. Performance on employers with >1500 workers or >120 recent
  Released cutoffs requires explicit search/pagination before broad rollout.
- [ ] DPO/payroll/legal reviewer signs off on PII minimization, wage
  deduction wording, copied evidence and access policy.

## Next release candidate, not implemented here

A **real overpayment dispute/case ledger** will need independent employee
notice, evidence/consent authenticity, auditable maker-checker legal approval,
idempotent financial adjustments, protected negative/reversal handling, a
new numbered migration coordinated with the outstanding compensation
`0100` schema candidate, and bank/statutory reconciliations. Do not
silently put suspected overpayments into `employee_loans`, edit
`payroll_entries`, offset `separation_records`, or repurpose ordinary
supplementary earnings as negative pay.
