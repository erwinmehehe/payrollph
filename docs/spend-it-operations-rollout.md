# Spend & IT operations: review and rollout

## Scope of this release

This is a tenant-scoped operational foundation, **not** payment-card issuance,
a bank transfer product, device remote management, or identity provider
provisioning. Never describe it as live issuer/MDM/SCIM integration.

### Spend management

- The existing `Expenses` navigation retains the employee-paid expense
  claim editor. Individual approved claims remain eligible for the existing
  payroll reimbursement calculation.
- Expense reports group pending claims for a single employee (1-50 lines).
  Submission records a stable user ID. An independent user approves/rejects
  all report lines in one database transaction. An included claim cannot be
  decided by the legacy single-claim endpoint.
- Claim submitters cannot self-approve new standalone expense claims.
  Legacy claims without a submitter ID remain marked as such.
- Approved claims are passed to payroll. The payroll release transaction
  marks each paid claim and its payroll run ID; released claims cannot
  participate in a second payroll run. Report payment state is derived from
  claim rows, **not** manually asserted on the report.
- Employer-paid corporate card transactions are stored in a completely
  separate ledger with merchant, date, unique issuer/statement reference and
  PHP amount. They are **not** employee reimbursements. Cards record issuer
  names, last four digits and optional issuer references only.
- No full card number, card verification code, issuance credential or card
  signing key should be entered or stored.

### IT operations

- `Assets` retains the original equipment creation form and adds an IT
  custody ledger referencing those same asset IDs.
- Managed devices have tracked assignment, return request, return, loss,
  availability and retirement states. Managed equipment cannot be
  changed/deleted through the legacy asset endpoint.
- An app directory tracks worker-specific requested, confirmed, revocation
  requested and revoked states. Confirmations are **human attestations**.
- Employee creation with an asset records IT custody immediately.
- Commencing a separation requests recovery of assigned managed devices
  and revocation of active application access; it does **not** execute those
  actions at an external vendor. A retrying reconciliation path is
  idempotent.
- IT clearance for final pay is blocked while recorded app access or
  issued equipment remains outstanding. Offboarding checklist completion
  enforces the same tracked obligations.
- Privileged manual decisions require fresh MFA in production when the
  existing privileged-MFA control is enabled, and have request rate limits.

## Before merging

- [ ] Run `npm ci`, `npm run lint`, `npm run typecheck`,
  `npm run source:size:check`, `npm test`, and `npm run build`.
- [ ] Run `npx tsx --test tests/spend-it-database.test.ts
  tests/spend-it-operations.test.ts` against an **isolated Postgres 16** with
  the latest schema; confirm tenant isolation and money constraints.
- [ ] All four existing payroll golden suites must continue to pass.
- [ ] Check the PR's GitHub Actions jobs; do not merge based on a pending,
  canceled or absent check run.
- [ ] Review the entire database migration diff in a disposable environment
  before approving production DDL. The repository uses Drizzle `db:push`,
  not historical SQL-file migrations for new schemas. Do **not** point
  `db:push` at production as a convenience shortcut.
- [ ] Spot check finance maker/checker across two distinct member accounts;
  verify a submitter's self-approval is rejected.
- [ ] Spot check cross-tenant, department, SSO/session policy, MFA and origin
  enforcement; inspect audit events on every sensitive mutation.
- [ ] Verify a separating worker cannot be assigned fresh devices or app
  accounts, and that IT clearance stays pending until assets are recovered.

## Staging smoke-test procedure

1. Use a disposable test company and two users with independent rights.
2. Add an employee and a reimbursable expense claim.
3. Submit an expense report and try approving as submitter: reject.
4. Approve as reviewer: claims become approved; company card charges are
   still excluded from payroll earnings.
5. Release a synthetic payroll run using the project's payroll safeguards.
   Confirm its claim rows are marked `paid` and report says `paid`.
6. Register a card with only issuer + last four, record one statement line,
   then retry the reference; verify the duplicate is rejected.
7. Create a laptop in `Assets`, track it as an IT device, assign it to an
   active employee and request one application access grant.
8. Confirm app access manually, start the worker's Separation and verify
   revocation/return requests are queued (not reported as executed).
9. Verify final-pay IT clearance is blocked. Confirm revocation and physical
   return, then record clearance through the existing evidenced workflow.
10. Test second tenant and scoped HR unit: no access to the first tenant's
    card ledger, reports, device events or app grants.

## Operational boundaries and next tranche

Live card issuance, issuer transaction ingestion/webhooks, merchant category
policies, card limits, receipt file storage, bank-initiated reimbursements,
MDM device commands, software provisioning, OAuth/SCIM vendor adapters and
separate IT administrator roles are **not part of this PR**. Implement each
as a provider-specific connector with credential isolation, signed inbound
events, authorization, idempotency, dry runs, reconciliation and rollback
evidence. Never set a manual ledger status as proof of remote execution.

Roll back the application code before removing new database records. Because
historical card charges, reports and IT attestations are audit evidence,
avoid destructive database rollbacks; preserve tables for later replay.
