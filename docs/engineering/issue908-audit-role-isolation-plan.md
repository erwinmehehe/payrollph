# Issue #908: audit-role boundary and forward-repair plan

## Current evidence and scope

On 2026-10-16, a transaction explicitly set READ ONLY and checked the pinned
original project/branch/endpoint/database before querying catalogs. Audit events
exist; chain heads, the expected protection/sealer functions and protection
trigger are absent. Five LOGIN roles were visible; four have elevated attributes
and four have effective audit mutation privileges. These are catalog-wide counts,
not verified app/worker credential mappings. No business rows were selected.
Role identities remain private. No grants, credentials, schema or branches changed.

Vercel's unfiltered environment response was truncated. It cannot establish the
complete Production assignments or actual app/worker/sealer connection mappings.
An apparent absence in that response is not evidence a variable is absent.

## Source implementation

The existing eleven-field readiness check remains the default. A registered,
default-off `AUDIT_ROLE_ISOLATION_PROOF_ENABLED` selects stricter catalog proof:
column grants, PUBLIC/inherited effective permissions, ownership, exact trigger
function/type, runtime role switching, schema creation, replication-role SET and
reachable SECURITY DEFINER paths cannot silently pass. Errors and partial/truthy
responses fail closed. The switch does not approve a release or replace live
adversarial tests. Readiness stays false on the currently missing foundation.

The review-only SQL candidate supplies forward trigger replacements, rather than
editing historical 0109: ordinary inserts cannot prefill chain evidence; ordinary
runtime/worker credentials cannot invoke maintenance/sealing bypass through GUCs;
sealers only fill previously unsealed rows without changing business fields;
ordinary organization deletion cannot silently cascade-delete audit history.
TRUNCATE is refused. No production SQL is executed by the source tests.

## Role contract

| Credential | Required permissions | Prohibited authority |
| --- | --- | --- |
| App / payroll worker / ordinary scheduler | Required application DML; audit append and application-scoped reads; sequence USAGE as needed | Audit UPDATE/DELETE/TRUNCATE, audit-head writes, protected-object ownership, DDL, elevated attributes, privileged memberships, replication-role SET |
| Dedicated audit sealer | Separate credential; membership of the non-login sealing group; approved role switch; audit SELECT and chain-column UPDATE; head SELECT/INSERT/UPDATE; sealer EXECUTE | Business-field UPDATE, direct DELETE/TRUNCATE, maintenance membership, ownership/DDL |
| Retention/maintenance operator | Separately controlled non-login maintenance group plus explicit transaction-local hint and change receipt | Permanent app/worker inheritance; TRUNCATE; unrecorded retention/deletion |
| DBA / migration writer | Protected canonical runner; actual reviewed plan/checksum and recovery evidence | Runtime reuse; historical SQL rewriting or inferred adoption receipts |

Grant lists must preserve application-specific data access and tenant controls;
never issue blanket REVOKE across production application tables. The current
sealer remains invoker-rights. With the new flag ON, the shared scheduler/verifier
sealing function uses only `AUDIT_SEALER_DATABASE_URL`, never the app credential
as a fallback. The dedicated URL must target the same hostname, port and database
as `DATABASE_URL`, with a different login and verified production TLS. Pooled/direct
aliases must be aligned explicitly before activation. Startup-option overrides
are rejected. The dispatcher proves the real login and restricted sealing group,
uses `SET LOCAL ROLE` inside a transaction, rolls back failures, closes the connection
and emits a sanitized error. Flag OFF keeps the original Drizzle query and does not
require or open a dedicated connection. Tests execute this dispatcher with actual
restricted logins; synthetic success still does not map real deployment credentials.
Do not flip credentials while deployed integration is unverified. New credentials
must be independently generated and provisioned through protected secret tools.

## Execution order and rollback

1. Privately bind actual deployed app, worker, scheduler, sealer and writer
   credentials to backend identities, including pooled/direct aliases and
   active deployment SHAs. Verify the complete Production secret scope.
2. Resolve genuine migration adoption/history and 0127 disposition, #899 impact,
   and accepted #907 backup/restore. Source hashes are not execution receipts.
3. Prepare a uniquely numbered **forward** foundation repair for missing 0109
   objects under the canonical runner, with approved source hashes and exact
   prerequisites. Do not replay historical 0109 or use production db:push.
4. Rehearse the exact foundation and trigger/role changes using production-like
   restricted logins on a protected disposable target. Verify append, sealing,
   maintenance, spoofed hints, row/hash preservation, tenant access and rollback.
5. Review a concrete role-specific production grant diff. Owner/operator approval
   is required before live revokes, credential switching, or protected APPLY;
   these can interrupt active application connections. Source approval alone
   is not that approval. No additional source reviewer is required by this plan.
6. Provision fresh restricted credentials, verify them before switching, drain
   and reconnect pools, then retest actual logins. Keep old owner credentials
   out of runtime; retire or demote them only after dependency review.
7. Capture sanitized role predicates, applied source receipt, deployment SHA and
   negative-test outcomes privately. Activate the stricter readiness flag only
   after acceptance. Money movement and employer pilot gates remain separate.

Before commit, a failed apply rolls back atomically. A failed credential cutover
uses the privately reviewed previous connection configuration and pauses affected
jobs; it must not grant elevated runtime permissions as a shortcut. A data or
schema recovery uses the separately accepted restore procedure. Do not remove
the legacy blocker or report synthetic success as production acceptance.

## Completion boundary

Source tests may pass while #908 remains operationally OPEN. Closing requires the
actual deployed role mappings, effective privilege proof, accepted forward repair,
dedicated sealing integration and controlled production acceptance above. No live
privilege mutation or Production/Preview configuration change is performed here.
