# Issue #1113 — Schema recovery audit and rehearsal gate (2026-10-16)

**Post-audit update (2026-10-16):** Following explicit owner approval and unused-branch inspection, a free Neon slot was recovered and new isolated branch `br-mute-mode-b740q5zx` created from the original default. A **23-statement, transactionally executed focused schema rehearsal** succeeded on the NEW branch, and the six-table/86-column contract passed **92/92** there; nine original-data table fingerprints still match. See [actual isolated rehearsal evidence](./issue1113-isolated-schema-rehearsal-20261016.md). This original audit's 10/10 branch-capacity blocker records the state **before** this later action. No production migration or historical receipt adoption occurred.

**Status: REVIEW-ONLY. NOT MIGRATED. NOT PRODUCTION-APPROVED.**
**Prepared from exact GitHub `main` commit:** `acf61b1714d73b18930a0ab30d0932860c66fb91`.

## Scope and hard safety boundaries

- Neon project `calm-wave-70219564`, original/default branch `br-lucky-sound-b79i56jw` (unchanged), existing active QA branch `br-green-hat-b77qj8fs` (unchanged by this audit).
- No application secrets retrieved or copied. No production or existing QA DDL/DML performed. No real money movement, filings, payroll calculations, or release-flag changes.
- All observations are **read-only catalog SELECTs**. This report excludes every employee's PII, payroll amount and database credential.
- This *source-review* Git branch originates from current main, NOT from the active QA branch; temporary QA authorization test endpoints are deliberately NOT imported.

## Snapshot-level schema comparison

From `src/db/schema.ts` at the reviewed main SHA, 270 `pgTable` definitions were identified. Compared with `information_schema.columns` and presence in `public` on both Neon branches:

| Finding | Original/default branch | Existing isolated QA branch |
|---|---:|---:|
| Public relations with column information | 136 | 147 |
| Declared main tables missing on original | **137** | — |
| Existing main-declared tables with missing columns on original | **11** | — |
| Selected focused contract objects that exist | **31 / 92** | **43 / 92** |
| `separation_records` columns | 20 / 38 | 20 / 38 |
| `employee_worksite_assignments.decision` | Missing | Present from previous QA-only rehearsal |

**Scope caveat:** 270 refers to tables in `src/db/schema.ts` alone; the full Drizzle configuration also includes `ess-profile-schema.ts`, `saas-billing-schema.ts` and `workforce-schedule-receipt-schema.ts`. This is NOT a comprehensive certify-ready migration receipt or a complete diff of every constraint/index. Missing tables span multiple non-payroll modules, so repairing six table contracts does **not** certify the entire current application schema.

The reproducible [read-only catalog contract](../sql/issue1113-focused-schema-contract-READ_ONLY.sql) checks exactly **6 tables and 86 expected columns**, sourced from this main commit. It was actually executed on original and existing QA. No source data was updated.

## Historical migration ownership — do not duplicate

| Scope | Already tracked in main | Original Neon state |
|---|---|---|
| Workforce schedule guardrail policies | `drizzle/0033_wfm_schedule_guardrails.sql` | Missing |
| Attendance cutoff policies + period locks | `drizzle/0087_wfm_attendance_cutoff_locks.sql` | Missing |
| Final-pay preparer/checker/releaser identity columns | `drizzle/0102_final_pay_maker_checker.sql` | Missing (3 of 18 separation columns) |
| First payroll journey progress | `drizzle/0117_inline_first_payroll_journey.sql` | Missing |

**CRITICAL:** `drizzle/README.md` and `docs/engineering/reviewed-migration-runner.md` explicitly warn that historical SQL is NOT a straightforward numbered sequence. There are duplicate historic prefixes, no `drizzle/meta/_journal.json` and no fully adopted historical receipts. No `payrollph_migration_cutover` or `payrollph_schema_migrations` table was found on the original branch. An object being absent does not authorize replay of one historical SQL file while bypassing the dependency/receipt chain. **Do not invent a 0127 migration to paper over unapplied 0033, 0087, 0102 or 0117.**

## Additional post-history schema delta — source candidate only

