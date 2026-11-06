# Managed-payroll client-approval tenant boundary

**Scope:** `POST /api/managed-payroll/runs/[id]/approve` only. Draft security hardening; no new tenant-isolation method credit.

## Problem addressed

The previous handler loaded a globally addressed payroll-run ID before establishing an active tenant grant. A real foreign ID could take a different error path from a nonexistent ID. It also accepted a company-wide owner/admin row without checking `user_organizations.active`, so a revoked designated client approver might reach approval writes.

## Changed boundary

- Resolve run IDs only through an active organization membership with a company-wide owner/admin role. Foreign, revoked, unit-scoped and nonexistent run IDs are indistinguishable no-store 404 responses.
- Confirm the current user is the engagement's designated approver; keep pilot/live status, MFA, independent checker, fingerprint and required implementation gates.
- Lock membership, engagement and run rows in a transaction. Recheck the active grant, designation, run state and evidence gates before approving. Re-approval updates are scoped to BOTH the run and engagement.
- Re-read independent checker approval evidence and enforce separation of duties after locking the payroll run, inside the same transaction as the approval. **Require an immutable, positive numeric `deciderUserId` from authenticated checker evidence. Missing, malformed or legacy name-only evidence now fails closed (409); the checker and client approver may not be the same authenticated user (403).** No mutable display-name fallback remains. Concurrent checker revocation still needs real HTTP and transaction adversarial proof.
- Compute the payroll fingerprint using the transaction's own connection; this also avoids deadlock when PG_POOL_MAX=1. Commit the approval row and audit receipt atomically. Payroll math, financial rails, provider switches, schema, employee data, main and other pull-request evidence remain unchanged.

## Tests included

- Pure grant matrix: own owner/admin, revoked member, wrong user/employer, unit-scoped admin, payroll/checker, approver rotation, foreign/missing engagement.
- Source contract: active tenant join precedes engagement read; transactional grant recheck and ordered locks precede approval writes; audit is written in the same transaction. Added numeric checker-ID matrix covering missing, malformed, same-user, different-user and invalid approver evidence.

## Required before acceptance

### Executed dedicated HTTP proof (synced-head CI pending)

`scripts/qa/tenant-managed-client-approval-http.mjs` now runs as a separate
Security HTTP acceptance step, reusing its disposable PG16 and production Next
server. It refuses execution outside the existing strict CI/localhost/no-provider
guard. It prepares two authenticated client owners, separate checker identities,
and a populated higher-ID victim. Assertions cover own approval/replay/reapproval,
persisted approval and audit identity, forged selectors, foreign/missing parity,
revoked, wrong-role and unit-scoped grants, designation rotation, response discrimination,
an observed membership-lock revocation race, and audit-failure rollback.

The proof passed on `ab2ae08befca7272320830c6f01bac98b301887c` in
[Security HTTP acceptance run 42154187261](https://github.com/erwinmehehe/payrollph/actions/runs/42154187261/job/127694539195).
Its receipt records two own approvals, two own reapprovals, higher-ID victim run
51, an observed membership revocation race and audit-failure rollback, with
zero credits and no production certification. Main sync creates a new head, so
applicable CI must execute again. Concurrent checker-evidence revocation remains
a separate unproven scenario; it is not certified by this receipt.
No coverage credits, runtime guards, payout flags or deployed data changed.

- [ ] `npm run typecheck`, lint, unit tests, and applicable Security HTTP Smoke / regression jobs pass on the exact PR head.
- [ ] Synthetic PostgreSQL 16 **production-mode real HTTP**, at the exact proposed route SHA: two independently authenticated employers with genuine own successful approval POSTs, a higher-ID real foreign victim and missing-ID indistinguishable 404/no-store, revoked and unit-scoped grants denied, switched approver denied, unchanged victim run/approval/audit/payroll SQL.
- [ ] Repeat positive own **re-approval** after changed fingerprint plus negative revoked owner during the attempted transaction; assert atomic rollback of approval and audit on failure.
- [ ] Independent repository/security/payroll reviewer accepts the work. Re-inventory a changed handler with an exact-source, zero-credit `GAP` hold if needed. Do **not** promote this method to `COVERED` or claim independent acceptance without complete method-specific PG16 HTTP proof and security review.

**Status: SYNCED-HEAD CI PENDING; NO PAYOUT ACTIVATION OR COVERAGE PROMOTION.**
Source merge follows maintainer review and current-head checks under
`docs/engineering/change-risk-policy.md`. The independent reviewer item remains
unperformed and must not be claimed. This is source and regression hardening
only, not global tenant-isolation certification or authorization to enable payouts.
