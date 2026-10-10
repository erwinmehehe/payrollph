# Governed retro salary corrections — read-only impact preview

Status: DRAFT, read-only code slice for #641. NOT authorized to apply wage,
statutory, government-loan, tax, GL, payslip or payment changes.

API: POST /api/hcm/salary-corrections/preview, gated server-side by
HCM_SALARY_CORRECTION_PREVIEW_ENABLED=true (default OFF). JSON body:
{ organizationId, employeeId, legalEntityId, effectiveDate,
proposedPayBasis, proposedRateAmount, expectedLatestRevisionId? }.

Access: authenticated, same-origin, MFA, company-wide People and People-payroll
permission gates (including custom deny), same legal employer and employee,
and per-employee rate limit. Private no-store response.

Evidence: existing pay-profile and capped effective-dated revision records
(max 50), plus payroll periods containing the employee (max 50). Returns
only a same-basis rate difference if historical revision evidence supports
it. Never treats this as retro wages or computes net payable amounts.
Missing revision history, changed pay basis and capped periods are labelled
uncertain/partial rather than shown as zero or all-clear. No table writes.

## Required next implementation (still BLOCKED)

- Persist an immutable correction case with idempotency key, minimal protected
  evidence reference, legal employer and versioned source proof.
- Enforce maker/checker separation at transactional decision time, custom
  permissions, MWE, effective-date locks and correction cancellation/reversal.
- Payroll engine must recompute each impacted period with applicable pay,
  attendance, rest-day, holidays/night/OT, social contributions, tax and loans.
- Post distinct supplemental or next-cycle accounting movements, never update
  Released payroll runs/entries/payslips or approval snapshots.
- Create durable post-commit intent and independently review the resulting
  payable payroll snapshot before any payout/export, with rollback and retry
  reconciliation. The preview is neither approval nor consent.
- Human Philippine payroll/tax/privacy/security review; two-tenant synthetic
  staging tests including wrong legal entity, duplicate retries, race,
  zero/negative deltas and fiscal cutoffs; real no-money pilot acceptance.

The correction flow remains NO-GO until these gates are met. Keep this flag
OFF outside isolated synthetic test contexts.