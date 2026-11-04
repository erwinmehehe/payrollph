# Managed-payroll client-approval tenant boundary

**Scope:** `POST /api/managed-payroll/runs/[id]/approve` only. Draft security hardening; no new tenant-isolation method credit.

## Problem addressed

The previous handler loaded a globally addressed payroll-run ID before establishing an active tenant grant. A real foreign ID could take a different error path from a nonexistent ID. It also accepted a company-wide owner/admin row without checking `user_organizations.active`, so a revoked designated client approver might reach approval writes.

## Changed boundary

- Resolve run IDs only through an active organization membership with a company-wide owner/admin role. Foreign, revoked, unit-scoped and nonexistent run IDs are indistinguishable no-store 404 responses.
- Confirm the current user is the engagement's designated approver; keep pilot/live status, MFA, independent checker, fingerprint and required implementation gates.
- Lock membership, engagement and run rows in a transaction. Recheck the active grant, designation, run state and evidence gates before approving. Re-approval updates are scoped to BOTH the run and engagement.
- Compute the payroll fingerprint using the transaction's own connection; this also avoids deadlock when PG_POOL_MAX=1. Commit the approval row and audit receipt atomically. Payroll math, financial rails, provider switches, schema, employee data, main and other pull-request evidence remain unchanged.

## Tests included

- Pure grant matrix: own owner/admin, revoked member, wrong user/employer, unit-scoped admin, payroll/checker, approver rotation, foreign/missing engagement.
- Source contract: active tenant join precedes engagement read; transactional grant recheck and ordered locks precede approval writes; audit is written in the same transaction.

## Required before acceptance

- [ ] `npm run typecheck`, lint, unit tests, and applicable Security HTTP Smoke / regression jobs pass on the exact PR head.
- [ ] Synthetic PostgreSQL 16 **production-mode real HTTP**, at the exact proposed route SHA: two independently authenticated employers with genuine own successful approval POSTs, a higher-ID real foreign victim and missing-ID indistinguishable 404/no-store, revoked and unit-scoped grants denied, switched approver denied, unchanged victim run/approval/audit/payroll SQL.
- [ ] Repeat positive own **re-approval** after changed fingerprint plus negative revoked owner during the attempted transaction; assert atomic rollback of approval and audit on failure.
- [ ] Independent repository/security/payroll reviewer accepts the work. No change to `scripts/qa/tenant-isolation-coverage-manifest.json` or claimed COVERED methods without complete method-specific accepted proof.

**Status: DRAFT, NOT ACCEPTED. DO NOT MERGE/DEPLOY/ENABLE PAYOUTS.** This is source and regression hardening only, not global tenant-isolation certification.
