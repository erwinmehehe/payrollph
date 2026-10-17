# Clean PostgreSQL 18 source development baseline (October 17, 2026)

## Status and isolation

**Clean empty Neon development target created, not yet bootstrapped at publication.**
Project: `calm-wave-70219564`; separate rehearsal branch:
`br-twilight-shape-b70olxgv`; **new database: `app_db`**;
PostgreSQL 18.6. Direct catalog query recorded **zero application tables,
sequences, and routines** before attempting any schema import.

The organization is Vercel-managed and blocks new project creation.
The parent Neon project is also at its branch limit. This is therefore a
**new, empty database within an existing non-default isolated branch**,
not a new project or branch. The branch also contains an older inherited
`neondb` with preexisting data; **never connect fictional tests to it**.

## Source build and tests

This PR adds `.github/workflows/clean-pg18-source-regression.yml`
running on isolated GitHub-hosted PostgreSQL 18, not on Neon. It verifies
an empty DB, uses the existing **first-only, fail-closed** PG18 guarded
Drizzle source bootstrap, adds isolated audit protections, captures a
read-only schema fingerprint, and exports the resulting source schema with
`pg_dump --schema-only --no-owner --no-privileges`. No application rows
or secrets are included in the short-retention artifact.

Four independent PG18 CI matrices also run the full test shards
`node scripts/run-sharded-tests.mjs <shard> 4`, reporting sanitized
failure labels and exit codes. The existing nine-stage connected
acceptance workflow is retriggered with an otherwise no-op comment so
that its existing PG16/PG18, governed-hire, two-employer and fictional
Hire-to-filing evidence runs on the proposed source SHA.

**This is NOT permission to execute `db:push` against any existing
Neon or production database.** PG18 second-push defect #1019 is still
unresolved; do not use `--force`, CASCADE, or weaken tenant FKs.

## Target verification and release blocks

After the synthetic schema export succeeds, a trusted operator may
import only reviewed **schema DDL** into the verified still-empty
`app_db` on the isolated Neon branch. The importer must check exact
project, branch, database name, major version, zero public table count,
source SHA-256 and no customer data. It must refuse unexpected DML,
non-empty databases or any change to `neondb`.

Only label the Neon schema bootstrapped after inspecting its actual
tables, columns, indexes, constraints, triggers and routines and
comparing the observed catalogs to the source reference. Fictional
employee tests must stay on fully disposable environments unless
Neon tenant isolation, empty organization data and safe flags are
independently verified.

Independent 14-scenario WFM/mobile UAT, real employer centavo-for-centavo
comparison, official agency import validations, historical migration
adoption, backup/restore and runtime-DDL elimination remain outstanding.
**No production, payout or government filing release is approved.**

## Integrated PG18 source + two-employer acceptance gate (2026-10-17)

The clean-PG18 workflow now **fails closed on three dependent job groups at the exact PR/main source SHA**:

1. Fresh disposable PostgreSQL 18 empty-catalog preflight, first-and-only guarded Drizzle source bootstrap, catalog fingerprint/audit controls, and **schema-only** artifact (no application rows).
2. Four independent, freshly bootstrapped PG18 full-regression shards. Every shard must succeed; one failed, skipped or cancelled shard blocks the workflow.
3. After those pass, a reusable invocation of the *existing* nine-stage connected payroll workflow restricted to **one** PG18 governed-Hire case. It starts a **third independent empty disposable PG18 database** (shards do not share mutable state), builds the actual Next.js server, executes both fictional employers' nine protected HTTP stages through four hash-bound draft filing files each, confirms tenant/role denies, synthetic 375px/390px A → B → A browser switch/retry, and validates the separate governed-Hire sidecar. The validator fails if any stage, employee/run identity, filing hash, or required denial is missing.

A final `complete-gate` requires all three preceding job groups to be **success**, rejecting even skipped/cancelled results. The reusable journey's ordinary direct triggers still run their original four PG16/18/direct/governed/year-end combinations. No provider keys, production/Neon targets, payouts or real filings are used. The integrated gate is synthetic, not an observed human acceptance; #853's 27 human observations, #691 physical WFM, #579 employer centavo reconciliation, and the database migration/production gate remain separate **NOT_RUN / NO-GO**.
