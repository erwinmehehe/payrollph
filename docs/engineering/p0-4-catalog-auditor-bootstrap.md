# P0-4 — Catalog-only production migration auditor: DBA handoff

**Disposition: SOURCE TEMPLATE ONLY / PRODUCTION NO-GO.** This handoff is not permission to create a production database role or bypass independently approved database-release requirements.

## Why this role is needed

PayrollPH's manual protected read-only workflows require an independently authenticated PostgreSQL account that can inspect system catalogs and read only three migration-control tables. The existing Neon roles are inappropriate for this job: the owner and service accounts can write application data; the managed Auth role has unrelated managed-schema writes and no approved migration-journal access. Do not reuse any of them as an audit credential.

## Preconditions before running the SQL template

1. Obtain independent DBA/security and business-data access approval for the actual production branch and operator, exact GitHub main SHA, secret handling, and release change ticket.
2. Independently establish a current encrypted **off-provider** production backup with a witnessed, privacy-approved isolated restore and private recovery record. A Neon same-project checkpoint or synthetic CI run does not satisfy this.
3. Reconstruct real historical full-path SQL SHA-256 execution evidence, resolve legacy numbered collisions and earlier 0115–0123 prerequisites, and obtain independently approved historical receipts and cutover. **Do not invent applied or baseline-included dispositions.**
4. Independently create and review the three controlled migration tables using existing approved DBA templates. The new role template deliberately refuses to execute while any one is absent, as they are on the live database today.
5. Verify the live application, database host, Neon project, branch, endpoint and `neondb` identity privately before provisioning. Production Vercel routing and the DBA session must be separately checked; a matching database name alone is not enough.

## Source and controlled execution

DBA-only template: `docs/engineering/p0-4-catalog-auditor-bootstrap-template.sql`. It pins the verified original Neon production identity and, in one SQL transaction, refuses a pre-existing role or missing journals, creates a **NOLOGIN, NOINHERIT, non-elevated** role, grants only necessary catalog/journal access, and rolls back if it has application-table reads, app writes, CREATE or unexpected managed Auth access. The preflight also compares all 18 required journal columns and types, fixed column counts, validated single-column primary keys, reviewed CHECK counts, and the forward migration-number unique key against the separate DBA schema templates. A matching catalog shape is **not** proof that any historical migration occurred or that its receipt is genuine.

An independently authorized DBA may inspect the exact committed bytes and use a verified direct/unpooled Neon connection in a secure operator environment, running `psql -X -v ON_ERROR_STOP=1 -f docs/engineering/p0-4-catalog-auditor-bootstrap-template.sql`. Connection details and credentials must be supplied privately through their managed PostgreSQL service config, never pasted in GitHub/chat, process logs or repository files. A failed guard is **STOP**, not a reason to weaken it.

This source deliberately creates **NOLOGIN**. Only after separate security approval may the DBA securely set a strong vaulted password and activate LOGIN using a private controlled mechanism; do not put credentials in SQL files, workflow logs or issue comments. Keep separate approved accounts for production backups and migration writes. Do not give this role `pg_read_all_data`, `pg_write_all_data`, `pg_monitor`, `SELECT ON ALL TABLES`, `BYPASSRLS`, CREATEROLE or application role memberships.

## Independent verification before any PLAN

Using **the actual resulting audit login**, not the DBA owner or a switched demo role, confirm the same pinned Neon session GUCs and SSL/TLS host verification, read-only `pg_catalog` access, and SELECT on precisely the three adopted migration tables. Catalog-only queries must show **no** employee/payroll/bank or managed Auth table SELECT; **no** application table write or database/schema CREATE privileges; and no elevated role attributes. Record only sanitized boolean predicates and change references.

Provision `PRODUCTION_MIGRATION_AUDIT_DATABASE_URL` inside the protected GitHub `production` environment only after reviewer approval. The distinct writer secret stays separate. Then run the read-only `Production Migration Receipts Audit` and `P0-4 Historical DBA Evidence` exact-main workflows; require a genuine pass with independent historical receipts before requesting the first reviewed migration `PLAN`. A PLAN, even successful, never authorizes APPLY.

## Evidence from the isolated Neon rehearsal

On 2026-10-15 the operator used nondefault dev branch `br-green-hat-b77qj8fs`, made an ephemeral `NOLOGIN` role in a transaction savepoint, and granted only `USAGE ON SCHEMA public`. PostgreSQL 18 required an explicit temporary `GRANT role TO neondb_owner WITH SET TRUE` for the impersonation test. With `SET LOCAL ROLE`, metadata-only assertions all passed: current role matched, `USAGE` yes, public CREATE no, employee SELECT no, employee writes no, catalog relation lookup yes. `RESET ROLE` followed by `ROLLBACK TO SAVEPOINT` removed both the test role and temporary membership; an independent query showed no persisted probe role.

An additional real PostgreSQL 18 rollback-only exercise of the exact source template (with only its hard-coded branch/endpoint substituted for the isolated test branch, and **empty disposable copies** of the approved journal schemas) passed all preflight, grant and postflight statements. It verified three journal-only SELECT grants, denied employee-row access, and rolled back the role and temporary journal tables. The unmodified template independently refused the test branch with `CATALOG_AUDITOR_WRONG_NEON_PRODUCTION_TARGET`. A journal with the correct name but the wrong shape now explicitly fails closed; none of this creates historical receipts.

This **tests the role's least-privilege shape** only. It does not test the DBA template's pinned production preflight or missing migration-control grants, and it is not an operator-created production credential, historical proof, backup or release acceptance.

Linked gates: #1061, #907, #899, #1031 and `docs/engineering/reviewed-migration-runner.md`.

**Do not deploy schema repairs, enable real payroll, transfer funds or file with an agency on the basis of this source change.**
