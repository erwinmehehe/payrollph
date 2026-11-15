# #1031 — Owner-run production catalog export, OFFLINE comparison

**READ BEFORE ANY SQL.** This is a source-only draft. The agent does not connect to Neon, production or any real database. The tool compares **only the files provided**, not production generally. Independent DBA review, migration approval, target authentication and release acceptance remain separate decisions.

## Already on main — nothing rebuilt

- **#1075:** full AST/Drizzle schema manifest, pure diffSchema comparator, and fullSchemaCatalogSql in scripts/check-issue-1031-full-schema-diff.ts; manual protected schema audit already exists.
- **#1090:** DBA-only source template for a least-privilege catalog role. It creates a NOLOGIN role only when three genuine migration-control tables are present; it does not provision a production login.
- **#1097:** historical migration source worksheet with exact full paths/checksums. The original 142-file worksheet is historical; the current drizzle/ list has grown. Thirteen colliding numeric-prefix groups have no canonical selection.
- **#1101:** already merged review-only forward schema candidate for IT-assets. NOT applied or authorized for production.
- **#1386:** source table/column presence guard.
- **#1605:** types, defaults, nullability, identity, named PK/FK/UNIQUE/CHECK and index structural guard.
- **#1613:** extra-object and renamed-object negative tests for disposable PG18.
- **deploy/SCHEMA_RECONCILIATION_PLAN.md** and **drizzle/README.md:** old SQL is not one safely replayable numbered sequence. No drizzle/meta/_journal.json exists. The clean PG18 db:push is source bootstrap, NOT historical migration replay.

## New, additive work

1. scripts/issue-1031-offline-export-sql.ts prints owner-run SQL using the existing #1075 fullSchemaCatalogSql; the program never connects to a database.
2. scripts/lib/issue-1031-offline-parity.mjs validates export completeness and reuses the existing #1386/#1605/#1613 ratchet functions, not a rewritten comparison algorithm. It also uses the existing exact-path migration source inventory.
3. scripts/qa/issue-1031-compare-offline.mjs reads two private JSON files and writes a private report; it has no DB/network code.
4. Fictional fixtures and tests, plus a small source-only CI job.
5. An **independent**, synthetic-only disposable PG18 CI job executes the owner-export SQL and asserts catalog index attributes. The original offline fixture job still uses no database.

## Export V2: comprehensive index metadata from read-only catalogs

The initial shared #1075 query is reused unchanged, and the offline-only export now enriches its non-constraint index rows with the PG18 fields already understood by #1605: DESC ordering and NULLS FIRST/LAST flags from `pg_index.indoption`, INCLUDE columns, index `reloptions` (storage options), explicit tablespace, and `indnullsnotdistinct`. The offline comparer rejects missing/malformed fields and blocks drift in each one. **V1 exports must be regenerated**: only the complete V2 format is accepted. Other source-guard behavior has not been relaxed.

Fictional adversarial tests exercise each metadata field, while the separate `issue-1031-disposable-pg18-export.yml` CI job runs the printed V2 SQL against a disposable PostgreSQL 18 instance and validates its catalog index metadata. This verifies an isolated synthetic index case, **not** the owner's real reference export, production authentication, or historical migration replay provenance. The production export and DBA signoff remain independent.

## Owner prerequisites — STOP if any is missing

1. Obtain owner, DBA and security approval for the production read-only inspection and verify the real deployed target, account and branch privately. A file label is not proof of target identity.
2. DBA reviews docs/engineering/p0-4-catalog-auditor-bootstrap-template.sql and the companion .md. Create/activate a genuine restricted auditor login only under the separately approved procedure, after authentic migration controls exist. The template's NOLOGIN role is not itself a login. No agent may run this template or invent missing journals.
3. Independently verify actual auditor grants: read system catalogs and SELECT on exactly the approved migration-control tables; no employee/payroll/business row reads, application DDL/DML, BYPASSRLS or role administration. Use an explicit read-only transaction and conservative timeouts.
4. If the approved auditor or any one of the three required migration-control tables is absent, **STOP**. Do not create journals, substitute synthetic receipts, use an application writer, or treat a missing journal as an empty successful audit.

## Owner: private production metadata JSON export

Execute ONLY on a separately approved DBA/operator workstation. No connection details or credentials appear in these commands.

    umask 077
    PRIVATE_DIR="$HOME/private-issue-1031"
    mkdir -p "$PRIVATE_DIR"
    ./node_modules/.bin/tsx scripts/issue-1031-offline-export-sql.ts --production > "$PRIVATE_DIR/production-export.sql"
    # Only inside a separately approved restricted catalog-auditor session:
    psql -X -qAt -v ON_ERROR_STOP=1 -f "$PRIVATE_DIR/production-export.sql" > "$PRIVATE_DIR/production-catalog.json.tmp"
    # Only after exit 0 and owner verification of one complete JSON object:
    mv "$PRIVATE_DIR/production-catalog.json.tmp" "$PRIVATE_DIR/production-catalog.json"

