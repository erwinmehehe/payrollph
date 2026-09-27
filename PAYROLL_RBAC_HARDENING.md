# Payroll + RBAC hardening

## Commercial architecture

- `/` is the payroll software / HRIS product homepage.
- `/payroll-outsourcing` is the managed-payroll service page and lead funnel.
- Managed-payroll processors work in the same ledger but cannot approve, release, or move client money.
- Client approval is required before managed payroll can be released.

## Payroll integrity changes

- Explicit `period_start`, `period_end`, `pay_date`, calculation mode, service mode, and optional org-unit scope.
- Payroll periods are limited to 16 calendar days and attendance is read only inside the selected cutoff.
- Processing claims a run atomically to prevent concurrent recalculation/reset races.
- Recalculation is side-effect free; expense claims, EWA advances, leave conversions and loan settlements are committed only at atomic release.
- Timekeeping mode with no punches produces zero worked/basic pay plus an exception instead of silently paying a full cutoff.
- Ordinary OT is 1.25x; holiday OT and night-differential stacking are calculated separately to avoid over/under-paying regular holiday hours.
- Monthly salary converts to daily/hourly rate using an organization-level annual divisor instead of a hard-coded `÷22` assumption.
- SSS/PhilHealth/Pag-IBIG employee-share timing is organization-configurable: split across cutoffs or full deduction on second cutoff.
- MWE treatment is component-specific; unrelated supplementary compensation is not automatically tax-exempt.
- Wage-order data is a screening layer only and does not automatically set MWE status.
- No fabricated blanket statutory calamity premium; only explicit company/CBA weather incentives affect payroll.
- Bank/mobile payout files fail closed when payout details are missing; government working files use real statutory IDs.

## RBAC model

- `owner`: full authority including live payroll disbursement.
- `admin`: HR/payroll administration, approval and release; no live disbursement.
- `bookkeeper`: payroll preparation/processing/export and finance operations; no approval, release, member admin, or live disbursement.
- `hr`: HR operations and payroll read-only.
- `employee`: self-service only.

Invitations prevent privilege escalation: only owners can invite owners/admins; admins can invite operational roles only.

## Tenant/API hardening

- Protected APIs use named permissions instead of treating workspace membership as authorization.
- Assets, contractors, expenses, benefits, outbox, payslips, attendance and other resource routes are tenant-scoped.
- Employee Web Bundy and EWA are self-scoped.
- Biometric ingestion requires an organization-scoped API key with `attendance:write`.
- Global benefit-catalog bootstrapping requires both an enable flag and deployment secret.
- Public demo remains isolated and suppresses real payouts, invitations and external side effects.

## Remaining gates before real-money general availability

1. Clean dependency install, typecheck, full test suite and production Next.js build in CI.
2. Rehearse `drizzle/0001_payroll_periods_rbac.sql` on staging with backup/rollback; legacy payroll cutoff backfill must be reviewed manually.
3. Reconcile representative semi-monthly payrolls against independent hand calculations (regular, MWE, OT, ND, holidays, leave, loans, benefits, final pay).
4. Complete final-pay tax adjustment and exact separation/13th-month reconciliation; current separation calculator remains a draft.
5. Validate BIR/SSS/PhilHealth/Pag-IBIG files against current agency validators/templates.
6. Run a controlled low-value bank/disbursement pilot before enabling live money movement.
7. Pilot managed payroll end-to-end: processor → client approver → release authority, including audit review.
