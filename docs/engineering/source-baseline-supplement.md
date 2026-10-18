# Source-first baseline supplement

**Status:** for review. Builds and rehearses a clean baseline in disposable CI only. It does not touch Neon, and it is not production approval.

## Why

The clean PG18 development bootstrap builds a database from `src/db/schema.ts` (Drizzle push) plus `drizzle/0109`. Numbered migrations also create objects that Drizzle cannot express or that `schema.ts` does not declare. A database built only from source therefore lacks them.

Scanning all 147 numbered migrations against a fresh push of main `2d3ceb5` (PG16, push + 0109) found **115 named objects missing**:

| Kind | Missing | Examples |
|---|---:|---|
| CHECK / EXCLUDE / FK constraints | 60 | `payroll_runs_no_overlapping_release` (0089), `employee_mwe_classifications_no_approved_overlap` (0093), 13 composite tenant/employer FKs (0121, 0123), 42 date/status/range checks |
| Triggers + functions | 22 | payout tenant and identity guards (0115, 0116), WFM punch tenant guards (0120), audit v2 guards (0133) |
| Indexes | 17 | `payroll_runs_org_period_idx`, employer-identity unique indexes (0123) |
| Columns | 15 | `organizations.module_navigation_mode` / `enabled_modules` (0122, read by `tenant-module-storage.ts`), `legal_entities.registered_address` (0121, read by `multi-entity-registration-storage.ts`), multi-entity `legal_entity_id` columns (0121) |
| Extensions | 1 | `btree_gist` (0089) |

A production database rebuilt from source alone would run, but without several tenant-isolation and money-safety guards. Nothing in the main CI suite would notice, because CI also builds from source.

## What this change adds

- `docs/sql/source-baseline-supplement.sql`: 98 blocks restoring 110 of the 115 objects, each copied from the migration named in its comment. Constraints declared inside a historical `CREATE TABLE` are restated as `ALTER TABLE ... ADD CONSTRAINT`, since the table already exists. Schema only: no row changes, no drops.
- `scripts/lib/migration-only-objects.mjs`: the scanner. It lists objects created by numbered migrations, skips any that a later migration drops or renames, and reports which are absent from a connected catalog.
- `scripts/qa/apply-source-baseline-supplement.mjs`: applies the supplement in one transaction to the empty disposable CI database (after 0109), then fails if any migration-created object is missing apart from the documented exclusions. It also fails if an excluded object becomes present, so the list cannot go stale.
- `clean-pg18-source-regression.yml`: the schema-export job and all four regression shards now build push + 0109 + supplement. The exported schema artifact (used for the Neon development bootstrap) therefore includes the supplement, and the full regression suite runs against it. `drizzle/**` is added to the triggers, so a new migration that creates an object the baseline lacks fails this workflow until the supplement is updated.

## Corrections and exclusions (owner decisions)

1. **`drizzle/0093` cannot execute as written.** It opens `DO $$` and closes with `END $;`, so PostgreSQL reports an unterminated dollar-quoted string. Any database that applied it as SQL failed, or never received the MWE overlap constraint. The historical file stays unchanged (it is immutable). The supplement block uses `END $$;`. **Decision:** confirm the constraint is intended, and check whether any real database is missing it.
2. **`drizzle/0133` v2 audit guards are excluded.** 0133 is pinned to one Neon branch and assumes 0109 is absent, so it cannot run on a clean baseline. Its v2 functions add an insert guard and truncate rejection beyond 0109's mutation guard. **Decision:** should the clean baseline include the v2 guards? If yes, a reviewed, unpinned block is added and the exclusion removed.
3. **Multi-entity columns and FKs (0121, 0123)** are included because the code reads some of them and the FKs enforce tenant/employer consistency, but `schema.ts` does not declare them. **Decision:** confirm they are intended, and whether `schema.ts` should declare them instead of the supplement.

## Verification

- On a fresh push + 0109, the supplement applies in one transaction. The scanner then reports only the five excluded 0133 objects missing (from 115 before).
- The full local regression suite against push + 0109 + supplement (PG16): see the PR description.

## Limits

- The scanner matches names, not definitions. A same-named object with a different definition would not be flagged.
- Objects created through `EXECUTE` or `format()` strings are not seen. Only the first `ADD COLUMN` of a multi-column `ALTER TABLE` is listed, although the supplement applies the whole statement.
- This prepares the baseline for the Path A recovery (a fresh database built from source, then the reviewed migration runner for every later change). Creating the Neon database, the cutover row, roles and the protected environment stay with the DBA.
