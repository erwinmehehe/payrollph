# Payroll approve -> release: mandatory independent user

Security hardening from the 2026-10-10 audit.

The payroll release HTTP route checks the authenticated stable checker user ID
from the transactionally written approval decision audit for the *same
organization, run and approval task*. It does not use the mutable display name
(`decidedBy`), an approver role label, or the opt-in treasury operation policy.

- Same checker and releaser: HTTP 403, no financial settlement.
- Missing legacy stable checker ID, missing audit, or multiple matching
  decision events: HTTP 409, resubmit for fresh independent approval.
- Different authenticated checker and authorized releaser: existing release
  integrity checks and normal settlement remain unchanged.
- The guard executes after Ready -> Releasing atomic claim and restores that
  unconsumed claim if evidence is invalid. No ledger entry is settled.

Important: this change covers the HTTP release route. Any alternative direct
callers of `settlePayrollRun`, privileged DBA writes and audit-log tampering
require separate review. An append-only or externally attested audit source is
a future defense-in-depth requirement.

Synthetic integration tests check same user, delegated decider, wrong tenant,
missing/duplicate evidence and exact task/run matching.

Human payroll/treasury acceptance and multi-role staging are required before
production merge. This guard is NOT a replacement for the distinct treasury
operator check on payout submission and confirmation.
