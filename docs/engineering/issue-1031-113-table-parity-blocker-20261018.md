# Issue #1031 — source-shape parity evidence blocker and dated 100-table subset

**CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL**

**Status: INCOMPLETE / DRAFT. Production release NO-GO. Not the requested 113-table audit.**

## Exact pinned repository and absence cohort

- Source branch: `main` at `0921b02ad73475e4eaf76ea6b45f65efc046ce5d`, verified through the connected GitHub API on October 18, 2026. The PR branch was rebased to this exact commit using Git objects with lease verification. A local `git fetch origin main` was attempted but failed because GitHub DNS resolution is unavailable in the isolated container. A GitHub compare from prior inspected main `8263346e4433c7c6699c8df9d3ff6aeae9725c9d` confirms no changes to `drizzle/`, `src/db/schema.ts`, or the #1031 source crosswalk in between; only unrelated payout routes/tests/workflow changed.
- The earlier [#1097 migration-source worksheet](https://github.com/erwinmehehe/payrollph/pull/1097) states **137** production-absent tables and **113** with a numbered migration source, but explicitly says **the individual 137 names were not recorded**. Its production-absence crosswalk field is intentionally blank. Cannot ethically choose 113 names from counts alone.
- A separate [October 17 catalog observation](issue-1198-live-table-catalog-20261017.md) does enumerate **124** missing source tables. Joining that dated named list against [source crosswalk](issue-1031-source-table-crosswalk.csv) at this SHA identifies **100** with numbered SQL and **24** without. These are not current runtime serving-DB facts and not interchangeable with the historical 113.
- The attached [100-row CSV](issue-1031-20261017-named-shape-analysis-partial.csv) therefore records only the separately dated, verifiable cohort. Every row carries exact SHA, sources, `schema.ts` line, evidence tag, classification and blank receipt fields.

## Additional source-only superset: every numbered creator

The full 113-name October 15 catalog membership is not recoverable from the
existing named repository evidence. Instead of choosing 13 names by inference,
the analyzer now also supports **every source-defined table that has at least
one numbered `CREATE TABLE` migration source**. This superset contains the
dated October 17 100-row subset and all historic 113 numbered-source table
definitions that have not been renamed or removed from the present schema.
It does **not** mark each source table absent in production.

The committed [188-row all-numbered-creator evidence CSV](issue-1031-all-numbered-creator-shape-analysis.csv)
covers **every one of the 188 current source tables with a numbered CREATE
source** (not merely the dated 100-table catalog cohort). Static result:
**78 MATCH / 5 DRIFT / 105 UNPARSEABLE / 0 certified MIGRATION_ORDER_RISK**.
These are **source-shape classifications, not historic production absence
identities, runtime schema states or execution receipts**.

The source-only analyzer regenerates both CSVs deterministically, and the
dedicated PR workflow checks the generated output byte-for-byte against both
committed CSVs. The latest exact-head workflow must pass before treating this
handoff as CI-accepted. All **six receipt/disposition fields are blank in all
188 rows**. Each row is tagged
`CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL`.

```sh
node scripts/issue-1031-source-shape-audit.mjs --summary-all
node scripts/issue-1031-source-shape-audit.mjs --write-all
node scripts/issue-1031-source-shape-audit.mjs --check-all
```

**Important distinction:** A source superset removes the code-side coverage
gap but cannot certify which **specific** 113 tables were in the historical
missing-production observation. It never substitutes source table names for
an authenticated historical catalog. No Neon or production access is used.

## Implemented offline analysis (new on draft PR #1221)

The previous 99 UNPARSEABLE classifications reflected the old name-only/source
scanner rather than 99 independently proven malformed tables. The current
offline analyzer records the dated subset as **49 MATCH / 4 DRIFT /
47 UNPARSEABLE / 0 order risk**, and its 188-table creator superset as
**78 MATCH / 5 DRIFT / 105 UNPARSEABLE / 0 order risk**. Both now have
committed generated files, with exact-head verification pending.

- `scripts/lib/issue-1031-ddl-shape-parser.mjs` parses static CREATE TABLE
  and CREATE INDEX SQL, including column type/null/default, inline/composite
  keys and FKs, FK actions, CHECKs, key order, uniqueness and partial
  predicates. Unsupported constructs are explicitly preserved.
- `scripts/issue-1031-source-shape-audit.mjs` combines this SQL reading
  with `scripts/issue-1031-print-schema-manifest.ts` (AST + Drizzle metadata)
  and the existing dated crosswalk. It marks unsupported later ALTER/DROP,
  DROP/ALTER INDEX, duplicate definitions, dynamic SQL and unproved CHECK
  equivalence as unresolved, never silently MATCH. The source order check
  identifies FKs whose numbered prerequisites only appear later.
- `.github/workflows/issue-1031-source-shape-analysis.yml` runs entirely
  on a disposable GitHub runner with **no database credentials**. It runs
  source-only regression tests and normal `npm run lint`, then regenerates both
  committed CSVs and enforces byte-for-byte parity before accepting the PR. A workflow merge or green check is
  not an applied migration receipt.

Reproduction (complete checkout with `npm ci`, with **no DB URL**):

```sh
node --test tests/issue-1031-ddl-shape-parser.test.mjs tests/issue-1031-source-shape-audit.test.mjs
node scripts/issue-1031-source-shape-audit.mjs --summary
node scripts/issue-1031-source-shape-audit.mjs --write
node scripts/issue-1031-source-shape-audit.mjs --check
npm test
npm run lint
```

Do not use `--write` to replace the reviewed CSV until output is
independently reconciled; **none of these commands use production or Neon**.
The historical 113-table cohort still requires a separately preserved exact
137-name catalog attestation. The October 17 100-name cohort is a dated
separate observation, not a substitute.

## Classification (October 17 named 100 only)

| Class | Rows | What can be supported |
| --- | ---: | --- |
| MATCH | 49 | Static source-shape equivalence only; does **not** prove applied SQL or runtime catalog. |
| DRIFT | 4 | One DESC/ASC index difference and three tables lacking composite tenant FKs in source SQL. |
| UNPARSEABLE | 47 | Ambiguous ALTER/conditional CREATE, CHECK constraint name/grammar, dynamic SQL, or unproven final state. |
| MIGRATION_ORDER_RISK | 0 | No safely provable inversion on this dated subset; collision and ambiguous source-order concerns remain flagged separately. |
| **Total** | **100** | **Missing historical 13 names; cannot claim a 113-row classification.** |

**The latest 100-row CSV has 100 distinct names, four source-only differences
and six empty receipt/disposition fields per row.** The 188-row superset
includes 188 distinct numbered-creator names. On a prior commit, tests, lint
and generation succeeded but the dedicated workflow failed because the
all-numbered CSV was missing from Git. That file is now committed. An additional
false-positive `first_payroll_journey_progress.data` default comparison
(`'{}'` versus `'{}'::jsonb`) has been corrected **only for equivalent
empty JSONB constants** and covered by regression tests. Its classification
is now **UNPARSEABLE** owing to unrelated CHECK equivalence uncertainty, not
DRIFT or MATCH. No production database state is inferred.

### Confirmed shape differences

- `benefit_enrollment_events`: two numbered SQL indexes order `created_at DESC`, while the corresponding `schema.ts` indexes default to ASC. This source-only DRIFT appears in the 188-table superset (not the dated 100-table cohort); no migration SQL is changed.
- `automation_event_log`: `drizzle/0081_automation_event_ledger.sql` defines `automation_event_log_org_trigger_occurred_idx` on `occurred_at DESC`. `src/db/schema.ts:5393` uses `index("automation_event_log_org_trigger_occurred_idx").on(table.organizationId, table.trigger, table.occurredAt)` without `.desc()`, giving default ascending order. **DRIFT**. Check the intended order in engineering review; this PR does not propose a fix.


### Additional high-priority tenant-FK discrepancy

`workforce_punch_photo_consents` (`src/db/schema.ts:6048`) and
`workforce_punch_photo_evidence` (`src/db/schema.ts:6066`) declare
**composite `(organization_id, employee_id)` FKs referencing
`employees(organization_id, id)`**, with `ON DELETE CASCADE`.
`drizzle/0120_wfm_punch_evidence.sql` defines only the two individual
`organization_id` and `employee_id` FKs, not either composite tenant
constraint. Source-semantic **DRIFT**. This is a **security review item**;
do not relax tenant scoping, add unsafe runtime fallbacks, or apply
unreviewed SQL. The related `workforce_punch_submissions` FK contract
also requires the latest parser's final CHECK ambiguity resolution.

The former `performance_calibration_policies` NUMERIC default difference
was only a representation difference and is now normalized using the declared
NUMERIC column type. The new `first_payroll_journey_progress.data` JSONB
default normalization is similarly restricted by both the column type and
exact empty-object/array literal, preserving real type or value drift.

### Manual source-only MATCH spotchecks (ten)

The ten rows below were compared against the **raw creating SQL** and complete respective `pgTable` declarations (not solely the earlier name crosswalk), covering columns/type/null/default, PK/unique semantics, FK references/actions, explicit indexes including predicates, and CHECK bodies where present. The first independent parser/Drizzle run classified **all ten as MATCH**, with no direct later table/index DDL detected for them. Each has the required tenant ownership column.

These are **MATCH for the explicitly requested source-level structural dimensions**, not evidence of real applied SQL, data integrity, live tenant authorization, generated implicit constraint-name parity, or RLS effectiveness. The latest parser head still needs its own green CI before that classification is accepted as a completed handoff. No migration SQL was executed.

| Table | Numbered source | `schema.ts` | Columns | FKs | Named indexes | CHECKs |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `treasury_control_policies` | `drizzle/0072_treasury_separation.sql` | 5257 | 8 | 3 | 0 | 0 |
| `treasury_operator_assignments` | `drizzle/0072_treasury_separation.sql` | 5268 | 7 | 3 | 2 | 0 |
| `hcm_skills` | `drizzle/0053_hcm_capability_wfm_eligibility.sql` | 4168 | 11 | 2 | 2 | 0 |
| `compensation_automation_intents` | `drizzle/0100_compensation_automation_intents.sql` | 5675 | 15 | 3 | 3 | 1 |
| `integration_connectors` | `drizzle/0078_slack_connector.sql` | 1522 | 12 | 2 | 2 | 1 |
| `external_identities` | `drizzle/0044_enterprise_identity_automation.sql` | 5136 | 8 | 3 | 2 | 0 |
| `identity_domains` | `drizzle/0044_enterprise_identity_automation.sql` | 5118 | 8 | 2 | 2 | 0 |
| `worksite_geofence_boundaries` | `drizzle/0111_wfm_geofenced_web_bundy.sql` | 209 | 6 | 2 | 1 | 1 |
| `payroll_underpayment_requests` | `drizzle/0101_reviewed_payroll_underpayments.sql` | 1887 | 19 | 7 | 2 | 3 |
| `performance_cycle_templates` | `drizzle/0076_performance_structure_controls.sql` | 3436 | 7 | 3 | 2 | 1 |
**Ten source-only MATCH rows were hand spotchecked against the raw SQL and schema.ts for the requested dimensions.** A production-schema parity audit, database receipt verification, and historical 113-cohort completion are **NOT** thereby satisfied.

## Needs human decision and acceptance steps

1. Recover the **actual dated and authenticated 137 table names** from preexisting authorized catalog evidence, with verified target/role/date and original source SHA. Only then derive the exact **113** by a deterministic crosswalk join; do not use a new Neon/production query for this task.
2. Use or extend a **reliable PostgreSQL semantic source parser**, plus the existing AST/Drizzle metadata manifest, to compare final-state column types/null/defaults/identity, primary and unique constraints, FKs (name/reference/update/delete actions), indexes (method/key-order/unique/predicate), CHECK expressions, later ALTER/RENAME/DROP, tenant-scoping and RLS/policies. Mark dynamic DO blocks, conditional procedures and unsupported expressions `UNPARSEABLE`, not `MATCH`.
3. Reconcile duplicate numeric prefixes (13 collision groups), baseline-only prerequisites, historical files and SQL sequencing **without assuming numbered migration execution or fabricating a canonical receipt**.
4. Independently review the `automation_event_log` DESC-vs-ASC finding. Do not silently normalize sort direction.
5. Produce exactly 113 classification rows **only once membership is attested**; perform the required 10 genuine-MATCH manual spotchecks against raw SQL and `schema.ts`, and run full repository tests and lint on any added tools. The offline analyzer, tests, workflow and generated CSVs are now included on this draft branch.
6. Maintain #1075/#1090/#1097 tenant, provenance and protected catalog guardrails. No production/Neon connectivity, SQL execution, deployment, permissions modifications, runtime flags, data repair or migration files have been touched.

### Verification limitations

Both generated CSVs have been inspected for unique table names, source SHA,
valid `schema.ts` line references, the catalog-only tag, and six blank
receipt/disposition fields per row. Source-only GitHub runner tests and lint
passed on an earlier parser head, but the latest commits require their own
successful exact-head CI, including byte-for-byte CSV checks. Local
container-based repo tests were unavailable because direct GitHub DNS/fetch
failed; no unverified CI pass is claimed. This PR remains **draft** and
production release remains **NO-GO**.

**CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL**