The generated SQL queries pg_catalog metadata for tables, columns, types, nullability, defaults, identity, named constraints and indexes (including their ordering, NULLS behavior, INCLUDE columns, storage settings and tablespace). The ONLY non-catalog SELECTs are on two approved migration-control journals: migration path/checksum/disposition from payrollph_release_migration_receipts, and path/checksum from payrollph_schema_migrations. Those journal rows are permitted migration *metadata*, never business rows. SQL has no row SELECT from any employee/payroll/bank/application table.

**Before comparison, privately inspect the export.** It must be a single complete JSON object with completed=ISSUE_1031_CATALOG_EXPORT_COMPLETE_V2, correct exportKind, nonzero table/column counts and matching journal counts. Confirm it contains **no employee names, pay amounts, record values, passwords, API tokens, URLs, connection strings, or unexpected secrets inside catalog default expressions**. Do not paste raw files into GitHub, Slack, CI artifacts or logs. On any query/validation failure, remove the temporary file and STOP.

## Owner: prepare the disposable PostgreSQL 18 reference

Only a separately isolated PG18 database with fictional data may be used. A DBA must define the **reviewed migration-source build method first**. The drizzle/ numbered sources include duplicated prefixes, historical overlap, DML/backfills and missing dependencies; do NOT auto-replay the folder. Until a DBA approves a safe ordered, isolated rehearsal, no full historical migration replay can be claimed.

The existing Clean PG18 Source Bootstrap + Full Regression job performs a guarded first source db:push plus source supplement and runs the #1386/#1605/#1613 guards. This is useful source-structure evidence but is **NOT** an execution of all historical migrations.

Once a reviewed PG18 reference schema is built, and the existing structural guards pass, the OWNER runs this export mode **on that disposable PG18 only**, never with real database credentials:

    ./node_modules/.bin/tsx scripts/issue-1031-offline-export-sql.ts --disposable-pg18 > "$PRIVATE_DIR/disposable-pg18-export.sql"
    # Only inside the disposable PostgreSQL 18 session:
    psql -X -qAt -v ON_ERROR_STOP=1 -f "$PRIVATE_DIR/disposable-pg18-export.sql" > "$PRIVATE_DIR/reference-pg18.json.tmp"
    # Only after exit 0 and validation:
    mv "$PRIVATE_DIR/reference-pg18.json.tmp" "$PRIVATE_DIR/reference-pg18.json"

The disposable export deliberately has no journal entries: historical source-to-journal evidence is tested against the current repository SQL files separately. Keep DBA-approved PG18 build provenance privately; this offline comparator **cannot authenticate** a claimed migration replay.

## Offline comparison (no DB or network use)

    node scripts/qa/issue-1031-compare-offline.mjs \
      --reference "$PRIVATE_DIR/reference-pg18.json" \
      --production "$PRIVATE_DIR/production-catalog.json" \
      --report "$PRIVATE_DIR/offline-parity-report.json"

Input/output paths MUST be outside the Git working tree. The report is written only once with owner-only permissions; raw schema rows/defaults are not printed to stdout. Exit 0: no BLOCKING or NEEDS-OWNER-DECISION differences (INFORMATIONAL may remain). Exit 1: a report was written but blocking or owner-decision issues exist. Exit 2: malformed/truncated inputs or unsafe path/failure; no clean result.

- **BLOCKING:** required table/column/key/index missing, column type/default/nullability/identity or structural drift, or source SHA mismatch.
- **INFORMATIONAL:** extra table, column, constraint or index. This does not automatically approve it; owner must review.
- **NEEDS-OWNER-DECISION:** current numbered migration file absent from both migration journals, unexpected journal source or intentionally recorded not-applied file. Duplicate four-digit migration prefixes require exact full-path review, not automatic sorting.

The report lists differences but contains **no repair SQL**. Do not generate or run repair SQL from it without independent DBA examination of migration receipts, backups, source/deployed SHA, legacy compatibility writers, RLS expectations, role grants and formal change approval. The protected live schema audit and production release controls are NOT replaced.

**Certification boundary: ONLY THE EXPORTS PROVIDED WERE COMPARED — NOT PRODUCTION IN GENERAL. No production migration, payout, payroll, filing or deployment approval.**
