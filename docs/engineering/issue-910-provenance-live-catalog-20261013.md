# Issue #910 — source provenance and live catalog delta (read-only checkpoint)

**Date:** 2026-10-13; **observed database UTC:** 2026-10-13 05:01:15.387; **repository baseline:** `main@cd7693c0131b2e0da633b1ed19b14828c6e346f8`.
**Disposition: BLOCKED for 0121 and any live migration.** This is a source-only engineering evidence report, not DBA authorization, a database migration, a backfill, or a recovered historical receipt. No credentials, statutory identifiers, employee details, bank accounts or raw payroll records were retrieved.

## Scope and exact target

Connected Neon project `calm-wave-70219564`, DB `neondb`, original default branch `br-lucky-sound-b79i56jw` named `main`; PostgreSQL `18.6 (c021049)`. The default branch remains `default=true`, `protected=false`. Use the explicit branch ID and project ID in every read-only check: never infer a database from the branch display name.

At inspection, the branch held **116 public tables**, **1 tenant**, **1 legal entity** (1 active PRIMARY), **8 employees**, **3 payroll runs**, **18 payroll entries**, **3 org units**, **0 workforce plans**. These are aggregate structural counts, not payroll/filing release evidence.

### New catalog drift since #921

Previous `#910/#921` read-only default-branch checkpoint recorded **113** public tables. The currently observed 116 differ by three additional ESS relations:

- `ess_employee_photos`
- `ess_identifier_requests`
- `ess_other_identifiers`

The branch-name set comparison with the older nondefault migration lab `br-aged-mouse-b7tipaw5` (125 tables) found those three plus `statutory_remittance_correction_requests` present **only on current default relative to that lab**. The former 113-versus-112 difference is the latter statutory correction table. The lab additionally has `worker_employment_events` and `provider_events`, but those are **absent** on production default. Differences between independent branch snapshots are **not chronological DDL receipts** and cannot identify who ran SQL, when it ran, or which Git revision was used. Separately reconcile the new ESS tables with their source/deployment provenance; do not replay ESS DDL to resolve #910.

Compared with nondefault `br-weathered-term-b7ztb2ki` (114 tables), current default alone has the three ESS relations plus the statutory correction table, while that branch alone has `first_payroll_journey_progress` and `workforce_roster_rule_policies`. No nondefault branch is an authorized protected clone or proof that changes were applied to default.

## Required predecessor status (fresh SELECT-only results)

| Proposed historical source | Expected object(s) | Default catalog status | Historical execution proof |
| --- | --- | --- | --- |
| 0022 | `job_profiles`, `positions`, `position_assignments` | **ABSENT** | **UNPROVEN** |
| 0022 | `workforce_plans` | **PRESENT**, 0 rows; 11 columns, original unique + status indexes | **UNPROVEN** |
| 0050 | `worker_employment_events` | **ABSENT** | **UNPROVEN** |
| 0051 | `job_families`, `job_levels`, `job_grades` | **ABSENT** | **UNPROVEN** |
| 0052 | `worker_effective_changes` | **ABSENT** | **UNPROVEN** |
| 0110 | `provider_events` | **ABSENT** | **UNPROVEN** |
| 0112–0114 | demand imports/revisions, forecast issues/scores, staffing policies/events | **ABSENT** | **UNPROVEN** |
| 0115–0116 | `payout_profiles`, `payout_batches`, `payout_transfers` | **ABSENT** | **UNPROVEN** |
| 0120 | punch photo evidence and submissions | **ABSENT** | **UNPROVEN** |
| 0121 | `user_legal_entity_grants`, `employee_entity_assignments`, `entity_transfer_requests` | **ABSENT** | **UNPROVEN** |
| Additional registration source | versioned change requests and approved registration history | **ABSENT** | **UNPROVEN** |

A catalog scan for names containing `migrat`, `receipt`, `journal` and schema `drizzle` returned **zero matching relations**. This does not prove an external migration audit system never existed. Authentic release/executor/SHA-256 records remain **unavailable from this evidence**.

### Existing schema guard observations

