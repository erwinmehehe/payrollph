# HCM Separation — Final-Pay Maker/Checker and Clearance Hardening

This draft release candidate hardens the existing Separation lifecycle without
inventing a new payout rail or changing the final-pay computation engine.

## Financial identity and review

- A final-pay calculation (including a recomputation) now stores
  `preparedByUserId`, resets prior `approvedByUserId` and
  `releasedByUserId`, and commits its actor audit with the worker lifecycle
  and financial snapshot.
- Approval requires a *different account* from the preparer, a permitted
  company-wide HR/approval role, recent MFA, a current finance/IT/admin/HR
  clearance, an unchanged original payroll fingerprint, and the same version
  of the final-pay calculation under a database row lock.
- Release requires company-wide release authority, recent MFA and a minimum
  8-character payout evidence reference. The release actor cannot be the
  preparer. An approver may release for a two-operator employer, but this is
  not a substitute for independent external payment proof.
- Release rechecks preparer/checker identities, all clearance decisions,
  computation state, and worker status while locking the reviewed package.
  The employee must actually be `Separating` and the Philippine-calendar
  effective last day cannot be in the future.
- Release actor ID, worker status, separation status, loan collection,
  position handoff, employment history and release audit commit or roll back
  together. Failed after-release automations are surfaced as warnings, never
  as a false implication that the committed financial transaction failed.

## Departmental clearance

The old PATCH accepted all four clearances at once, coerced a string
`"false"` to **true**, and allowed any People/payroll role to set every
department's flags. Now a request must be exactly one native boolean and an
8–200-character evidence reference, with recent MFA and throttling:

| Clearance | Permitted organizational roles | Additional scope |
|---|---|---|
| IT | owner, admin | company-wide |
| Admin | owner, admin | company-wide |
| Finance | owner, admin, bookkeeper, payroll | company-wide |
| HR | owner, admin, hr | within employee org-unit scope |

Only Draft final-pay packages can receive clearance changes. A transaction
locks the package, updates the one requested flag, computes the aggregate
clearance from the fresh row, and writes the actor and source reference into
its audit trail before commit.

**Remaining limitation:** the application has no dedicated IT actor/department
role. Until delegated attestation is designed and reviewed, an owner/admin
records IT/admin evidence. A single owner/admin still has broad attestation
rights; this PR creates independent final-pay approval but does **not** prove
that all four departments had distinct signatories. Employer SOP must require
the individual evidence, not simply tick four boxes.

## Certificate of Employment

Generating the draft does not attest delivery. An HR/admin actor now needs
recent MFA and an 8–200-character delivery/signed-receipt reference before
marking the COE as issued. The decision and audit are atomic and idempotent.
COE issuance is not delayed solely by final-pay release: employment-certificate
requests follow their own applicable time obligations.

## Legacy tenants and release operations

**Migration:** apply only the new additive file
`drizzle/0102_separation_financial_reviewer_identity.sql` after a staging
backup and verified DBA preflight. Never edit historical SQL migrations.
The Drizzle schema reflects the new columns and a database check rejecting
preparer = approver.

**Older packages:** historical `approved` records lack a trustworthy
preparer/checker user ID. They must not be released on legacy name-only
evidence. Have an authorized operator recompute them to Draft under the
existing HCM lifecycle, refresh departmental clearance and obtain a distinct
reviewer approval. Existing `released` history stays immutable.

**Not a payment receipt:** the release reference records a human's external
payment attestation. The application does **not** connect to a bank portal
to verify this final-pay reference. Reconcile actual cleared bank transactions
and the employee's payment confirmation outside the app. Do not treat a
free-text reference as independent evidence of transferred funds.

## Required before enabling production final-pay

1. Run exact-head TypeScript, Node tests, Next build, CodeQL, payroll golden
   reconciliation, database migration guard and isolated restore.
2. Synthetic database test: same user cannot prepare + approve, unknown
   legacy identities cannot release, valid two-person flow can work.
3. Per-department clearance: reject string booleans, reject multiple fields,
   reject incorrect role/scope, reject changes after approval, require MFA.
4. Concurrent reviewer vs recomputation and two release attempts; assert only
   one succeeds, no double loans or position vacancy changes.
5. Audit-storage fault injection must roll back approval, loan changes,
   separation status and employee lifecycle.
6. Verify source payroll fingerprint, expected last-day status, 13th-month,
   unused leave, loan and statutory deductions against independent payroll
   records for the controlled pilot.
7. Independent HR/employer, Philippine payroll practitioner, finance,
   privacy/security and database reviewer signoff remains mandatory.

No production employee records, bank transfers or external filing evidence
are changed by this code branch. This PR is *not* a statement that final-pay
payments are bank-verified or that general availability is authorized.
