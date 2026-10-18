# PR #1210 — read-only deployment cutover: evidence and hold (2026-10-18)

**Updated disposition: source merge eligible with the new flag OFF after CI.
Live read-only activation remains NO-GO until its operational checks pass.**

The historical hold below described the former unconditional default flip.
The current source adds REQUEST_SCHEMA_READONLY_ENABLED, default OFF, preserving
main's mode selection. Its ON path accepts the complete 0133 v2 guard boundary,
with executed PG16/18 migration-to-preflight and drift tests. This supersedes the
old draft/source-merge hold, not the live database/credential/activation boundary.
No new independent source approval, backup destination or staging is requested.
The owner has confirmed only Vercel is running (no separate worker). The #1222
private capture identified an elevated web runtime role; it did not fix that
role. Therefore restricted-role remediation remains required before activation.

Flag-off also preserves the historical NULLS LAST marketing index contract for
explicit read-only callers. Only flag-on adopts canonical DESC/NULLS FIRST
acceptance. The runtime selects the appropriate contract without changing
indexes; synthetic PostgreSQL tests exercise both definitions and both modes.

## Historical unconditional-cutover review

This is an evidence record and operator handoff, **not** approval to merge, deploy,
change Vercel environment values, grant database roles, migrate a database, or
access employer/employee business rows. The PR's source-only CI can pass while
the production-linked database schema remains incompatible with its fail-closed
read-only request preflights.

## Source and rollout boundary

- PR: #1210, branch `fix/request-runtime-ddl-readonly-20261017`;
  inspected source commit `8317cdf4e20514b3ce4aa51af0d8885ed6135bc9`.
- The proposed change defaults normal request-time schema compatibility to
  catalog-only verification. It deliberately does not auto-create missing
  tables/indexes or backfill data. The historical DDL text remains retained
  for forensic review, not application execution.
- The CI-only legacy fixture allowance is scoped to the disposable GitHub
  Actions local PostgreSQL `127.0.0.1:5432/app_db`; it is not a production
  migration mechanism.
- The Git-linked Vercel project `erwinmehehe-payrollph` automatically built
  a `production` deployment for merged PR #1215 at
  `0921b02ad73475e4eaf76ea6b45f65efc046ce5d`, reported `READY`.
  Therefore merging this DB cutover could trigger a deployed application before
  the necessary schema/role evidence and migrations have been approved.
- Metadata-only Vercel project/env inspection does **not** independently prove
  the effective `DATABASE_URL`, the serving branch, or database role.
  Do not log or copy decrypted connection strings into issues, CI, or documents.

## Refreshed read-only Neon table-name comparison

Retrieved on 2026-10-18 from Neon project
`calm-wave-70219564`, default branch
`br-lucky-sound-b79i56jw` (`main`), database `neondb`:
**no DDL, no mutation, and no application/employee/payroll data queries.**

| Name-level evidence | Count |
| --- | ---: |
| Distinct `pgTable(...)` names in inspected PR #1210 `src/db/schema.ts` | 271 |
| Public relations returned by the read-only table inventory | 155 |
| Declared table names absent from this inspected `public` schema | 123 |
| Live `public` table names not declared in `schema.ts` | 7 |
| Matched declared + live table names | 148 |

The seven live-only identifiers were
`ess_employee_photos`, `ess_identifier_requests`,
`ess_other_identifiers`, `saas_billing_checkouts`,
`saas_billing_events`, `saas_billing_state`, and
`saas_signup_verifications`.

Among the absent declared names on the inspected default were
`payout_batches`, `payout_transfers`,
`payout_batch_transfers`, `payout_profiles`,
`provider_events`, `spend_cards`,
`spend_card_transactions`, and `expense_reports`.
Neither `public.payrollph_release_migration_receipts` nor
`public.__drizzle_migrations` was present in the returned table inventory.
A table-name inventory alone cannot rule out a migration ledger under another
schema, nor prove that a particular historical migration ran.

This count supersedes the older 154-public-table / 124-missing snapshot
recorded in issue #1198 **for this inspected default only**.
The source comparison is **name-level**: it does not prove column types,
constraints, index definitions, foreign keys, triggers, data compatibility,
or authentic migration execution. It does **not** attest that the inspected
Neon default is the actual serving web/worker production database.

## Release gate: required independent evidence

1. **Actual serving identity.** Authorized infrastructure operator attests
   both web and worker Vercel runtime DB host/branch/database/role, privately
   and without exposing credentials. Compare each attested target against
   this Neon default; use a restricted, audited catalog-only reader.
2. **Permissions.** Independently prove that the effective web/worker DB
   roles cannot create/alter/drop schema, do not inherit broad owner/superuser
   membership, and have only necessary runtime access. Correct privileged
   role grants through a separately approved DBA change, not this PR.
3. **Authentic history.** Recover independently verifiable migration SQL,
   applied checksums, actor/timestamp/approval records, and the restore
   incident context (#899). Missing receipts remain marked **UNPROVEN**;
   never fabricate a migration journal or replay historical DML.
4. **Structural diff.** Against the attested serving database, compare the
   exact PR code's expected tables, columns, defaults, FKs, checks, indexes,
   triggers, and dependencies. Reconcile every extra and missing object
   without assuming that a table name proves compatibility.
5. **Forward repair rehearsal.** Obtain DBA-reviewed, minimal and ordered,
   checksum-pinned forward-only candidate SQL. Validate it on disposable
   PG16/PG18 and a separately authorized nonproduction target; include
   backup/restore, tenant isolation and exact-centavo reconciliation.
   No `db:push`, request-time DDL, unapproved historical adoption or live
   changes are authorized by this document.
6. **Controlled cutover.** Obtain independent DBA, security and release
   sign-offs; arrange migration-before-deployment ordering, a protected
   deployment gate, endpoint/application smoke tests and a rollback plan.
   Verify the exact merged SHA, the true serving DB identity and successful
   read-only catalog preflights **before** production traffic is switched.

Until this evidence is available, #1210 should remain draft even if all
GitHub workflow checks are green. See issues #1198, #899 and #908.
