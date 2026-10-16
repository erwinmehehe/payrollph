# Independent PG16 schema comparison (Atlas) and SQL lint (Squawk)

**Status: engineering synthetic-only review, production NO-GO.** This is not a
DBA release packet, a real production-shaped clone, an historical migration
receipt, a security approval, or evidence that a Neon backup can be restored.

## What the two independent tools do

- **Atlas v1.3.0** runs only `atlas schema diff` on two PostgreSQL 16
  databases inside one ephemeral GitHub Actions service. Atlas and the #1031
  catalog query use a dedicated `atlas_auditor` account with no payroll-row
  SELECT, no table write or elevated privileges, and read-only transaction
  defaults; the synthetic migration is executed by the separate fixture
  writer before this role is used. `app_db` is created
  from one guarded `drizzle-kit push`; `atlas_candidate_db` is copied using
  `CREATE DATABASE ... TEMPLATE app_db`, then a synthetic missing-table
  baseline receives the exact source files 0115 through 0126, in order.
- **Squawk 2.65.0** statically lints the exact 0124, 0125, and 0126 migration
  source files using PostgreSQL 16 rules and the protected runner's
  single-transaction semantics. No parser rules are disabled and there is
  no automatic remediation.
- No Atlas or Squawk `apply`, `push`, `migrate set`, journal adoption,
  provider connection, production credential or Neon branch is used. Every
  connection string is hardcoded to the *GitHub Actions host's loopback*
  PostgreSQL 16 test service. PostgreSQL's `inet_server_addr()` inside a
  Docker service is normally a bridge address, not `127.0.0.1`; identity
  is therefore proven using the literal client URL, exact database name,
  PostgreSQL major version and restricted current role rather than by
  incorrectly asserting a Docker server-interface address.

## Synthetic baseline construction

The missing table list mirrors the prior #1121 rehearsal, including all
ten #1015/#1054/#1061 recovery tables and the historical 0115-0123 foundation
targets. The recreation executes exact SQL source, with the hardened #1054
preflight/postflight from the stacked #1120 candidate.

This is an **approximation**, not a restored or authenticated production
catalog. The fixture starts with the entire current Drizzle shape, then uses
`DROP TABLE ... CASCADE` in the disposable copy to imitate missing objects.
Collateral FK drops can produce Atlas diffs unrelated to an actual live
migration. Such differences remain visible and are not silently normalized.

The candidate SQL is committed **only inside the throwaway PG16 service**
because Atlas requires a separate session to inspect both states. No tenant,
worker, payroll, bank or provider records are seeded, and the service
disappears with the CI job.

## Evidence and interpretation

Artifacts (14-day retention): `independent-pg16-squawk` and
`independent-pg16-atlas-schema-diff`, including exact migration source
SHA-256s and the version of Atlas. A companion **read-only** #1031 report
runs against BOTH `app_db` (fresh source push) and `atlas_candidate_db`
(exact source replay), recording every MISSING/DRIFT/EXTRA. The latter is
the same database Atlas reads, so both comparisons can be triaged at the
same commit instead of inferring agreement between unrelated CI runs. Exact
migration SHA-256s and PR head SHA/Actions merge SHA are recorded separately,
not mistaken for receipt evidence.

The Squawk step records its actual exit code and full JSON warning/error list
before independently classifying *every* finding as blocking. A malformed,
truncated or unrecognized report also blocks. Atlas is invoked with
`--format '{{ sql . "" }}'` to emit SQL-only difference output; an empty plan
or the exact documented no-change notice is a PASS. All other output is
`DRIFT` and blocks pending review. Pure Node regression tests prove that
real generated DDL and Squawk warnings cannot be turned into PASS by these
classifiers. Tool failures are never hidden by `continue-on-error`.

Before interpreting Atlas diff output, a separate `atlas schema inspect`
invocation under that same restricted role emits JSON for BOTH fixtures. The
source-generated #1031 manifest is checked against each Atlas-visible
`public.tables` inventory: a zero-table or partial-visibility inspection
fails closed instead of being misreported as schema parity. This is a critical
guard because catalog-only roles can be more limited than database owners.

The jobs fail closed on tool/runtime errors and on structural/lint findings;
a red CI result requires reviewer triage.
A green result would mean only that the inspected **synthetic** resources
match under these specific tools and PG16 setup.

Atlas Community schema diff covers schema/tables/indexes/constraints by
default; it does **not** independently prove application data, migration
journals, trigger/function parity, tenant security or payroll centavos.
The separate #1031 full catalog comparator is still a mandatory, independent
report. Where Atlas and #1031 disagree, record both reports with exact SHAs,
inspect false-positive deparsing/name differences, and resolve the physical
catalog discrepancy without lowering the checks.

## Remaining synthetic parity limitations

Atlas Community deliberately does not compare stored functions, triggers,
sequences, views, or other Atlas Pro-only resources. Its empty plan alone is
not full parity. Both read-only #1031 reports cover source-modeled objects;
#1121 separately fingerprints functions/triggers and tests migration behavior.
The synthetic `DROP ... CASCADE` may also remove external FK constraints:
report such deltas truthfully, distinguish them from actual numbered SQL
effects, and do not bypass or exclude a drift class just to make CI green.
An intentional structural difference still leaves the validation gate red
until reviewed; a linter warning is not automatically a deployment blocker
dispositioned by an AI assistant.

## Release gates not covered here

Historical path+SHA receipts and DBA baseline (#744/#910); full live catalog
comparison (#1031); the unresolved restore routing incident (#899);
operator-witnessed encrypted backup and offline restore (#907); strict
production DB identity verification; qualified DBA/security approval;
tenant-denial/role tests; money-path acceptance and post-migration smoke.
The #1120 source migration history guard must also be adjudicated, never
bypassed because a synthetic test or third-party linter is green.

**DO NOT MERGE into a production migration workflow or dispatch against Neon.**
The workflow has only a PR trigger and `contents: read` permission.
