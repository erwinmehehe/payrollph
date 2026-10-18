# #908: captured web-role findings and restricted-login cutover

Status: source regression and private review plan; no live permission changes.

## What is now known

PR #1201 merged at `3da487c69f9f85d4040f14063893685a2e9dea17`.
The owner approved one encrypted read-only diagnostic, completed by Actions run
`39085820549` against that exact READY production commit. Its artifact digest
was verified and the identity was decrypted only inside the owner's private
WSL directory. No role names, fingerprints, credentials or connection strings
are included in this document or public artifacts. No further runtime capture
is authorized by that one-off approval.

A subsequent pinned catalog-only inspection privately matched that captured
effective role. It is login-capable, has elevated attributes, owns the audit
table and other database objects, can CREATE in the database/public schema,
and has effective UPDATE, DELETE, TRUNCATE and TRIGGER privileges on audit
events. Chain-head storage and the mutation-protection trigger remain absent.
The role has no observed session-replication-role SET privilege or executable
user SECURITY DEFINER functions. Those two negative findings do not offset
ownership or the positive mutation/DDL findings.

This binds catalog findings to the observed web **current_user**. It does not
establish session_user, actual worker/scheduler/sealer/DBA credentials, the
privilege state at an earlier time, or evidence that anyone exploited it.
No payroll, employee, authentication or audit business rows were queried.

## Why an ACL-only change is insufficient

Ownership lets a login restore its own table grants and disable table triggers.
Removing explicit UPDATE/DELETE/TRUNCATE grants from the current owner does
not remove those ownership powers. Applying triggers alone also leaves the
owner able to disable them. Do not demote/revoke the currently deployed owner
in place before identifying every process using it: that can break runtime
writes, migrations or scheduled work without producing a safe replacement.

The executed synthetic acceptance now creates a fictional non-superuser LOGIN
with CREATEDB/CREATEROLE and audit-table ownership. After explicit mutation
revocation, that login restores its grant, disables the protection trigger and
changes a fictional row inside a rollback-only transaction. The original actor
and enabled trigger are verified after rollback. The strict proof rejects the
owner. The existing tests then verify real restricted app/worker logins, append,
spoofed maintenance/sealing hints, DDL/role denial, trusted sealing and rollback.

Local PostgreSQL 16 results: legacy foundation **66 passed, 0 failed, 0 skipped**;
forward candidate **76 passed, 0 failed, 0 skipped**. Each used a newly initialized
loopback-only SCRAM fixture and real separate logins. These are synthetic
engineering results, not live adversarial tests or a production clone receipt.
The existing CI matrix also covers PG16/PG18 and both foundations.

## Concrete private review inputs

The private WSL evidence directory now contains the captured identity, full
role/membership/object-ownership catalog review, and an explicit proposed
runtime grant manifest. Files are user-only and remain outside the repository.
The manifest is review-only, has no SQL execution path and is marked not ready
to apply. It enumerates observed application tables and their owned sequences;
there is no GRANT ON ALL TABLES, global default grant or future-object auto-grant.
The proposed application DML list still needs operation-by-operation review.
It is not a claim that every enumerated permission is necessary.

The proposed boundary is:

- Create a **new**, initially NOLOGIN role with NOINHERIT, NOSUPERUSER,
  NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOBYPASSRLS. Bind the actual
  approved login and fresh secret through protected tools, never a PR or SQL
  password literal. Give it no membership in the owner, sealing or maintenance
  roles and no object ownership.
- Grant CONNECT and public-schema USAGE. Grant only approved explicit business
  table DML and required sequence USAGE. Do not grant CREATE, TRUNCATE, TRIGGER,
  REFERENCES, MAINTAIN or SECURITY DEFINER execution. Do not change unrelated
  app tables' ACLs or broaden PUBLIC permissions.
- Audit access is SELECT plus INSERT limited to ordinary event columns:
  organization_id, actor, action, resource, metadata and created_at. Grant no
  audit mutation, prefilled chain columns, audit-head mutation or sealer call.
- Preserve the existing owner for protected DBA/migration work until all
  dependencies are inventoried. The cutover changes the runtime credential;
  it does not try to turn an owner credential into a safe runtime login.
- Keep a separate restricted sealer login and the existing reviewed non-login
  sealing-group contract. It alone gets the approved chain-column/head writes
  and invoker-rights sealing call; it receives no ordinary business writes or
  maintenance membership.

## Required execution order

1. Privately bind remaining worker, scheduler, sealer and canonical-writer
   credentials, including whether processes are absent or share a deployed
   runtime. Do not infer their identities from this web current_user capture.
2. Review the exact business-table/function/sequence list against app operations.
   Preserve existing tenant isolation and maker-checker behavior. A new role
   must not silently gain future tables through default privileges.
3. Promote the existing missing-foundation and forward-trigger candidates as
   one reviewed, uniquely numbered canonical transaction. Historical 0109 is
   unchanged; no db:push, guessed adoption receipt or ad hoc live replay.
4. Rehearse that exact compound change with the proposed role contract and
   application operations. Verify original row/hash preservation, denial of
   direct mutation/owner escalation, trusted sealing and rollback.
5. Present the exact target, source/checksum, login/grant diff and process
   switch/rollback order for owner/operator approval. This source PR and the
   previous single diagnostic approval do not authorize live DDL, grants,
   password provisioning, credential switching or feature activation.
6. After authorization, provision and verify replacement credentials before
   switching the app and approved jobs. Drain/reconnect pools and test the
   actual logins. Keep money/filing activation separate. A failed cutover
   pauses affected jobs and restores the reviewed previous configuration;
   do not grant the new runtime ownership as a shortcut.

No backup service, staging environment, new cloud branch, paid resource or
storage destination was created or required by this source-only work.

## Local acceptance isolation

The real-login test still refuses non-Windows local mode, unknown acceptance
modes, unmarked/nonempty databases and wrong server data directories. For a
fresh fixture it accepts an explicit `ISSUE908_LOCAL_FIXTURE_DIR` only at
`outputs/issue908-<label>/data`, refuses a symlinked canonical path, and accepts
`ISSUE908_LOCAL_PORT` only in 54000–54999 on 127.0.0.1. The connected server's
data_directory must match that directory exactly. CI keeps its fixed disposable
127.0.0.1:5432 database. These options do not permit a cloud connection or change
production behavior.

## NOT done

Production role/credential cutover, missing audit foundation, actual-login live
denial tests, remaining process identity mapping and #908 closure. No runtime
flags, app UI, payroll math, migrations or live privileges changed. Desktop and
390px UI screenshots are not applicable. Source merge is not operational closure.
