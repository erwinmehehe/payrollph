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

## Decisions (made 2026-10-18; the owner delegated them)

1. **Keep the 0093 MWE overlap constraint, corrected.** `drizzle/0093` opens `DO $$` and closes with `END $;`, so PostgreSQL reports an unterminated dollar-quoted string. Any database that applied it as SQL failed, or never received the constraint. The historical file stays unchanged (it is immutable). The supplement block uses `END $$;`. The constraint is intended governance: no employee may have two approved MWE classifications with overlapping dates.
2. **Defer the 0133 v2 audit guards to the restricted-role cutover.** 0133 is pinned to one Neon branch and assumes 0109 is absent, so it cannot run on a clean baseline as written. More importantly, `audit_events_protect_v2` lets chain fields be filled only when `session_user` is a member of `payrollph_audit_sealing`. The default sealer (`auditRoleIsolationProof` off) runs `seal_audit_events` as the ordinary app login, so adding v2 without the roles and the dedicated `AUDIT_SEALER_DATABASE_URL` login would make audit sealing fail, including in CI. Add v2 in the same reviewed step that creates `payrollph_audit_sealing` / `payrollph_audit_maintenance`, provisions the sealer login and turns on `auditRoleIsolationProof`. The applier keeps these five objects in `EXCLUDED`, and fails once they become present so the list is updated then.
3. **Keep the 0121/0123 multi-entity columns and FKs in the supplement, not `schema.ts`.** The code reads some columns through side schemas (`tenant-module-storage.ts`, `multi-entity-registration-storage.ts`), and the composite FKs enforce tenant/employer consistency. Declaring them in `schema.ts` would change what every push creates for a feature that is still behind flags. Revisit when multi-entity leaves its pilot.

## Verification

- On a fresh push + 0109, the supplement applies in one transaction. The scanner then reports only the five excluded 0133 objects missing (from 115 before).
- The full local regression suite against push + 0109 + supplement (PG16): see the PR description.

## Limits

- The scanner matches names, not definitions. A same-named object with a different definition would not be flagged.
- Objects created through `EXECUTE` or `format()` strings are not seen. Only the first `ADD COLUMN` of a multi-column `ALTER TABLE` is listed, although the supplement applies the whole statement.
- This prepares the baseline for the Path A recovery (a fresh database built from source, then the reviewed migration runner for every later change). Creating the Neon database, the cutover row, roles and the protected environment stay with the DBA.

## Cutover rehearsal (follow-up)

`scripts/qa/rehearse-clean-baseline-cutover.mjs`, run by `clean-baseline-cutover-rehearsal.yml` on disposable PG16 and PG18, rehearses the whole recovery after the baseline is built:

1. Role layout: `payrollph_schema_owner` owns application objects; `payrollph_ledger_owner` owns the three migration-control ledgers; `payrollph_migrator` runs reviewed DDL through inherited schema-owner membership and has only SELECT on the ledgers plus INSERT on the forward journal; `payrollph_migration_planner` reads the ledgers only; `payrollph_app` has DML only (append-only on `audit_events`); the audit sealing and maintenance groups plus a dedicated sealer login.
2. Ledgers from the two DBA templates, a `baseline-included` receipt for every numbered file through the latest prefix (147 files, 13 duplicate-prefix groups), and the single cutover row with the runner's manifest digest.
3. The v2 audit guards via the review-only companion bound in memory, after which the scanner reports no migration-created object missing.
4. Every reviewed-runner gate as the planner (lineage, historical catalog, ledger privileges, decision), then plan and apply of a probe migration as the migrator; a second apply is a no-op, and the new table belongs to the schema owner.
5. Audit sealing through the dedicated sealer; sealing as the app login, tampering and TRUNCATE are refused.

`scripts/qa/probe-runtime-ddl-as-app-role.ts` then calls all 13 request-time schema functions as the DML-only runtime role.

### What the rehearsal found (fixed here)

- **25 unnamed column CHECKs** (`status IN (...)`, rating ranges, billing amounts) were missing from the baseline. The name-based scan could not see them. The scanner now matches them by meaning, including one combined named CHECK covering several columns, and the supplement restores them under PostgreSQL's generated names.
- **The production preflight rejected the v2 audit trigger.** `scripts/check-production-schema-preflight.ts` required `audit_events_protect_mutation` to call `audit_events_protect()`; 0133 repoints it at `audit_events_protect_v2()`. It now accepts either. (`core-schema-readonly.ts` was fixed separately in #1210, which accepts the complete v1 or canonical v2 guard set.)

### What it shows for the switch-over

- In the default (legacy) compatibility mode, 12 of 13 request-time schema functions fail as a DML-only role ("permission denied"): the app still writes schema at request time.
- With `REQUEST_SCHEMA_READONLY_ENABLED=true` (which forces read-only mode and the canonical schema shapes from #1210), all 13 pass on the rehearsed baseline. Without the flag, the marketing-leads check expects the legacy runtime index shape (`DESC NULLS LAST`) and fails. So the app can run as a least-privilege role on the new database in read-only mode, which remains a structural subset check rather than full schema proof.
