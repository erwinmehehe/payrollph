# Production schema preflight: catalog-only evidence

This is a manual, protected, read-only structure check, **not a migration runner**. It checks tables, columns, indexes, an active audit-immutability trigger, and a sealing function required by current code.

## Why this exists

Production previously logged a missing saas_signup_verifications table on the /app route. That table is created by drizzle/0106_saas_selfserve_recurring_billing.sql. Current source also depends on migration 0100 (compensation intents), 0109 (audit chain) and 0110 (provider inbox).

A successful build, GitHub source merge, or isolated CI db:push does **not** demonstrate those migrations were applied to a particular production database.

## Operator checklist

1. A qualified DBA verifies the exact target production database, current applied migration journal/checksums, ordered DDL, schema compatibility, and an isolated restore/rollback rehearsal. Do not run db:push against production.
2. Arrange a read-only, least-privilege production catalog account through approved secret handling. If possible use this account for the protected GitHub Actions PRODUCTION_DATABASE_URL secret instead of a writer connection. Never paste or print the connection string in chat, issues, logs, or artifacts.
3. Review the exact main commit and run the workflow "Production Schema Inventory (Read Only)" manually using its full 40-character SHA. The workflow requires the GitHub production environment and performs SQL inside a repeatable-read READ ONLY transaction; only PostgreSQL catalog metadata is queried, not tenant records.
4. Check schemaCompatible and the reported missing object names. On any missing element, unexpected connection error, or incomplete result, stop and request DBA review of actual migration receipts. Do not auto-apply or rename SQL files.
5. Even with schemaCompatible=true, require independent DBA migration evidence, security/privacy sign-off, employer payroll authorization, a staged production build, and a verified exact deployed SHA before promoting anything.

This structural preflight does not verify applied migration journal receipts, all constraint definitions and index predicates, bank encryption/backfill, bank/provider acceptance, actual government filings, or independent payroll GA approval.

## Safe operation and rollback

- The script uses PRODUCTION_DATABASE_URL only from a protected GitHub environment. It fails closed when the secret is missing or connection/query errors occur and suppresses raw PostgreSQL exception details.
- The transaction is read only and always rolled back. No DDL, DML, payout, notification, or data mutation calls are made.
- Do not run the manual workflow from feature branches. Exact main SHA must match the reviewed SHA.
- This preflight has no migration to roll back. If compatibility is missing, leave production unchanged and follow the DBA-controlled migration/rollback protocol.
- Until a distinct Preview database exists, do not reuse live production database credentials in Vercel Preview. The isolated preview build failed because Preview has no DATABASE_URL; provision a separate synthetic-data database before retesting.

See docs/engineering/sql-migration-release-protocol.md and docs/payroll-certification/production-ga-gates.md. The Vercel Hobby cron change is separately tracked in PR #780.
