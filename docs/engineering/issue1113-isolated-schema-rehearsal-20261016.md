# Issue #1113 — Isolated Neon schema rehearsal (2026-10-16)

**Outcome: PASS for the narrow six-table/86-column structural rehearsal.**
**NOT a production migration, historical migration-receipt adoption, global schema parity result, payment release, or application-endpoint acceptance.**

## Explicit user authorization and Neon capacity

The owner approved retiring **one inspected, unused test branch** to free a slot, subject to inspecting its safety. An attempted separate branch in the previous audit was blocked at 10/10.

After inspection, retired:
- Name: `payrollph-spend-a4-qa-20261012`, id `br-sparkling-breeze-b7ard2ob`.
- It was a non-default/non-protected branch; had no children, no external active PostgreSQL client sessions, no recorded table DML in `pg_stat_user_tables`, and **0** spend/expense claim and policy rows. The GitHub code/issues searches did not find an exact branch-ID or name reference.
- **This deletion removes that old branch's independent branch state.** It was not a backup/restore operation; no claim is made that `pg_stat_user_tables` is a complete audit log. The deletion was done only under the owner's explicit consent and did not involve main or active QA.

Created a fresh **normal** Neon branch from default `main`:
- Project `calm-wave-70219564`, new branch **`br-mute-mode-b740q5zx`**, name `payrollph-schema-recovery-rehearsal-20261016`.
- Parent `br-lucky-sound-b79i56jw` (default). Connected directly to this exact branch with Neon MCP. The new branch is NOT the existing Vercel active QA branch `br-green-hat-b77qj8fs`.
- Preflight session metadata attested project/database/branch identity. Preflight cloned data: 1 employer, 8 employees, 3 payroll runs, 18 payroll entries, 16 punches, **0** separation records and **0** worksite assignments, 136 public tables.

An initial request for a custom suspend interval was rejected (Neon HTTP 412) with **no branch created**; retry with default account compute settings successfully created the intended branch. No paid plan upgrade requested.

## Tested exact source SQL — one transaction

**Main source SHA (frozen):** `acf61b1714d73b18930a0ab30d0932860c66fb91`.

Existing historical source SQL was used directly for a **component-level isolated contract rehearsal**, not to claim the history ran on production:

| Existing SQL source | Parsed statements | Purpose |
|---|---:|---|
| `drizzle/0033_wfm_schedule_guardrails.sql` | 2 | Schedule guardrail policy table and index |
| `drizzle/0087_wfm_attendance_cutoff_locks.sql` | 4 | Attendance lock-policy and period-lock tables, indexes and checks |
| `drizzle/0102_final_pay_maker_checker.sql` | 8 | Three separation reviewer/releaser actor IDs, FK references, identity checks and index |
| `drizzle/0117_inline_first_payroll_journey.sql` | 2 | First-payroll progress and unique index |
| [Review-only candidate](../sql/issue1113-postcutover-schema-gapfill-REVIEW_ONLY.sql) | 4 | Additional 15 separation fields and worksite allow/deny decision; SQL pre/postflights |

An additional set-local lock timeout, statement timeout, and isolated-branch/data preflight comprised the other **3 statements**, for **23 statements in one atomic PostgreSQL transaction**.

Candidate's intentionally unreplaced placeholder `__NEW_ISOLATED_NEON_BRANCH_ID__` was filled **in memory only** with `br-mute-mode-b740q5zx` when rehearsing. The source file remains fail-closed, unexecuted by automatic CI, unnumbered, and **not merge-ready as a production migration**.

**Actual Neon transaction result:** all 23 statements succeeded and committed on `br-mute-mode-b740q5zx`. No historic receipt or cutover row was inserted; no disbursements, payroll calculations, tax submissions, app startup `db:push`, or default/active-QA database writes.

## Independent read-only structural postflight

Ran [the six-table/86-column public catalog contract](../sql/issue1113-focused-schema-contract-READ_ONLY.sql), sourced from current main, against the new branch and original default:

