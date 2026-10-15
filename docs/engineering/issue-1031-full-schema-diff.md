# #1031 — Full 270-table source-versus-catalog schema diff

**Status: SOURCE-ONLY REVIEW CANDIDATE. No production inventory run, no migration, no release approval.**

## Why this exists

The protected production canary in `scripts/check-production-schema-preflight.ts` checks only named release-critical objects. A table-name-only audit cannot identify a wrong type, missing column, wrong FK action, missing unique key, invalid index or changed check constraint in otherwise existing tables. This independent full-schema inventory covers every `pgTable` declared at the exact reviewed source SHA; it does **not** replace the existing 13-table canary or any production migration control.

## Components

- `scripts/lib/issue-1031-schema-manifest.ts`: uses the TypeScript compiler AST to enumerate `pgTable` declarations, refuses missing/duplicated exports and uses the pinned Drizzle ORM metadata to resolve actual column types/defaults/nullability/identity, single- and multi-column FKs, indexes and expressions, check constraints, PKs and unique constraints. It requires at least 270 models; no manually maintained expected-object lists.
- `scripts/issue-1031-print-schema-manifest.ts`: prints the source-generated manifest. Does not connect to a database.
- `src/lib/issue-1031-full-schema-diff.ts`: pure, deterministically sorted, per-object `PASS | MISSING | DRIFT | EXTRA` evaluator.
- `scripts/check-issue-1031-full-schema-diff.ts`: catalog-only reader. Collects all public regular/partitioned tables; columns with `pg_attribute`, `format_type` and `pg_attrdef`; FKs and CHECKs with `pg_constraint`; primary/unique constraints; nonconstraint indexes with `pg_index`, `pg_class` and `pg_am`. Returns one row per table/object/kind plus expected/actual signatures.
- `.github/workflows/issue-1031-full-schema-diff.yml`: manual protected audit, pinned exact `main` SHA and operator-supplied database name.
- `tests/issue-1031-full-schema-diff.test.ts` and `tests/issue-1031-full-schema-postgres.test.ts`: pure regression plus rollback-only disposable localhost PostgreSQL 16 fixture, deliberately changing `numeric(14,2)` to `numeric(12,2)`. CI workflow `issue-1031-schema-diff-ci.yml` does not use Neon credentials.

## Operator checklist

1. Review and merge the audited source; require its CI source-manifest generation, typecheck and isolated PostgreSQL regression to pass. Independently review exact source SQL normalization and catalog signatures before relying on the whole-repository result.
2. A DBA independently verifies Vercel's **effective** production database host, Neon project/branch/endpoint, role, expected database name and exact deployed commit privately. The project name alone does not prove `DATABASE_URL` identity. Never paste a URL, password or sensitive row value into GitHub.
3. Provision a dedicated catalog-only account without elevated role bits, write permissions or payroll-row SELECT permissions. `PRODUCTION_DATABASE_URL` in the protected GitHub `production` environment **must be this restricted audit account, not the application writer**. The script reuses the existing release-preflight identity and role guard predicates, using all source table names.
4. Manually run **Issue 1031 Full Production Schema Diff (Read Only)** on `main` using `workflow_dispatch`, with the exact current reviewed 40-character SHA and the DBA-supplied database name. Do not dispatch from a feature branch or PR commit.
5. Confirm the published JSON's `CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL` tag. Inspect every `MISSING`, `DRIFT` or `EXTRA` result; distinguish intentional legacy structures, runtime compatibility DDL, and actual migration gaps. Retain immutable operator-reviewed output with the source commit and target identity **outside of public logs**.
6. Reconcile historical source paths and checksums, including duplicate numeric prefixes and `baseline.sql`, against **authentic** independent migration receipts. Do not mark any historic migration as applied from structural presence. Propose only DBA-approved forward repairs.

## Safe operation and bounded evidence

The audit connects only after validating required inputs; starts one `REPEATABLE READ, READ ONLY` transaction; enforces statement/lock timeouts and `pg_catalog` search path; runs the existing exact identity-guard query predicates; reads only PostgreSQL catalog metadata; and explicitly `ROLLBACK`s even on success. It prints no raw SQL exception details, creates no runtime DB functions, runs no DDL/DML, changes no rows, and performs no employer/payroll-row SELECT. It fails closed for invalid identities, unknown source schema exports and catalog query errors. **Production inventory has not been executed by this PR.**

**Important scope of structural normalization:** Comparison preserves case and whitespace inside quoted SQL literals and requires the matching conventionally named serial sequence (not any arbitrary `nextval`).  SQL deparsing and expression equivalence are not generally decidable by text normalization. Expression indexes, partial-index predicates, SQL defaults and CHECK bodies can differ textually even when logically equivalent; conversely superficial normalization cannot prove semantic equivalence. Catalog comparison treats such changes as drift for independent review rather than silently declaring a match. PostgreSQL-generated names and implicit indexes must be checked against actual Drizzle output. This initial source candidate must pass CI and independent DBA validation before it is trusted as a complete live-drift gate.

## Explicit non-goals

- **Not** a migration execution receipt or provenance audit.
- **Not** evidence that employee, tax, payroll, banking or filing values are correct.
- **Not** a full permissions, row-level authorization or tenant-isolation test.
- **Not** evidence the runtime uses the inspected database unless separately authenticated.
- **Not** a substitute for #1031 controlled remediation steps 3–7: verified private backup and restore, dependency-ordered forward migrations, isolated PG16/18 and tenant-security rehearsals, human DBA/security approval, protected runner execution and post-change acceptance.
- A fully clean schema diff **does not** authorize real payroll runs, employee data processing, bank disbursement, government filing, deployment or activation of feature flags.

**Release decision: NO-GO for production SQL changes until every independent safety and evidence gate is satisfied.**
