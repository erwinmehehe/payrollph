# PayrollPH recovered Neon: read-only catalog evidence and recovery controls

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

**Scope:** Cloned the existing recovery development branch `br-mute-mode-b740q5zx`
into a newly created, unprotected/non-default Neon rehearsal branch
`br-twilight-shape-b70olxgv`. This retains the source branch's existing state
inside the Neon project; **it is not a sanitized or fictional archive** and
must not be exported or used for unrestricted testing with application rows.
The default Neon and original recovery branches were not modified.

- Initial schema-only catalog check: 148 public tables; absent
  `compensation_automation_intents` and `email_change_tokens`; all three
  intent parent tables had single-column integer primary keys and there
  were no leftover intent objects.
- Applied the source-reviewed DDL shape from
  `drizzle/0100_compensation_automation_intents.sql` inside **one atomic
  DO block on the isolated clone only**, with strict missing-object and
  parent-PK preflight, a short lock timeout and postflight assertions.
  Historical `IF NOT EXISTS` guards were deliberately replaced with
  strict CREATE statements inside the guarded rehearsal block.
  Source blob: `159ed09ffc1834c15f2d68e9e62bb0348951c165`.
- Applied the already documented additive
  `docs/sql/issue-retention-email-change-tokens-additive-candidate.sql`
  solely to the same isolated clone after read-only table/parent preflight.
  Source blob: `d7db76224e1511ad353e693961b95b3df652ea07`.
- Verified the isolated clone reached **150 tables / 413 FKs**, with 15
  intent columns and three validated intent FKs (including validated
  event cascade), seven token columns and one validated token FK.
- Independently rechecked the original recovery branch: **148 tables**.
  A read-only comparison of table column declarations, defaults,
  constraints, indexes and RLS flags found exactly two additional tables
  on the isolated clone and **zero modified or removed shared tables
  among the original 148**. These fingerprint comparisons do not cover
  data rows, functions, triggers, privileges or application behavior.
- No original/production branch DDL, customer-row query, payout operation,
  government filing, raw schema export or migration-receipt fabrication.

**Residual blocker:** This is a real recovered-state *branch copy* rehearsal
for two missing objects, not a full actual recovered-schema **sanitized**
regression. The cloned state still lacks **124 of the 271 source-declared
tables**, not counting other schema drift. It is not a production-ready
migration, historical prefix adoption or approval to apply these statements
to the original branch. Full schema validation, historical DBA sign-off and
independent employer/payroll acceptance remain mandatory.
