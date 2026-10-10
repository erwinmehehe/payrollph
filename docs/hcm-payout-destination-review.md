# HCM employee payout destination control after first payroll calculation

## Why

The legacy employee profile editor allowed direct changes to employee bank
account, bank code and payout-mobile fields whenever optional enterprise
Treasury Controls were off. MFA and auditing alone do **not** replace the
independent approval required for high-impact payee redirection after an
employee appears in a calculated or released payroll register. Incorrect data can divert future funds.

## What this code changes

**Company with enterprise Treasury Controls enabled**

The existing `employee_payout_change_requests` maker-checker workflow
remains authoritative. A People administrator submits a destination
change; a different, assigned treasury operator approves it with MFA,
fresh source evidence and independent payout preflight. This PR does not
change those approval/settlement routes.

**Employee with a payroll register entry (including Draft), Treasury Controls disabled**

The legacy `PATCH /api/employees` now rejects every bank, bank-code
or payout-mobile destination edit with
`409 PAYOUT_DESTINATION_REVIEW_REQUIRED`. The operator must enable and
configure enterprise Treasury Controls, or use a future independently
approved correction workflow for plans without treasury support. This
restriction intentionally applies even to company owners; adding a fresh
employee record is not a legitimate workaround.

**Employee with no payroll register entry, Treasury Controls disabled**

Initial payout coordinates can still be completed by company-wide
owner/admin, with recent MFA and rate limiting, but **not by scoped HR**.
Payout details must be submitted separately from salary, rest day,
employment-date and government-identity updates. The employee row is
locked, current payout fields checked against the form's snapshot,
existing payroll-run rows locked and rechecked, and Treasury policy
enablement rechecked inside the write transaction.

The initial payout record and masked audit evidence commit in the **same
database transaction**. An audit-store failure rolls back the payout
change. A concurrent bank edit, Treasury policy change or newly recorded
payroll entry observed before commit yields HTTP 409 rather than overwriting
payee data. Audit metadata does not store raw bank accounts or phone
numbers.

## Operational migration and limitations

- **Customer workflow change:** legacy workspaces without the enterprise
  Treasury feature may be unable to change an already-calculated employee's bank/mobile
  details until a supported independent-review path is provisioned.
  Product/support must validate plan entitlements and provide an
  accessible, approved alternative before customer rollout. Do not tell
  the user to bypass controls by clearing payroll history or creating
  a duplicate worker.
- A query on payroll register entry, even under a transaction, is not
  a global transactional lock against all concurrent *new payroll entry*
  creation. Coordinate rollout with the payroll-engine and treasury
  team and test a simultaneous first payroll calculationroll/calculation/destination
  update. Broader tenant-wide fencing remains a separate release gate.
- This guards **PATCH** of an existing employee. Historical CSV migration,
  original new-hire intake and direct database scripts have separate
  governance/reconciliation requirements.
- It does not verify external beneficiary ownership, account number
  correctness, remittance acceptance, bank payout settlement or actual
  employee consent. Request/checker SOP remains necessary.
- All tests are synthetic. No production payout details, money,
  agency filings or paid payroll registers are touched by this PR.

## Release acceptance

- Exact-head GitHub CI / TypeScript / PostgreSQL integration tests /
  CodeQL / Next build / payout isolation / backup rehearsal.
- Staging exercises: newly hired pre-first-calculation initial payout; scoped HR
  denial; Treasury-enabled independent change request; payroll-register worker
  fail-closed when Treasury disabled; stale bank field and policy
  enablement conflicts; source payroll advancing during update.
- Fault inject audit storage failure: no bank/mobile mutation remains.
- Verify UI tells paid-employee operators how to use the supported
  approval workflow and does not display account numbers unmasked.
- Require independent payroll/finance, privacy and customer-success
  approval for rollout, especially on plans without enterprise Treasury.

This change adds no SQL migration or bank action. It is intentionally a
draft until real-workspace product and risk reviewers sign off.