- `workforce_plans` already exists with expected columns and `workforce_plans_org_name_dates_unique`, `workforce_plans_org_status_idx`, and its primary-key index. A new predecessor proposal must preserve it rather than replace it.
- `org_units` has the existing current-entity and effective-date fields used by later sources. Existing `org_units` index catalog exposes only the primary key, so don't infer missing 0051 index/constraint application from columns alone. Compare exact 0051 definitions and check tenant-scoped duplicate keys **before** any review-approved ALTER/INDEX, not during a live blind replay.
- `statutory_remittance_correction_requests` shows 18 columns and the primary key plus three named indexes. The visible structure is consistent with source `drizzle/0026_statutory_remittance_corrections.sql`, but is not proof that 0026 was executed in full or at a particular time.

## Source SHA-256 reproducibility

Run `node scripts/issue-910-source-manifest.mjs` at the **exact reviewed Git commit**, or `node scripts/issue-910-source-manifest.mjs --json`. It hashes **file bytes**, not normalized text, for the canonical source list (historical 0022/0050/0051/0052/0110/0112–0114; proposed 0115–0121; and review-only predecessor/tenant-guard candidates). The manifest's `production_applied` field is **UNPROVEN for every entry**. Git blob SHA is not an interchangeable SHA-256 checksum and Git file presence never certifies migration execution. Capture the source commit SHA, each full path, hash and immutable CI artifact in the actual DBA change record when available.

## What can be done next without modifying Neon

1. Recover authentic deployment/DBA/transaction source-path and SHA-256 evidence from an independently retained system, or record `UNPROVEN` permanently for missing historical receipts. Do **not** create retroactive `applied` records.
2. Compare 15 missing predecessor relations, existing workforce plan, org unit constraints, and the three new ESS tables to the proposed additive `docs/sql/issue-910-review-only-forward-predecessor.sql`. Prepare a **new forward-only** number only after DBA determines the canonical noncolliding slot; exclude both the old 0050 employee-current-employer UPDATE and old 0051 taxonomy INSERT/UPDATE mappings.
3. Reuse merged #921 tests for source statement reconstruction, PG16/18 idempotent replay, duplicate tenant/entity denial and full transaction rollback. Add only new negative cases for catalog drift or external receipt handling.
4. Reconcile incident #899's default-branch/endpoints, request/write impact and retained logs. The historical application-log window is unavailable in Vercel Hobby runtime retention; state `UNKNOWN` rather than fabricate no-loss evidence.
5. Obtain approved clone capacity and privacy-safe restore plan. Neon project Free plan reports **10/10 branches**, six-hour history and an unprotected default. Do not delete a branch, restore a snapshot, change routing, run DDL, seed production-like data or enable flags without explicit operator/DBA authorization. The #899 accidental `finalize=true` restore is a hard stop.

## Decision matrix

| Question | Answer |
| --- | --- |
| Are the exact canonical migration source bytes identifiable? | **YES**, via source-only SHA-256 manifest at reviewed commit |
| Can live schema presence/absence be described? | **YES**, aggregate catalog checks above |
| Are historical 0022/0050/0110/0114 executions authenticated? | **NO — UNPROVEN** |
| Is the 116-table drift attributed to a release actor/transaction? | **NO — only new object names are identified** |
| Can 0121 or old historical backfills run on production? | **NO — BLOCKED** |
| Is a protected, privacy-eligible clone and witnessed restore approved? | **NO — NOT VERIFIED** |
| Are employer service continuity, tax/13th-month, loans and backfills approved? | **NO — PENDING legal/payroll/DBA review** |

**No migrations were run or applied by this report. Keep #910 OPEN, #860 Draft and multi-entity/payout flags OFF.**

## Re-run catalog probes (SELECT only)

```sql
SELECT current_database() AS database_name, current_setting('server_version') AS pg_version,
       now() AT TIME ZONE 'UTC' AS observed_utc,
       (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public') AS public_tables,
       to_regclass('public.worker_employment_events') AS worker_history,
       to_regclass('public.employee_entity_assignments') AS current_entity_assignments,
       to_regclass('public.provider_events') AS provider_inbox;
SELECT schemaname, tablename FROM pg_catalog.pg_tables
 WHERE schemaname='public' AND
 (tablename LIKE 'ess_%' OR tablename LIKE 'worker_%' OR tablename LIKE 'payout_%')
 ORDER BY tablename;
SELECT n.nspname, c.relname FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m') AND
 (c.relname ILIKE '%migrat%' OR c.relname ILIKE '%receipt%' OR c.relname ILIKE '%journal%' OR n.nspname='drizzle')
 ORDER BY n.nspname,c.relname;
```
