# Tenant isolation: private HR document path-ID prefilter

**Status: DRAFT / NOT ACCEPTED / zero tenant method credits.** This is a small runtime hardening change in the private-document family. It is independent of the currently open year-end, subscription billing, de minimis and migration-import PRs.

## Method-specific scope

- `GET /api/documents/[id]`: before fetching any document metadata or bytes, the path ID must match a document whose employer has an **active, non-group-HR membership for the authenticated user**.
- `DELETE /api/employee-vault/[id]`: apply the same active-employer predicate **before** resolving document employee/tenant or the removal policy.
- The correlated SQL membership predicate binds `user_organizations.user_id`, `organization_id = documents.organization_id`, and `active = true`. Unknown IDs, real foreign-employer IDs, and revoked-member IDs are all excluded by the same query and return the same 404 without an unscoped document lookup.
- Existing **ID-only URLs stay valid**. No user-supplied employer selector is trusted, so no UI/client migration is required. Users with active memberships in multiple employers can still reach only documents in employers for which their normal downstream role, employee, unit, session policy and privacy checks pass.

## Preserved controls

The document download still enforces employee ownership or People-role/unit permissions, storage identity, malware scan, integrity hash where applicable, view audit, short-lived object URLs, and private no-store headers. The vault removal still checks the release flag, same-origin mutation, demo-account denial, employee-vault authorization, uploader/removal permission, rate limit, sensitive-action MFA and tenant/employee-bound removal transaction.

The prefilter alone does **not** authorize any document action. Same-employer underprivileged callers can continue to receive role-policy 403. Out-of-employer IDs are not resolved into a document row.

## Evidence and acceptance

The new focused `tests/tenant-private-document-id-boundary.test.mjs` guards the active membership/tenant predicate, refuses removal of each part of that predicate, and checks route authorization ordering and existing safety controls. **This is source-contract evidence only:** no HTTP/PG16, private storage, security review, deployment, live employee document or audit-write execution is claimed.

Before merge, a maintainer/security reviewer must run **at the exact PR head** using disposable PostgreSQL 16 and localhost real HTTP, with two independent authenticated employer principals and a third genuine higher-ID victim. Verify owned clean-document GET (legacy bytes or synthetic signed URL) and own-file vault DELETE (204); genuine foreign and absent IDs must have identical 404 responses with no victim markers; revoked employer membership, same-tenant coworker access, owner/HR/unit policy, scanner and MFA holds must remain fail-closed. Snapshot victim documents, worker links, retained objects and audit state before/after denials and owned deletes; assert the victim is unchanged. Never run this against real customer files or production storage.

## Collision and source-pin control

This change intentionally does **not** edit the shared tenant coverage manifest, global inventory, closure plan, CI gates, historical proof receipts or other PR-owned files. No method is reclassified or credited. Because changing live route source can invalidate historical source hashes, a **coordinated source-pin reconciliation on the latest main** is required after review; do not force-merge a stale shared manifest or borrow an older proof execution. This PR is not merge-ready until final-head CI, source/inventory guards, dedicated runtime security evidence and independent approval pass. No customer data, SQL migrations, flags, money paths, provider calls or deployment are authorized.
