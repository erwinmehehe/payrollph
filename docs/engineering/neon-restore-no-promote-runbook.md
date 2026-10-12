# Neon restore rehearsal: never promote or repoint production

**Status:** Prevention-only source change; no Neon snapshot is restored by
this repository. Incidental production-branch swaps are a P0 event.

## Why this exists

On October 12, 2026, a snapshot-restore rehearsal unexpectedly used Neon's
default `finalize: true` while requesting a new branch. Neon switched the
project's default branch and original production endpoint to the restored
snapshot for approximately 05:30–05:32 UTC. The operator restored the
original branch/endpoint/default and verified the original schema and
aggregate counts. The incident is tracked in issue #899.

**Do not infer that zero application writes were affected.** Existing
request logs and aggregate observations do not establish that. All future
restoration exercises must be blocked from moving any production identity.

## Safe restore request: preparation only

Use `planIsolatedNeonRestore` from
`scripts/lib/neon-isolated-restore-safety.mjs`. The helper validates
nonsecret metadata from independent read-only sources:

1. `get_default_branch` — exact production **ID**, `name: main`,
   and `default: true` (do not trust a matching name alone).
2. `get_postgres_endpoint` — the expected original endpoint ID,
   host and `branch_id`; never print database URLs or credentials.
3. `list_snapshots` — source branch ID and specific snapshot ID.
4. A unique name prefixed `payrollph-restore-rehearsal-`, never main
   or production.

It returns a request equivalent to:

```json
{
  "project_id": "<verified-project-id>",
  "snapshot_id": "<verified-snapshot-id>",
  "name": "payrollph-restore-rehearsal-20261012-isolated",
  "finalize": false
}
```

The request contains **no `target_branch_id`**. It must create a
nondefault destination; it must not restore into an existing branch.

**The helper never calls the API.** It is a local preflight and cannot
enforce safety if an operator manually bypasses it. A separate authorized
operator must supply the exact validated request to Neon, after
confirming snapshot/branch capacity and a protected change window.
Do not use the snapshot restore tool on `main` during a routine QA
test. Neon's snapshot creation returned `HTTP 422 snapshots limit
exceeded` during the incident work; capacity is unresolved.

## Mandatory independent postflight

Immediately after any non-promoting restoration, separately call:
`get_default_branch`, `get_postgres_endpoint` and `get_branch`.
Pass those raw metadata objects to `verifyIsolatedNeonRestore`.

The verifier fails closed unless:

- The restored branch has a **new distinct branch ID**, matching the
  requested name and snapshot ID, and is NOT primary/default.
- The project default remains the original exact branch ID `main`.
- The original production endpoint ID and host still point at that
  exact original branch ID.
- The planned request explicitly says `finalize:false` and never
  supplies `target_branch_id`.

On any mismatch, **stop**, initiate the production incident procedure,
and restore endpoint/default identity only through a controlled,
logged change. Do not retry a snapshot restoration blindly.

Passing this metadata check only establishes endpoint isolation. It
does not prove restored row integrity, successful application startup,
bank confidentiality, acceptable RPO/RTO, or production release
authorization. Maintain a separate operator-approved backup/restore
acceptance with evidence of actual recovered business records.

## Unresolved P0 tasks

- Investigate issue #899's ~05:30–05:32 UTC production routing window
  for request-level errors and writes made to the restored snapshot.
- Reconcile source SHA-256/Drizzle historic application, missing
  receipt journal and runtime schema compatibility DDL.
- Confirm snapshot retention/capacity and a tested return-to-normal
  procedure that does not require modifying Neon production.
- Do not apply the proposed 0115–0121 migrations to main, or enable
  transfers, based on this preflight or a synthetic CI pass.

CI is source-only: `node --test
tests/neon-isolated-restore-safety.test.mjs` with no Neon credentials.
