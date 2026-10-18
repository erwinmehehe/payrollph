# PayrollPH — actual Neon clean PostgreSQL 18 development bootstrap

**Date:** October 17, 2026 (UTC)  
**Scope:** isolated development schema, NOT production migrations or payroll release.

## Target and provenance

| Item | Recorded evidence |
|---|---|
| Neon project | calm-wave-70219564 |
| Branch ID | br-twilight-shape-b70olxgv (non-default rehearsal branch) |
| Database | app_db (separate from inherited neondb) |
| Owner | neondb_owner |
| PostgreSQL | 18.6, server_version_num=180006 |
| Preflight | 0 public tables, 0 public functions, 0 public sequences |
| Source Git commit | 0c7295b716476e2493407b5c5549c29b02fdd9b2 |
| Source schema.ts Git blob | 8b14e2e20f6d2098254d9e40727c3eda973f464c |
| Verified CI | [Clean source PG18 export and regressions](https://github.com/erwinmehehe/payrollph/actions/runs/39033078844) |
| Schema-only artifact | clean-pg18-source-schema-only; ID 12101651162 |
| Raw artifact bytes | 942,611 |
| Raw artifact SHA256 | f7c0a0ce0804c4f1395b11c1c8510f4d4c10286885ebbdc440d7f9645f80a774 |

The downloaded ZIP was SHA256 verified independently. Reconstructing the SQL from the successful GitHub Actions logs produced the same 942,611 bytes and exact SHA256. The source schema Git blob on main matched the tested source blob at preflight. The SQL had no top-level data INSERT, UPDATE, DELETE, DROP, TRUNCATE, COPY, GRANT or REVOKE commands.

## What was actually executed

The pg_dump contained 2,850 SQL statements and two psql-only restrict directives. The import removed eleven session SET statements, one session search-path SELECT, a redundant CREATE SCHEMA public (already provisioned by Neon) and an unnecessary COMMENT ON SCHEMA public. No application-table DDL was omitted.

The remaining 2,836 source DDL statements were applied in 15 transactions (200 maximum per batch), each with exact target, source checksum, role, version, progress and receipt guards. The source-defined public tables, serial sequences, primary and unique indexes, foreign keys, check constraints, audit functions and trigger were all created. No numbered historical migration SQL was replayed.

A separate qa_bootstrap_evidence.events ledger now contains 17 records: one bootstrap_started, 15 contiguous batch_completed receipts covering statement indices 0 through 2835, and one bootstrap_completed recorded after postflight. Every event contains the source SHA, artifact SHA256 and source run ID. The ledger has a trigger rejecting ordinary UPDATE/DELETE. The owner can alter that trigger; this is an operator QA audit trail, not an independent or cryptographically tamperproof receipt system.

IMPORTANT: These records attest only the actual development source-first bootstrap. They do NOT claim that the older numbered drizzle migration files ran. The historical Drizzle migration table was not fabricated or backfilled, and the protected production full-path/exact-byte migration receipt process is unchanged.

## Verified postflight and exact object-name comparison

| Public object | Artifact expected | Neon app_db actual |
|---|---:|---:|
| Tables | 280 | 280 |
| Sequences | 269 | 269 |
| Indexes, including PK/UNIQUE | 825 | 825 |
| Foreign keys | 920 | 920 |
| CHECK constraints | 181 | 181 |
| Functions | 3 | 3 |
| User triggers | 1 | 1 |
| Invalid indexes or unvalidated constraints | 0 | 0 |

Object names were also independently compared in all seven categories against the checksum-verified export. Each category had zero missing and zero unexpected names. All 920 foreign keys were validated; all 825 indexes were ready and valid. The audit mutation trigger was enabled. The organizations, employees, payroll_runs and audit_events tables all contained zero rows.

No changes were made to the original recovered database (148 tables) or default database as part of this source bootstrap. The isolated branch also contains its distinct inherited neondb with an older schema. Neither it nor live production may be used as the target of the new app_db bootstrap.

## Repeatable operator inspection

[Read-only inspection SQL](../sql/qa-neon-pg18-app-db-bootstrap-inspection.sql) checks the exact target, structural counts, ledger coverage, source fingerprint, audit triggers and zero sample employer rows. The query was executed on the real isolated target and returned dev_source_bootstrap_structural_pass=true, with production_release_approved=false.

**Do not repeat db:push on the now-populated app_db.** Further DDL needs reviewed, forward-only migrations with authentic per-file receipts and rollback evidence. Do not treat catalog presence as proof that any historical migration was executed or approved.

## Open acceptance gates — production NO-GO

The four PG18 full regression shards and fictional two-employer hire-to-filing flow passed in DISPOSABLE CI, not against an authenticated deployed app connected to this Neon app_db. Runtime database identity, tenant access controls, recovery/backup, historically reconciled file-by-file migrations, runtime-DDL retirement and protected release procedures are still outstanding.

Independent real-device 14-scenario WFM acceptance, human two-employer switching checks, read-only employee-level payroll centavo comparison (zero unexplained differences over PHP 0.01), government-file import validation, provider isolation and authorized finance/security signoff remain required. The source has no public RLS policies; tenant access must not be inferred from the schema import alone.

**Decision:** Isolated development SOURCE SCHEMA BOOTSTRAP PASS. Production migration, live payroll, payouts and government filing remain BLOCKED.