| Catalog assertion | Original default | New rehearsal |
|---|---:|---:|
| Six target tables + 86 expected column objects = 92 assertions | **31/92 present** | **92/92 present** |

All **six** focus relations have their declared column counts after rehearsal:
- `employee_worksite_assignments`: 10 columns (including non-null `decision varchar(8) DEFAULT 'allow'`);
- `first_payroll_journey_progress`: 6 columns;
- `separation_records`: 38 columns;
- `workforce_attendance_lock_policies`: 6 columns;
- `workforce_attendance_period_locks`: 16 columns;
- `workforce_schedule_guardrail_policies`: 10 columns.

Postflight also inspected **28** existing FK/PK/unique/check constraints across those six tables, all reported **validated**. Confirmed required unique/index names: `first_payroll_journey_tenant_step`, `separation_records_org_status_idx`, `workforce_attendance_period_locks_active_idx`, `workforce_attendance_period_locks_period_unique`, and `workforce_schedule_guardrail_policy_org_idx`. Selected decimal type/scale, nullability, boolean default `false`, allowed lock statuses, data JSONB `'{}'`, and worksite decision `'allow'` were also verified from `information_schema`.

This is structural contract evidence only: no signed-in Vercel app requests were routed to the **new** branch, and it does not constitute a full constraints/permission/functional UAT of every table.

## Original-data preservation proof

After the rehearsal, separately queried original/default and new rehearsal branches with database-side MD5 row-content fingerprints (returned only booleans/counts; **not raw names, payroll amounts or secrets**). All **9/9 original business-data table row sets matched exactly**:

| Table | Original | New branch | All original row-content fingerprints equal |
|---|---:|---:|---|
| `organizations` | 1 | 1 | YES |
| `org_units` | 3 | 3 | YES |
| `employees` | 8 | 8 | YES |
| `employee_pay_profiles` | 8 | 8 | YES |
| `users` | 6 | 6 | YES |
| `user_organizations` | 6 | 6 | YES |
| `payroll_runs` | 3 | 3 | YES |
| `payroll_entries` | 18 | 18 | YES |
| `time_punches` | 16 | 16 | YES |

The isolated branch DDL did not change these records. Session history is not included because it changes independently on default main. No data reset.

## Explicit remaining release blockers

1. **Historical DBA adoption/receipts not reconciled.** Main has duplicate historic migration prefixes and no adopted forward-only migration cutover. This test **must not be recorded as applied-production history** or treated as authority to run a folder-wide migration. The existing files are already historical sources and must not be duplicated.
2. **Broader schema parity remains incomplete.** The separate audit found 270 tables declared in `src/db/schema.ts`, with **137 missing** from default and 11 present-but-partial tables. The six targets here are only a first critical slice. Other Drizzle schema files exist.
3. **Application-route migration acceptance on the NEW branch not executed.** The existing Vercel QA preview is bound and hard-attested to `br-green-hat-b77qj8fs`. No database credentials were transferred and its environment was not retargeted to `br-mute-mode-b740q5zx`; setting up an **independently scoped new preview** is a separate task.
4. **First-payroll release flags remain OFF**; 0117 table availability alone does not prove approved timesheet/cutoff logic or unlock payroll. Original demo run header/detail mismatches in [#1102](https://github.com/erwinmehehe/payrollph/issues/1102) remain.
5. Production migration, payroll money movement, government filing, real browser/MFA sign-in, and complete 14-scenario WFM acceptance **NOT PERFORMED**.

**Gate:** PASS isolated focused SQL structure and original-data preservation; **NO-GO** historical receipt adoption, production schema deployment or payroll go-live. Independent DBA review, full migration graph reconciliation, broader schema remediation and app acceptance still required.

Related [issue #1113](https://github.com/erwinmehehe/payrollph/issues/1113), [review draft PR #1116](https://github.com/erwinmehehe/payrollph/pull/1116), [QA acceptance #1061](https://github.com/erwinmehehe/payrollph/issues/1061).
