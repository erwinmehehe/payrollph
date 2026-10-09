# Final-pay release and separation HCM controls

This draft is a **high-impact authorization change** to the existing separation
module. It does not itself initiate or verify bank transfers, certify DOLE
compliance, calculate a new tax rule, or authorize production disbursement.

## Default-off money release gate

Manual final-pay release is **disabled by default**: the backend requires
`FINAL_PAY_MANUAL_RELEASE_ENABLED=true` before allowing an approved package
to be marked released. The UI displays the gate and disables the button
while off. Draft preparation, departmental clearance, independent financial
approval and COE issuance remain separately available.

Enable this only after independent finance and bank payout verification,
employer confirmation, controlled-pilot reconciliation and release signoff.
An environment flag and a manually entered bank reference are **not** proof
that a transfer occurred; an external settlement receipt/reconciliation is
still required. No request parameter can bypass the feature gate.

## Three distinct authenticated actors

1. **Preparer (maker):** HR/payroll prepares the Separation package. The
   `preparedByUserId` field is replaced whenever financial amounts are
   recomputed, while all prior approval and release IDs are cleared. Employee
   status is still governed by the separately approved termination intent.
2. **Independent checker:** A company-wide HR/administrative approver with
   recent MFA may approve a Draft package only if the preparer user ID exists
   and is different. Source payroll fingerprints and all clearances are
   checked inside a row-locked transaction; package approval and its audit
   event commit together.
3. **Financial releaser:** A company-wide owner/admin with recent MFA and
   a recorded external payout/bank evidence reference (8-160 characters)
   may mark the package Released only when the preparer, checker and
   releaser are **three different account IDs**. The release, loan
   settlement, employee status and position updates, offboarding events
   and financial audit record are in a single transaction.

The release reference is **operator-attested evidence, not API-verified bank
settlement**. A separate reconciliation/actual payment receipt is required
before treating final pay as actually disbursed. Never make a payment based on
the label `released` alone.

## Departmental clearance

- Every clearance update changes **one** IT/Admin/Finance/HR state at a time,
  with an explicit previous value, a 12-500 character reason and an 8-200
  character independently traceable evidence reference.
- IT and Admin: company-wide owner/admin. Finance: company-wide
  owner/admin/bookkeeper. HR: owner/admin/hr with employee scope enforced.
- Recent MFA and rate limiting are mandatory. An unexpected or stale
  request fails; each state change and its audit are a single transaction.
- Clearance adjustments are permitted only in Draft. Once approved,
  clearances cannot be silently revoked/reinstated without resubmitting a
  financially reviewed Draft.
- The UI requires the evidence and explanation before allowing a click.

## Certificate of Employment (COE)

- Creating/viewing a draft is not proof of issuance. An authorized HR/admin
  user must explicitly attest delivery using an 8-200 character reference
  with recent MFA. Issuance state and audit commit atomically.
- Avoid storing employee tax numbers, bank details or other sensitive personal
  information in free-text references.

## Legacy and rollout compatibility

- The new `prepared_by_user_id`, `approved_by_user_id` and
  `released_by_user_id` columns are **nullable** so old packages continue
  to load, but an approval or release missing stable maker/checker evidence
  fails closed. Recompute a not-yet-released package from current verified
  sources and send it through fresh independent approval; do not backfill
  guessed actor IDs from audit display names.
- Apply the **additive** `drizzle/0102_final_pay_maker_checker.sql` with
  a backup and DBA-controlled staging rehearsal. The legacy
  `ensureSeparationSchema` bootstrap is aligned; never modify historical
  `drizzle/baseline.sql`. Do not apply this migration to production from
  the pull request alone.
- The three-person separation rule can block small organizations with only
  one or two privileged user accounts; proper distinct authorized operators
  are a prerequisite to release. Do not add a bypass checkbox.

## Mandatory independent verification

- Exact-head TypeScript, Postgres tests, Next production build, payroll golden
  reconciliation, security scans and backup/restore rehearsal.
- Synthetic three-actor end-to-end test: same account cannot prepare and
  approve, cannot approve and release, cannot prepare and release. Legacy
  packages without stable preparer or checker cannot release.
- Fault injection: fail any audit write and show that financial approval,
  loan deductions, employee status, HCM history and release state roll back.
- Run two simultaneous approval and release requests to confirm exactly one
  result; verify no duplicate separation history or loan payments.
- Recompute an approved package and ensure previous approver and reviewer
  evidence is invalidated and final pay needs new approval.
- Confirm clearance discipline roles, stale toggles, unauthorized scoped
  finance actors and issue-COE attestation are enforced server-side.
- Validate actual bank payment independently and obtain Philippine payroll,
  accounting, HR/labor and privacy/security signoff.

**Known residual gap:** Final-pay computation sources are read and hashed
before the release transaction and not every upstream writer shares the
separation lock. A concurrent non-cooperating salary/loan change could race
with final-pay release. A truly certified real-money rollout still needs
source-row locking/tenant-wide serialization and bank-settlement evidence.
This draft intentionally does not claim those controls already exist.
