# Issue 908: atomic forward repair 0133

Source package only. No live apply, credentials, grants or release flags changed.
The owner confirms only Vercel is running; there is no separately deployed
worker. The GitHub scheduler dispatch variable was absent at the last metadata
check. Recheck these facts at cutover; source findings are not live receipts.

## Concrete migration

`drizzle/0133_audit_missing_foundation_forward.sql` combines the previously
review-only missing foundation and v2 trigger boundary in one numbered file.
It does not edit or replay historical 0109. Both sections run in the canonical
runner's transaction; a companion failure rolls back the foundation too.

Both preflights pin the database, project, branch and endpoint. Existing chain
evidence, a partial foundation, wrong column shape, missing or unsafe trusted
groups, and replay are refused. No existing audit row is sealed or rewritten.
The mutation, insertion and truncate guards become active together. Functions
remain invoker-rights. PUBLIC cannot execute the sealer.

The SQL deliberately does not create or modify login roles. Its two prerequisite
groups (`payrollph_audit_sealing` and `payrollph_audit_maintenance`) must already
exist as NOLOGIN/NOINHERIT without elevated attributes, inherited memberships or
owned objects. Group provisioning and the privately reviewed runtime/sealer
grant diff require a separate owner-approved operation. Merely installing the
guards does not make an audit table owner a safe runtime identity.

## Source and runner handoff

1. Recheck current main for the next consecutive migration prefix before merge.
   Inventory the committed file with `node scripts/run-reviewed-migration.mjs
   --manifest --through 0133`; this opens no database connection. Record the
   exact file SHA-256 separately, not the historical manifest digest as its hash.
2. Resolve actual historical adoption/control-ledger evidence. Do not fabricate
   receipts or mark historical SQL executed because a synthetic fixture passed.
3. Use the existing protected exact-main reviewed runner's PLAN with the file
   and its SHA-256, pinned target and migration-writer credentials. PLAN is
   read-only and does not prove the SQL can execute against live contents.
4. Present the exact source/hash, prerequisite group operations and private
   runtime/sealer grant diff to the owner before APPLY or credential changes.
   No apply approval is implied by this source PR. Do not use `db:push`.
5. After an approved apply, switch Vercel to the new non-owner runtime login,
   drain old pools, verify actual web identity and run restricted-login checks.
   Seal only through the separately configured, validated sealer connection.
   Keep strict proof default-off until that integration passes. Do not dispatch
   another live identity capture under the already consumed one-capture approval.

The owner has deferred backup and staging work for this customer-free project;
this package creates neither and does not reinstate them as source-work gates.
Its local synthetic execution is not production acceptance or recovery proof.

## Rehearsal and rollback

The existing PostgreSQL acceptance workflow runs the actual numbered SQL on
PG16 and PG18, on both legacy and missing-foundation fixtures. Tests impersonate
restricted session identities, execute allowed appends and sealing, reject
mutation/forged chain fields, and inject companion failures. Every probe rolls
back DDL, grants, role identities and row changes. The larger acceptance suite
also uses distinct real LOGIN connections for app, worker and sealer behavior.

Before commit, the runner's rollback leaves the original row, absent foundation
and original group attributes intact. After a committed live apply, do not drop
chain evidence or restore elevated runtime privileges as a rollback. Stop the
affected jobs, keep append-only guards, and prepare a reviewed forward correction.
No post-commit destructive down migration is included.

Issue #908 remains open until live foundation and restricted-login cutover
acceptance. UI screenshots are not applicable: no app/UI files changed.
