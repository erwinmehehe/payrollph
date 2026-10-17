# Issue 908: production repair packet, 2026-10-17

Status: REVIEW ONLY / LIVE APPLY BLOCKED. Owner requested completion and zero
new spend. No production SQL, credential, role, grant, storage, branch, endpoint,
deployment or flag was changed. Source merge is not production authorization.

## Fresh observations

The existing production alias reports READY at source SHA
`43d48a85863baa5672552cdb7824062974b93e08` (merged #1149). This proves the
reported deployment source, not the runtime database credential or target.

A separate transaction used READ ONLY, bounded timeout and exact server-side
project/branch/endpoint/database identity checks before catalog reads. It found:

- Audit events exist with all ten expected columns, including nullable bigint
  chain sequence and nullable varchar(64) hashes without defaults.
- Actor/action/resource widths are 120/160/160; metadata is non-null JSONB and
  created_at is non-null timestamptz. Only the audit primary-key index is present.
- Chain-head storage, legacy/v2 protection functions and sealer remain absent.
- Five LOGIN roles are visible; four are elevated. Actual identities and
  memberships remain private and are not deployed-role assignments.
- No catalog relations matching the four expected migration-ledger names were
  observed. This is not proof that no historical SQL ran; do not invent receipts.

No application, employee, payroll or audit rows were read from the live database.
Vercel returned truncated encrypted environment metadata (86 visible entries).
Absence from that prefix cannot establish absence of a Production variable.
No authenticated local Vercel CLI configuration was found. Production Secrets
are not readable credentials; do not bypass secrecy or substitute an owner URL.

The existing authenticated `/api/readiness/database-target` endpoint can report
the actual runtime session identity using a privately supplied readiness token.
Do not call the general readiness/RBAC workflow as a substitute: its broader
operations are not this catalog-only probe. Never publish identity responses,
role names, endpoint details, database URLs or tokens in GitHub artifacts.

## Prepared forward foundation

`docs/sql/issue908-missing-foundation-REVIEW_ONLY.sql` matches the observed
catalog shape. It refuses an unreplaced isolated target marker, production or
active QA, partial existing foundation, wrong columns/nullability/defaults and
any existing non-null chain evidence. It uses a bounded lock wait and holds the
audit table against concurrent writes for the migration transaction.

It creates the missing table/index/hash/sealer foundation without modifying
historical 0109. Functions use qualified relations and pinned search paths;
the interim mutation guard fails closed even for caller-set maintenance hints.
PUBLIC cannot execute the new invoker-rights sealer. No existing row is sealed,
rewritten, deleted, reattributed or asserted historically trustworthy.

The foundation and `issue908-audit-trigger-boundary-REVIEW_ONLY.sql` must be
promoted together into ONE uniquely reserved numbered forward change and ONE
canonical-runner transaction after the external evidence is accepted. They are
not independently deployable operational fixes. Trusted role provisioning and
the actual grant diff remain separate reviewed inputs; no guessed login names.
Never register a receipt, adopt a baseline, enable ordered migrations, or replay
0109 merely because these candidates pass synthetic tests.

Acceptance covers PG16/18 on both the immutable legacy foundation and the new
forward candidate. It runs real restricted logins, Drizzle appends, sealing,
grant/trigger drift, role/hint abuse, failed-seal rollback, atomic compound
repair rollback, original-row preservation and raw-marker refusals. These are
fictional empty-fixture tests, not a production-equivalent clone attestation.

## Zero-spend recovery decision

The owner confirms no separate backup storage is configured and wants free.
The prior no-new-AWS/no-recurring-cloud-spend decision remains in force.
Do not provision S3/KMS, purchase a plan, delete retained snapshots to make room,
or export unclassified production data to a random free service.

Free software can stream a PG18 custom-format dump through age encryption on
an approved trusted host. A local copy on the same machine is an interim copy,
not independent recovery. Accepted recovery still requires an approved existing
separate device/private destination, recoverable private key held separately,
data-export classification, least-privilege backup reader, actual encrypted
archive/hash receipt and a detached offline restore. No such destination or
role-mapping evidence was supplied in this review. The fictional-development
helper must not be repointed at unclassified live data to skip its restrictions.

## Exact remaining inputs and cutover sequence

1. Obtain private runtime database-target evidence and bind deployed app,
   scheduler, worker, sealer and migration-writer credentials to actual roles,
   active deployment SHAs and approved target. Mark absent processes explicitly;
   do not guess that all processes share the web connection.
2. Accept the original incident/write-impact disposition, genuine history/adoption
   and independent recovery proof (#899/#907). Source fixtures are not receipts.
3. Prepare a role-specific grant and credential dependency diff from those
   bindings. Runtime must not own schema/audit objects or acquire maintenance;
   sealer gets only approved chain columns/head writes through its own login.
   Do not broadly revoke unrelated application table access.
4. Reserve the next available prefix at that time, promote the compound forward
   change, bind exact source/checksum and actual approved target, and rehearse
   canonical-runner PLAN/APPLY/rollback on an isolated production-equivalent
   target. Require preserved row evidence and accepted lock/runtime duration.
5. Present the concrete cutover and recovery references for owner/operator
   approval. Only then execute the protected exact-main runner, provision and
   switch the reviewed credentials, drain pools and test the actual logins.
6. Capture private receipts and sanitized PASS/FAIL. Enable strict proof only
   after the actual sealer integration/role checks pass. Payroll/bank/filing
   activation remains separate. A failed cutover pauses jobs and uses the
   accepted recovery plan, not elevated runtime permissions.

No additional human source-review requirement is imposed by this packet. The
missing items are actual operational evidence and configuration, not a request
to repeat source approval. Issue #908 remains OPEN until operational acceptance.