[Fail-closed gapfill candidate](../sql/issue1113-postcutover-schema-gapfill-REVIEW_ONLY.sql) covers:
- `employee_worksite_assignments.decision` as `varchar(8) NOT NULL DEFAULT 'allow'`;
- **15** final-pay schema fields that are absent and are not the 3 stable actor ID columns already owned by historical 0102;
- structural postflight and a preflight requiring the four historical migration tables, stable branch identity, and **zero existing separation records** so historic final-pay amounts are not fabricated by default-zero columns.

On the original Neon branch, both `separation_records` and `employee_worksite_assignments` currently have **0** rows; this is a verified preflight fact, not authorization to migrate. The SQL includes the intentionally unreplaced branch marker `__NEW_ISOLATED_NEON_BRANCH_ID__`. It **cannot run** against original `main`, the existing active QA branch or an arbitrary target. It is in `docs/sql`, not numbered `drizzle/`, by design. It must be independently reviewed, adapted to the future adopted cutover, and eventually promoted to a new uniquely numbered post-cutover file only if still required.

## Independent Neon migration rehearsal — BLOCKED by branch quota

Attempted `create_branch` with:
- project `calm-wave-70219564`;
- **parent original/default** `br-lucky-sound-b79i56jw`, read-write normal branch;
- new name `payrollph-schema-recovery-rehearsal-20261016`;
- minimum 0.25 CU / maximum 1 CU / 300-second suspend timeout.

Neon refused with **HTTP 422: `branches limit exceeded`**. The project currently has 10 branches (10/10), so a fresh independent test branch cannot be created without recovering a slot or increasing the plan limit. Existing branches have important rehearsal states and fixtures. **None was deleted, reset, overwritten, or repurposed.** A human project owner must explicitly approve retiring a specific safely backed-up obsolete branch; do not infer an arbitrary branch is disposable from its name.

**Consequently, no migration SQL was executed and no rehearsal-branch/app-runtime acceptance can be claimed.**

## Further blockers and follow-ups

1. Have a DBA/release owner reconcile full migration history, schema lineage, per-file checksums/receipts, and historical cutover before using the reviewed runner. **Never run a folder-wide replay or `db:push` against the original/default Neon branch.**
2. Obtain branch capacity or explicit approval to retire one *identified* existing branch after verifying the data can be discarded. Create a **new normal branch from original**, then verify branch ID before any rehearsal DDL.
3. On the new branch, follow the independently approved historical dependency/receipt reconciliation. Rehearse the missing historical SQL (0033, 0087, 0102, 0117 only as permitted by the reconciled history) and then the reviewed post-history delta, with the new branch marker substituted. The candidate's preflight should fail if this order or the target is wrong.
4. Run [read-only schema contract](../sql/issue1113-focused-schema-contract-READ_ONLY.sql), FK/check/index/default checks, and original-data row-content fingerprints after rehearsal; all modifications must remain confined to the new branch.
5. Test application GETs against the *new* branch with separately provisioned branch-scoped Preview configuration. Do not change existing active QA or Production `DATABASE_URL` keys. The current Vercel QA health attestation is pinned to the **older** isolated QA branch; it cannot prove anything about a new branch without controlled configuration.
6. Keep payroll-related release flags and payment/filing pathways disabled. Fix the **three original fictional payroll header/detail centavo discrepancies** at seed source ([#1102](https://github.com/erwinmehehe/payrollph/issues/1102)); don't edit original records to make acceptance pass.
7. Address the other **137 missing main-declared tables and 11 partial tables** with module owners and migration history. This focused recovery candidate does not imply whole-platform launch readiness.

## Gate decision

- **PASS:** Read-only historical schema inventory and focused catalog contract; source-controlled guarded SQL draft; original/database safety.
- **BLOCKED:** Creating the independent Neon branch (10/10 limit); applying/rehearsing SQL; migration receipts/adoption; new-branch app/runtime tests.
- **NO-GO:** Production migration, enabling first-payroll release flags, real payroll/payment/filing acceptance.

Related: [#1061](https://github.com/erwinmehehe/payrollph/issues/1061), [#1113](https://github.com/erwinmehehe/payrollph/issues/1113), [#1102](https://github.com/erwinmehehe/payrollph/issues/1102).
