# Tenant-isolation small-write batch: labor-inspection remediation POST

**Status: DRAFT, source-level hardening only. NOT ACCEPTED. ZERO tenant coverage credits.**
**Scope:** `POST /api/compliance/labor-inspection`, all three action variants (`assign`, `acknowledge`, `close`). Existing GET is unchanged.

## Source-identified boundary

The existing role/permission and company-wide authorization gate precedes the employer-scoped readiness and remediation lookup. However, the assign/acknowledge final UPDATE selected a global remediation ID without repeating `organization_id` in its WHERE clause. All three POST actions committed remediation state outside the audit writer, so audit insertion failure could leave an unaudited decision. No exploit or production incident is claimed.

## Changes

- Bind every final UPDATE to remediation ID, authenticated employer, finding key, and the previously observed status. If stale or missing, refuse the write.
- Commit assign/acknowledge/close state and the matching audit receipt in the **same database transaction**, using `recordAuditEvent(..., tx)`. If an audit write fails, the decision rolls back.
- Return a non-sensitive 409 and private no-store headers for transaction failure, without returning database errors.
- Preserve role/permission checks, fresh MFA on close, finding eligibility, no-payroll changes, and GET behavior.
- No migration, release flag, tenant-method manifest, provider, queue or payroll writes.

## Validation and acceptance gate

Source/contract regression: `node --test tests/tenant-labor-inspection-remediation-post-boundary.test.mjs`. Follow with `npm run typecheck`, `npm run lint`, and repository CI on **this exact PR head**.

**Not yet performed and required before a tenant method credit:** disposable PostgreSQL 16 + production-mode localhost Next HTTP using three fictional employer fixtures (independent attacker B/C, victim A with higher real record ID >6). Show genuine own successful `assign`, `acknowledge`, and `close` responses; foreign and forged employer/finding selectors denied; unchanged victim remediation and audit snapshots; audit-failure injection rolling back a would-be successful own decision; stale-status conflict behavior and immutable victim state. Include source-pinned receipt lines and exact-head Actions links.

Do **not** promote the live method manifest to COVERED, merge, deploy, or declare global tenant isolation accepted based on this source-only batch. Independent security/coverage-owner review is required.
