# Independent PG16 schema comparison (Atlas) and SQL lint (Squawk)

**Status: engineering synthetic-only review, production NO-GO.** This is not a
DBA release packet, a real production-shaped clone, an historical migration
receipt, a security approval, or evidence that a Neon backup can be restored.

## What the two independent tools do

- **Atlas v1.3.0** runs only `atlas schema diff` on two PostgreSQL 16
  databases inside one ephemeral GitHub Actions service. `app_db` is created
  from one guarded `drizzle-kit push`; `atlas_candidate_db` is copied using
  `CREATE DATABASE ... TEMPLATE app_db`, then a synthetic missing-table
  baseline receives the exact source files 0115 through 0126, in order.
- **Squawk 2.65.0** statically lints the exact 0124, 0125, and 0126 migration
  source files using PostgreSQL 16 rules and the protected runner's
  single-transaction semantics. No parser rules are disabled and there is
  no automatic remediation.
- No Atlas or Squawk `apply`, `push`, `migrate set`, journal adoption,
  provider connection, production credential or Neon branch is used.

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
SHA-256s and the version of Atlas. The jobs fail closed on tool/runtime errors
and on structural/lint findings; a red CI result requires reviewer triage.
A green result would mean only that the inspected **synthetic** resources
match under these specific tools and PG16 setup.

Atlas Community schema diff covers schema/tables/indexes/constraints by
default; it does **not** independently prove application data, migration
journals, trigger/function parity, tenant security or payroll centavos.
The separate #1031 full catalog comparator is still a mandatory, independent
report. Where Atlas and #1031 disagree, record both reports with exact SHAs,
inspect false-positive deparsing/name differences, and resolve the physical
catalog discrepancy without lowering the checks.

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
