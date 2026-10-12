# PayrollPH — Neon production database generation and migration cutover hold

**Observed:** 2026-10-12. **Status:** read-only audit; NOT an approved cutover.

## Confirmed connection and schema identity

The account owner confirmed Neon project ddbb (project id broad-math-04547566), branch production, database neondb, is used by PayrollPH. Inspected PostgreSQL catalogs and aggregate counts only; no personal, bank, government ID, password, or payroll row values were retrieved or changed.

- PostgreSQL 18.6; 20 public base tables. No other application schemas or reviewed SQL receipts were found.
- Legacy model: clients.id, users.id, employees.id and payroll_runs.id are UUIDs, related by client_id; detail table payroll_lines.
- Current GitHub main Drizzle model: organizations.id, users.id, employees.id and payroll_runs.id are integer/serial keys, with organization_id links and payroll_entries. The four schema files in drizzle.config.ts declare approximately 253 pgTable objects.
- Production has no organizations, payroll_entries, payrollph_schema_migrations, payrollph_release_migration_receipts or payrollph_migration_cutover tables.
- Exact row counts: 3 client records, 21 employees, 7 users, 11 memberships, 20 payroll runs, 279 payroll lines and 162 work records. Only 4 of the 20 runs have related payroll_lines rows; other run history may exist in payroll_runs.lines JSON. All three clients.is_demo flags are true, but their records remain confidential until classified.
- Read-only link checks found zero orphan employees, orphan payroll runs, orphan payroll lines and cross-client payroll-line links. This is not payroll reconciliation.
- The legacy employees table includes bank account and statutory identifiers. Never export, log or copy these values to a new target without key management, privacy scope and an approved protected channel.

## Hard stop

Do NOT run npm run db:push, drizzle-kit migrate, drizzle/baseline.sql, the #865 0115–0119 train, #874 0120, a direct rename of clients to organizations, or the #867 forward executor against ddbb/production/neondb. This is a populated, incompatible database generation. Migration-number reservation is only one of two blockers.

The proposed operator-run audit script scripts/audit-neon-schema-generation.mjs uses an independently provisioned SELECT-only PRODUCTION_SCHEMA_AUDIT_DATABASE_URL. It opens an explicit REPEATABLE READ READ ONLY transaction, queries catalogs only, rolls back and fails closed on legacy, mixed and missing-journal states. A positive catalog result still cannot authorize applying SQL. Do not put credentials in PRs, prompts, issue comments, examples or logs.

## Required controlled transition

1. **Classify source records and verify custody.** Independently verify deployment-to-Neon scope and which rows are demos versus actual payroll history. Preserve a verified backup/restoration reference and an access-restricted source read role.
2. **Provision a separate, clean v2 schema** in an isolated Neon database/project using a DBA-reviewed current-app baseline and PG16/PG18 compatibility tests. Cloning the original branch alone is not clean: it copies the conflicting UUID users, employees and payroll_runs tables. Original source remains unchanged.
3. **Agree immutable identity mappings:** legacy_client_uuid -> organization_id, legacy_user_uuid -> user_id, legacy_employee_uuid -> employee_id, legacy_run_uuid -> payroll_run_id and legacy_line_uuid -> a new immutable line/history reference. Enforce tenant-scoped uniqueness and never cast UUID to integer or guess legal-entity attribution.
4. **Stage and review data transformations.** Employee names, historical dates, monthly pay versus period rates, company statutory registrations, leave/time history, sensitive identifiers and the 16 payroll runs without separate line records need explicit handling. Current employee data must never overwrite historical employer or pay evidence. Use audited bank encryption only.
5. **Reconcile payroll before activation.** Retain original immutable run and employee snapshots; compare gross, deductions, net, employer portion, status, approvers and associated evidence employee-by-employee. No unexplained difference greater than PHP 0.01. Preserve all 20 runs; document only-four-runs-with-lines discrepancy. Test retry and rollback with zero duplicate inserts.
6. **Restore identity security.** Review controlled account re-enrollment instead of copying password hashes, TOTP secrets and recovery codes by default. Verify maker-checker, role isolation, tenant boundaries and bank authorizations independently.
7. **Then apply the numbered train in a disposable target only.** Reconcile source SQL identities and full-path SHA-256 receipts, database generation, migration order, the competing #883/#885 scheduling/evidence models and the #867 executor-vs-0119 SQL transaction/SET conflict. Validate each migration and rollback.
8. **Release gate.** DBA, payroll owner, security, privacy/DPO, QA and release owner must approve. Keep payouts, photo collection, transfers, external filing and all release-critical flags OFF until separately validated.

## Source-only acceptance

- A database metadata-only inspector reports legacy-client-uuid and blocks forward migration review on the observed schema, without retrieving any sensitive data rows.
- Missing journals, mixed versions and incorrect identifier types fail closed.
- An organization/integer schema with migration journals is only a review candidate, never release permission.
- Exact-head CI and independent PG16/PG18 validation remain required.
- No Neon production changes were made by this inventory.
