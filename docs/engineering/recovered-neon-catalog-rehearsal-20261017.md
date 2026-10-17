# PayrollPH recovered Neon: read-only catalog evidence and recovery controls

## Historical source integration — immutability and explicit current comparison

The original **October 17, 2026** Neon catalog observation is frozen in
`qa/recovery/recovered-neon-20261017.catalog.json`, with original source
Git blob `111085f3161ef0a0d401f960833a9c9f1736dd13`. The matching 271
source-declared table names are also archived in
`qa/recovery/recovered-neon-20261017.source-tables.json`. Neither captured
snapshot is updated when the source schema subsequently changes; historical
table-presence gaps remain 126 missing and 3 legacy extras.

The planner now has two deliberately distinct modes:

- `npx tsx scripts/qa/recovered-schema-plan.ts`: **captured-source-strict**;
  still fails if checked-out source bytes differ from the pinned source blob.
- `npx tsx scripts/qa/recovered-schema-plan.ts --compare-current-source`:
  explicit **current-source-advisory** report with separate historical and
  current table-presence counts, both exact Git blob IDs, drift flags and
  tables added/removed since capture. It always blocks release approval.

An index, column, foreign key, RLS, default or check can change the source
blob **without changing table names**. This is a table-name comparison
against the archived Neon observation, not a current full-DDL parity test.
A historical SQL `CREATE TABLE` mention indicates a *candidate* scanned
from the current checked-out migration folder, not a migration receipt.
This process is neither a fresh Neon audit nor authorization to run DDL,
payroll, payments or government filings. Any current-source drift requires
independent review.


Evidence date: 2026-10-17 (UTC). Source schema blob: 111085f3161ef0a0d401f960833a9c9f1736dd13. Target: Neon project calm-wave-70219564, recovery branch br-mute-mode-b740q5zx, neondb / PostgreSQL 18.

**Status: BLOCKED.** This is a review-only catalog plan and synthetic test harness, not an approved recovery, restored snapshot, migration journal or production acceptance.

## Measured inventory

| Structural measure | Recovered branch | Neon default branch | Fresh synthetic PG16 CI |
|---|---:|---:|---:|
| Ordinary public tables | 148 | 154 | 280 |
| Foreign keys | 409 | 421 | 920 |
| compensation_events | Present | Present | Present |
| compensation_automation_intents | MISSING | MISSING | Source creates |

Current source declares 271 tables, 126 absent on recovered Neon, and three additional legacy tables outside its source declarations. Recovery is missing six tables found on the default Neon branch: attendance_exception_events, marketing_leads, saas_billing_checkouts, saas_billing_events, saas_billing_state, saas_signup_verifications. Read-only structural fingerprints for columns, constraints and indexes matched across the 148 tables common to both Neon branches; that does not establish equivalence of views, functions, triggers, policies, grants, data or integrations.

The tracked JSON baseline contains ONLY catalog table names and high-level counts; there is no user, payroll or employer row data. It is NOT a pg_dump schema-only archive.

## Stage 1: Dependency plan (implemented)

Run npx tsx scripts/qa/recovered-schema-plan.ts. The script uses the repository's AST and Drizzle runtime schema manifest to classify missing declared tables and create foreign-key prerequisite ordering hints. It fails closed on stale, duplicate or overclaimed catalog evidence. The output is NOT executable SQL: real migration order may differ due to data, missing columns, historical migrations, sequences, constraints, RLS and compatibility DDL. Follow the known restrictions and historical overlap warnings in drizzle/README.md.

## Stage 2: Narrow missing-table rehearsal (implemented in disposable CI)

The attached workflow uses fresh fictional PostgreSQL 16 and 18 databases, intentionally drops the empty source-created compensation_automation_intents table, then executes only the existing drizzle/0100_compensation_automation_intents.sql creator. It verifies all 15 columns, 3 validated FKs, the compensation event cascade relation and its key unique index. No real Neon connection, production schema or employer rows are used.

Even a green result proves only that narrow synthetic table reconstruction. It cannot be used as evidence that the real 148-table recovery database accepts the historical migration or that any of the other 125 missing declared tables are fixed. The separate review-only intent-event FK candidate must not run until both relations exist and are reviewed.

## Stage 3: Actual recovered schema-only replay (NOT completed)

A DBA must supply a schema-only, audited and sanitized fictional equivalent of the real recovered state. Only a restricted DBA connection should generate the source archive (e.g. pg_dump --schema-only --format=custom --no-owner --no-acl). Verify no row data, review any embedded object definitions, and NEVER commit the raw archive or database URL to GitHub. Restore only to a disposable PostgreSQL 18 app_db, compare all tables, columns, indexes, constraints, functions, policies and triggers, then fail closed on mismatch. Do not automatically substitute a fresh source-schema bootstrap for the recovery archive.

After an exact structural match and independent DBA approval, execute the full four node scripts/run-sharded-tests.mjs <shard> 4 regression shards against both the clean and isolated recovered-schema fixtures. Capture sanitized recovered-only, clean-only and shared failures. Missing artifacts or test-harness failures are NOT successful recovery evidence.

