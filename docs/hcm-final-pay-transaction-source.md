# HCM final-pay transaction source integrity (stacked on #644)

**Intent:** Resolve #644's known race where financial source fingerprints were
computed from outside a database transaction and trusted afterward. This is a
separate stacked PR; the canonical 3-person final-pay workflow, manual-release
default-OFF gate and `0102` migration remain owned by #644.

## Financial source validation

- Every lookup in `loadFinalPaySources` supports a transaction-bound reader.
  PostgreSQL schema bootstrap stays outside the money-bearing transaction.
- Initial final-pay preparation, independent finance approval and final-pay
  release each use a **SERIALIZABLE PostgreSQL transaction**.
- Within each transaction, fresh source data is fetched and compared with the
  exact persisted calculation fingerprint before any irreversible state,
  loan balance, position vacancy or final-pay review is written.
- The initial calculation intentionally sets the employee status to
  `Separating` *after* computing from the original Active/On-leave worker
  state. The transaction verifies the **before** source, while its stored
  fingerprint anticipates the authorized **after** state. Without this
  correction, the independent checker rejects a legitimate newly initiated
  separation as falsely stale. A worker already marked `Separated` remains
  blocked rather than normalized into approval.
- The final-pay release uses the **transaction-read employee loans**, not
  a copy read earlier in a separate pooled connection.
- Relevant source evidence now includes employee status, basic rate, MWE tax
  classification, legal employer and org unit, employment date, current pay
  profile, released payroll entries and traces, historical 13th-month/tax/SSS/
  PhilHealth/Pag-IBIG data, and loan type/total paid/remaining balance/status.
  Rows are sorted by stable IDs before comparing. An incidental SQL result
  ordering difference therefore does not trigger a false stale-data error.
- PostgreSQL serialization failure (40001) or deadlock (40P01) produces a
  stable HTTP 409 conflict. **Money-bearing decisions must never auto-retry.**
  The operator must reload, reconcile and obtain the appropriate independent
  review again.
- The existing `FINAL_PAY_MANUAL_RELEASE_ENABLED` feature flag continues to
  default OFF. This PR does not enable payouts, bank API calls or releases.

## Important limitation

A serializable transaction and fresh source fingerprint do not by themselves
prevent a *future* legacy payroll/loan writer that lacks HCM lifecycle checks
from changing a separated worker's source data after release. Nor do they
prove a bank transfer occurred. Review all payroll-source writers for shared
employee lifecycle locks/eligibility before actual production certification.

Existing in-progress packages created with older, incomplete fingerprints may
fail the expanded source comparison and need a fresh governed final-pay
recomputation with independent approval. A migration or flag must not silently
accept old incomplete source evidence.

## Staging requirements

- Full CI/TypeScript, security, isolated PostgreSQL, payroll goldens and
  Next build on the exact staged commit.
- Reconcile multi-period source payroll, 13th month, MWE statutory treatment,
  imported historical records and multiple outstanding loans with independent
  Philippine payroll/CPA calculations.
- Fault-inject payroll source edits between first form read and transaction
  validation; verify a 409 and no financial mutation.
- Simulate two concurrent approvals/releases, a changing loan balance and
  altered statutory YTD while source is being checked. A serialization abort
  or a source mismatch must roll back all finance, employee and loan writes.
- Test audit failure and status transitions in a staging clone. Confirm no
  automatic retries and no duplicate payout references.
- Review with payroll, finance, HR, privacy/security and DBA signatories.
  This code does not substitute for production pilot or agency/bank acceptance.

## Dependency and merge order

The stacked PR targets **#644**, not main. No additional migration is
introduced. #644 must not be merged independently of required SQL migration
ordering: `0100` (#626), `0101` (#642), then `0102` (#644), with the
actual main-branch guard from #645 applied and staging DBA evidence reviewed.
Avoid merging/reapplying closed overlapping #646.

**Production state: unchanged. No payroll transfers, schema deployment or
real-worker data mutations were performed by this patch.**
