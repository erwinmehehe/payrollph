# Clean-baseline cutover runbook

Moves PayrollPH from the drifted development `neondb` (fictional data only) to a new database built from source: every table in `schema.ts`, drizzle/0109, `docs/sql/source-baseline-supplement.sql`, the v2 audit guards, least-privilege roles, and the migration-control ledgers. After it, every schema change goes through **Production Reviewed SQL Migration**.

Workflow: **Clean Baseline Cutover (Manual, Protected)** (`.github/workflows/clean-baseline-cutover.yml`). It builds the schema artifact on a throwaway server inside the job, then runs `scripts/run-clean-baseline-cutover.mjs` against the target in one transaction. `dry-run` rolls back; `apply` commits, then verifies read-only as the planner and the app role. The same code path is exercised on every relevant PR by `clean-baseline-cutover-rehearsal.yml` (job "Production cutover runner against a simulated Neon owner").

The runner refuses: a target that is not empty, the original production branch (`br-lucky-sound-b79i56jw`) or QA branch (`br-green-hat-b77qj8fs`), a Neon identity that does not match the pinned variables, missing or elevated roles, and any run that is not the exact reviewed commit on `main`. It never creates or prints passwords.

## 1. Prepare (owner, in the Neon and GitHub consoles)

1. **New empty target.** In project `calm-wave-70219564`, create a new branch for the clean baseline. Its database (here `payrollph_clean_baseline`) must have an empty `public` schema (no tables, sequences or functions). Record the branch ID (`br-…`) and endpoint ID (`ep-…`). Do not touch the existing `neondb` on the current branches; it stays as the fallback.
2. **Roles, with SQL, as the database owner** (Neon SQL editor, connected to the NEW branch). Roles created in the Neon Console belong to `neon_superuser`, which the runner refuses for these roles. Run the statements below, then add a password to each LOGIN role yourself (`ALTER ROLE … PASSWORD '…'`, from a password manager):

   ```sql
   CREATE ROLE payrollph_schema_owner NOLOGIN NOINHERIT;
   CREATE ROLE payrollph_ledger_owner NOLOGIN NOINHERIT;
   CREATE ROLE payrollph_audit_sealing NOLOGIN NOINHERIT;
   CREATE ROLE payrollph_audit_maintenance NOLOGIN NOINHERIT;
   CREATE ROLE payrollph_migrator LOGIN INHERIT;
   CREATE ROLE payrollph_migration_planner LOGIN NOINHERIT;
   CREATE ROLE payrollph_app LOGIN NOINHERIT;
   CREATE ROLE payrollph_sealer_login LOGIN NOINHERIT;
   ```

   Do not grant anything else; the cutover does the grants.
3. **GitHub environment `production`.** Add yourself as a required reviewer and restrict it to `main`. Set:
   - variables `PRODUCTION_NEON_PROJECT_ID` (`calm-wave-70219564`), `PRODUCTION_NEON_BRANCH_ID` and `PRODUCTION_NEON_ENDPOINT_ID` (the NEW branch). The existing reviewed-migration workflow uses the same variables, so after the cutover it targets the new database too.
   - secrets, all for the NEW branch's `payrollph_clean_baseline` database:
     - `PRODUCTION_CUTOVER_OWNER_DATABASE_URL`: the database owner (for example `neondb_owner`)
     - `PRODUCTION_MIGRATION_AUDIT_DATABASE_URL`: `payrollph_migration_planner`
     - `PRODUCTION_MIGRATION_WRITER_DATABASE_URL`: `payrollph_migrator` (used by later reviewed migrations)
     - `PRODUCTION_CUTOVER_APP_DATABASE_URL`: `payrollph_app`
4. **Branch protection on `main`.** Apply refuses to run unless GitHub reports `main` as protected.

## 2. Back up the current database

Run the existing **protected Neon offsite backup** workflow against the current `neondb` and keep the backup until the new database has been in use for a while.

## 3. Dry-run, then apply (owner approves each run in GitHub)

Run **Clean Baseline Cutover (Manual, Protected)** from `main`:

| Input | Dry-run | Apply |
|---|---|---|
| `mode` | `dry-run` | `apply` |
| `reviewed_sha` | the current `main` commit SHA | same |
| `expected_database_name` | `payrollph_clean_baseline` | same |
| `approval_ref` | empty | an owner approval reference, e.g. `owner-cutover-2026-10-18` |
| `apply_confirmation` | `NO` | `APPLY_CLEAN_BASELINE_CUTOVER` |

The dry-run log shows each step, the artifact SHA-256, 280 tables, 147 receipts, the manifest digest and "no migration-created object missing", then "dry-run left the target untouched". Apply shows the same, committed, followed by both verification steps. A second apply is refused because the target is no longer empty.

## 4. Switch the app (owner, Vercel settings; Preview first)

- `DATABASE_URL` → the new `payrollph_clean_baseline` as `payrollph_app`
- `AUDIT_SEALER_DATABASE_URL` → the new `payrollph_clean_baseline` as `payrollph_sealer_login` (same host, port and database, different user)
- `REQUEST_SCHEMA_READONLY_ENABLED=true`, `CORE_SCHEMA_COMPATIBILITY_MODE=read-only`, `AUDIT_ROLE_ISOLATION_PROOF_ENABLED=true`

Leave payment flags unchanged. Redeploy, then check signup through a payroll run with fictional data. The new database starts empty.

## Rollback

Before the Vercel switch there is nothing to undo; the old `neondb` is untouched. After it, point `DATABASE_URL` back to the old database and remove the three flags. Do not drop the new branch until you have decided which database to keep.