## Stage 4: Payroll and filing sign-off (NOT completed)

Require real employer payroll reconciliation in a no-money-moving mode, independently verifying zero unexplained employee-level differences exceeding PHP 0.01. Complete the independent WFM 14-scenario acceptance and mobile/employer-switching evidence. Test government file imports using actual agency-prescribed validation workflows, retain acceptance receipts, and confirm immutable audit and migration history plus protected backup, restore, rollback and release approval. None of these are satisfied by synthetic CI.

## Decision

**NO PRODUCTION CUTOVER.** Production changes require approved exact-head schema repairs, protected PLAN/APPLY with migration receipts, separate DBA acceptance, and independent payroll/statutory UAT. This PR makes NO changes to existing Neon branches and authorizes none.

## Supplemental actual-recovery branch-only rehearsal (October 17, 2026)

**Scope:** Created a new Neon branch `br-twilight-shape-b70olxgv` from the existing
development recovery branch `br-mute-mode-b740q5zx`. The clone is separate
from the default and original recovery branches, and was the **only** Neon
branch receiving DDL in this rehearsal. It inherits its parent's data inside
Neon and is **not a sanitized or fictional archive**. No application data
rows were queried, exported, copied into GitHub, or included in CI artifacts.

### Exactly what was applied to the isolated clone

Each stage used read-only target/parent catalog preflight and an atomic SQL
`DO` block with strict object absence checks and short lock timeout:

1. Source `drizzle/0100_compensation_automation_intents.sql`:
   created `compensation_automation_intents` (source blob
   `159ed09ffc1834c15f2d68e9e62bb0348951c165`).
2. Source `docs/sql/issue-retention-email-change-tokens-additive-candidate.sql`:
   created `email_change_tokens` using its review-only atomic preflight
   (blob `d7db76224e1511ad353e693961b95b3df652ea07`).
3. Source `drizzle/0106_saas_selfserve_recurring_billing.sql`:
   created the four missing `saas_*` signup/billing tables and three
   indexes (blob `5a32850964ea9589bfee018d6e71af6ec8fa1f82`).
4. Source `drizzle/0110_provider_events_inbox.sql`:
   created `provider_events` with verified FKs and dedupe index
   (blob `b82682917fd1984283fdfd1580bff2449b1178f0`).
5. Source `drizzle/0109_tamper_evident_audit_chain.sql`:
   created `audit_chain_heads`, two audit indexes, three audit functions
   and an enabled mutation-protection trigger on `audit_events`.
   The three required audit chain columns **already existed**, so the
   `ALTER TABLE` statements were omitted from this narrowly scoped clone
   replay. `DROP TRIGGER IF EXISTS` was omitted after verifying no
   preexisting user trigger, and `CREATE OR REPLACE FUNCTION` was made
   strict `CREATE FUNCTION` after checking no collisions. The audit
   sealer was **defined but not invoked**. Blob:
   `b8cf23d83e80822210309e31f6d6c25ff7e0ba07`.

The preparatory DDL is **not** an approved production migration bundle
and must not be copied into the protected APPLY pipeline without separate
DBA review, migration history adoption, checksum receipts and rollback proof.
Historical numbering and existing lineage remain unresolved.

### Read-only observed postflight

| Catalog-only measure | Original recovery branch | Isolated clone |
|---|---:|---:|
| Public ordinary tables | 148 | **156** |
| Valid public foreign-key constraints | 409 | **422** |
| Release canary tables present | Not all | **13 of 13** |
| Release canary columns present | Not all | **11 of 11** |
| Required release unique indexes valid and ready | Not all | **4 of 4** |
| `seal_audit_events(integer)` | Missing | Present |
| `audit_events_protect_mutation` | Missing | Enabled |

Catalog fingerprint comparison of the **148 existing recovery tables**
showed **zero dropped tables and one intentionally changed table**:
`audit_events` gained its reviewed audit indexes and trigger (no column
migration was needed). The other **147 existing table definitions matched**
under the checked column/default/constraint/index/RLS fingerprint. New tables:
`audit_chain_heads`, `compensation_automation_intents`,
`email_change_tokens`, `provider_events`, `saas_billing_checkouts`,
`saas_billing_events`, `saas_billing_state`,
`saas_signup_verifications`.

**Still blocked:** The clone remains missing **119 tables declared in
`src/db/schema.ts`**. Among these, **23** have no `CREATE TABLE`
statement in the historical `drizzle/` SQL corpus and require newly
reviewed migration definitions. Another 96 have historical SQL creator
mentions, **not** evidence that those migrations were applied or are safe
to replay. The tracked original recovery snapshot (148 tables) still
reports its immutable **126** missing declarations; it must not be
silently swapped with this repaired clone.

Structural release canaries passing on a clone do **NOT** verify full
Drizzle-source parity, existing audit-row chain integrity, RLS/privilege
safety, authentication, runtime four-shard regression, government agency
imports, employer payroll reconciliation, bank/payout safety or production
readiness. No original/default branch DDL, customer row-level inspection,
payroll release or filing was performed.
