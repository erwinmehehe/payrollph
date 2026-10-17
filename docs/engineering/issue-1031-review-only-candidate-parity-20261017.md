# #1031: Four Spend/Expense table candidates and 19 existing-candidate parity audit

**State: SOURCE-ONLY / REVIEW REQUIRED / NOT AN APPROVED MIGRATION.** This
package does not alter application code, numbered `drizzle/` migrations,
runtime schema writers, production credentials, historical receipts or user data.
No part of the proposed SQL should run against production, Neon, staging, or a
real employer database. All execution in the new CI job is against an empty,
disposable, localhost-only PostgreSQL 16 or 18 database with money flags OFF,
and each candidate rehearsal is rolled back.

## Four missing candidate sources

All four are additive SQL **source candidates**, not production patches. Their
individual atomic `DO` blocks fail closed when their target already exists or
a parent table is missing; preflight, DDL and postflight share one transaction.
They do not insert, backfill, update, delete or drop business rows.

| New source | Parent dependencies |
| --- | --- |
| `docs/sql/issue-1031-expense-reports-additive-candidate.sql` | `organizations`, `employees`, `users` |
| `docs/sql/issue-1031-expense-report-items-additive-candidate.sql` | `organizations`, `expense_reports`, `expense_claims` |
| `docs/sql/issue-1031-spend-cards-additive-candidate.sql` | `organizations`, `employees` |
| `docs/sql/issue-1031-spend-card-transactions-additive-candidate.sql` | `organizations`, `spend_cards`, `users` |

In particular, employer-paid card transactions remain structurally separate
from the employee-paid expense report/claim path. This patch mirrors the current
`src/db/schema.ts` definitions, including all existing check constraints,
indexes and FK delete actions; it **does not invent** new tenant-scoped composite
constraints or authorization guarantees. Such hardening requires independent
schema/application review and can affect existing data.

## Existing 19 table definitions with unnumbered source proposals

The inventory is executable documentation in
`scripts/lib/issue-1031-review-only-candidate-inventory.mjs`. It includes
all 19 unique tables without a numbered creating migration in the source
crosswalk and all current proposal files, including the duplicate older HR
cases proposal:

| Source file | Tables covered |
| --- | --- |
| `docs/engineering/migration-proposals/employee-document-vault-a5.sql` | `hcm_document_expiry_notices` |
| `docs/sql/issue-1031-schema-only-hr-cases-review.sql` | `employee_hr_cases`, `employee_hr_case_messages` |
| `docs/engineering/migration-proposals/employee-hr-cases.sql` | same two HR tables (older proposal; checked separately) |
| `docs/engineering/migration-proposals/hcm-engagement-survey-aggregate.sql` | `engagement_surveys`, `engagement_survey_participants` |
| `docs/engineering/migration-proposals/offboarding-clearance-a6.sql` | `separation_clearance_waivers` |
| `docs/engineering/migration-proposals/offline-punch-claims.sql` | `offline_punch_claims` |
| `docs/engineering/migration-proposals/recruitment-applicant-privacy.sql` | `applicant_privacy_evidence` |
| `docs/engineering/migration-proposals/saved-report-definitions.sql` | `saved_report_definitions` |
| `docs/engineering/migration-proposals/spend-payroll-reimbursements.sql` | `expense_category_policies`, `expense_claim_evidence` |
| `docs/sql/issue-1031-schema-only-it-assets-review.sql` | `it_applications`, `it_managed_devices`, `it_access_grants`, `it_device_events` |
| `docs/sql/pending-multi-entity-registration-versions.sql` | `legal_entity_statutory_registrations`, `legal_entity_profile_change_requests`, `employee_entity_bank_accounts`, `legal_entity_transfer_liability_evidence` |

Existing proposals are **not silently rewritten or accepted**. An exact
schema-parity failure or an unmet prerequisite is a blocker to representing
that proposal as current. Historical migration or production presence is
not inferred from these documentation files.

## Verification contract

- Source-only node test checks the 19+4 crosswalk, candidate CREATE TABLE
  coverage, and each new candidate's fail-closed single-block structure.
- Dedicated GitHub workflow provisions isolated PostgreSQL **16 and 18**,
  performs one guarded, stable `npm run db:push` from the current
  `src/db/schema.ts`, then captures the fresh `pg_catalog` baseline.
- The runner uses the TypeScript-AST/Drizzle manifest for the full 23-table
  inventory and FK dependency checks. Candidate acceptance is based on
  **exact PostgreSQL catalog row equality** with the fresh Drizzle push:
  table, column type/nullability/default, named FK and delete action, check,
  unique constraint, primary key, index and predicate metadata.
- The repository's separate manifest comparator presently reports equivalent
  PostgreSQL deparser renderings as DRIFT for 19 check/predicate objects
  *on the untouched fresh push itself*. These are logged as baseline
  diagnostics, not used to excuse any candidate/catalog difference.
  The exact catalog comparison remains strict, including check expressions,
  partial-index predicates and non-validated constraints.
- For every group, it drops only the named targets inside a
  **ROLLBACK-only transaction**, refuses unforeseen external FK dependents,
  applies its literal DDL (except stripping top-level BEGIN/COMMIT wrappers
  from older proposals), captures catalog metadata and restores the pristine
  first-push snapshot. No CASCADE is used.
- The four new sources additionally prove missing-parent and duplicate-run
  denial; a deliberate `varchar(100)` to `varchar(101)` mutation proves
  the real catalog comparison detects type drift.
- The known stable Drizzle second-push limitation (#1019) is **not** treated
  as proof of idempotence. This verifies the first pushed schema versus
  review-only proposals only.

**Evidence boundary:** passing in disposable PostgreSQL does not authorize
numbered migration adoption, DBA source/SHA approval, protected backup/restore,
actual schema deployment, finance/payroll release, any feature activation or
production cutover. Reconcile genuine live target catalog and original
migration receipts under the independent operator/DBA process first.
