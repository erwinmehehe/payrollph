# PayrollPH — fictional development schema repairs and complete-journey acceptance (2026-10-17)

**Environment: development only.** Owner confirms **no customers, no real employee/payroll data, and no live money movement**. A production-class paid backup or AWS configuration is **not** a prerequisite for fictional development. Do not interpret the public site URL or Neon branch name `main` as a real-customer release approval.

## Actual committed database actions (not just planned source)

**Neon source:** project `calm-wave-70219564`, default connected **fictional development** branch `br-lucky-sound-b79i56jw`, endpoint `ep-cool-hat-b7e7gpoo`, database `neondb`, active role `neondb_owner`. No credentials or employee/payroll row contents stored in this report.

Before any modification, catalog had **136 public tables** (and 134 sequences) and the existing fictional aggregates were **1 organization, 8 employees, 3 payroll runs, 18 payroll entries and 6 organization memberships**.

### 1. Attendance and compensation — seven tables

Used exact, already reviewed repository SQL from GitHub `main` (source SHA `9a836564292f89fb364068b8f5a2fa211ad05694`):

| Source SQL | Git blob | Result |
| --- | --- | --- |
| `drizzle/0124_attendance_exception_forward_repair.sql` | `78f05618dd04c4fc1e46551d087a1c4abb60c180` | `attendance_exception_events` restored |
| `drizzle/0126_compensation_governance_forward_repair.sql` | `4818377b29d241e6ec1fcb27b7333085418e4ea4` | All 6 compensation governance tables restored |

**Rehearsal:** on preserved pre-repair Neon clone `br-sweet-wildflower-b7hlzuen`, executed all **33 source statements** and structural postflight checks in a single transaction with an intentional terminal exception `DEV_REHEARSAL_ROLLBACK_ONLY`. Independent re-read confirmed rollback: 136 tables, 134 sequences and **0/7 repaired targets present**. The clone remains an unchanged comparison point.

**Fictional dev apply:** on the exact default branch, applied only those two source files in a single guarded transaction. Identity checks, all source preflights and the two structural postflights passed. The live fictional dev catalog grew to **143 tables** and 141 sequences.

**Independent post-apply metadata:**

| Relation | Columns | Validated FKs | Valid indexes incl. PK | Result |
| --- | ---: | ---: | ---: | --- |
| `attendance_exception_events` | 23 | 5 | 6 | PASS, plus 2 validated CHECKs |
| `compensation_bands` | 16 | 5 | 6 | PASS |
| `compensation_cycles` | 12 | 2 | 3 | PASS |
| `compensation_proposals` | 19 | 8 | 3 | PASS |
| `compensation_components` | 13 | 2 | 4 | PASS |
| `employee_compensation_components` | 20 | 6 | 4 | PASS |
| `compensation_events` | 17 | 7 | 3 | PASS |

### 2. Worksite live-floor read dependency — one column

- Source: `docs/sql/issue-1113-worksite-decision-forward-candidate.sql`, Git blob `88b870fb1b972c76df3087d839318b8907669cf8`.
- Rehearsed *this precise one-DO statement* on the preserved clone in an intentionally rolled-back transaction; verified `decision` remained absent.
- On guarded, exact-branch **fictional development only**, successfully added `employee_worksite_assignments.decision` as `varchar(8) NOT NULL DEFAULT 'allow'`. The guarded SQL checked original column/PK/FK contracts, acquired `NOWAIT` short lock, and verified the final default/nullability. No row DML; fictional worksite assignments = 0.
- **Does not prove authenticated Live Floor 200:** its role/tenant API acceptance remains to be run.

### 3. First-payroll journey progress — one table

- Source: `drizzle/0117_inline_first_payroll_journey.sql`, Git blob `2a1293715609def6a9b7519712afab9b846c1b70`. This is a *single, individually inspected, still-absent source table*, **not** replay of the numbered history. No migration-journal claim was made.
- Isolated rollback-only source rehearsal completed and proved no resulting table on preserved clone.
- On exact fictional dev branch, explicit no-target/no-index and starting-data guards passed; the two source DDL statements committed within one guarded transaction. Re-read confirmed **6 columns, 2 validated FKs, 2 validated CHECKs, 1 valid unique index**, 0 progress records.

### Preserved development state

At the **first repair checkpoint**, the development catalog contained **144 public tables / 141 sequences**; the subsequent reader and WFM corrections are documented in the dated addendum below. Original fictional business-record counts remain **8 employees, 3 payroll runs, 18 payroll entries and 6 memberships**. No employee, compensation, payroll or banking rows were inserted, rewritten or removed by these DDL transactions; no payments or government filings were submitted; no historical DBA execution receipts were invented.

**Important: this is NOT a whole-app schema restoration.** Source AST enumerates **271 distinct `pgTable` names**. The connected database has 144 tables: **130 source-declared tables were still missing at this checkpoint**, with 3 existing `ess_` tables supplied outside the main schema module. Missing remaining groups include HCM lifecycle, work arrangements, WFM governance, performance, payouts and optional enterprise features. Existing tables may also contain column/FK/index drift: table-name parity alone does not prove schema parity. In #1113, `separation_records` had 18 missing fields at prior review. Do not hide the remaining drift or treat a first-payroll table repair as a full release.

## Fresh clean development schema & employer journey CI

This source PR wires this development repair evidence into the **existing** GitHub Actions synthetic acceptance (no duplicate custom payroll test engine):

- [Nine-stage connected development acceptance](../../.github/workflows/nine-stage-connected-acceptance.yml) runs a verified **fresh disposable PostgreSQL 18** schema, with a governed hire, plus PostgreSQL 16 direct/governed and year-end variants. The suite covers Hire → Onboard → Schedule → Clock In → Approve Time → Run Payroll → Review → Release **records (not money)** → Prepare draft filing evidence, role/tenant denials, synthetic mobile checks and no payout/provider execution. **A fresh empty full-source bootstrap does not imply the older connected Neon dev schema has all these tables.**
- [PG18 first-payroll canonical preview parity](../../.github/workflows/issue-993-pg18-preview-parity.yml) builds a fresh isolated current-source schema and compares a five-worker **read-only payroll preview** with the calculated no-release run in PostgreSQL 18. Payment flags stay OFF; canonical preview cannot insert payroll records. These are automated machine tests, not novice-user/manual UAT.
- Both workflows can be triggered by an update to *this exact dev remediation artifact* in PR and main, so source/repair evidence remains coupled to whole-journey regression. A PASS is only to be recorded after **exact-head workflow conclusions** are reported green. A workflow merely queued/started is not PASS.

## Next engineering backlog (without production-backup obstruction)

1. Inspect missing 130 source tables by application feature and actual route SQL dependencies; prefer **fresh disposable full-source schema bootstraps** for new fictional employers rather than blindly replaying overlapping 0001–0129 historical increments into the old database.
2. Prioritize **HCM lifecycle**, **WFM schedule/punch/attendance**, **separation/final-pay**, source audit-chain guard and compensation/benefit readers; add reviewed non-destructive patches only when a specific route needs them and recheck actual FK/constraint signatures.
3. Re-run authenticated fictional owner/HR/payroll/anonymous and cross-tenant GET/UI checks on the connected development app for attendance, Live Floor, compensation and first payroll. A catalog PASS is not an HTTP 200.
4. Complete the 14 WFM scenario UAT and mobile-device onboarding checks as **development UAT**. Record unexecuted items honestly, without claims of independent certification.
5. Before first real customer/real PII or funds, perform separate backup/privacy/financial-movement readiness work; current #907 is **pre-launch deferred**.

**Change boundary:** No reset or branch switch, no `db:push` on the existing connected Neon branch, no bulk DROP/CASCADE, no real customer data, no stored DB credentials, no payout enablement. Original historical migration history still requires authentic reconciliation before any future customer production cutover.

## 2026-10-17 addendum — canonical first-payroll read path and WFM closure (supersedes the earlier checkpoint count)

After the first eight tables were restored, I compared both live source readers (`src/lib/first-payroll-preview.ts` and `src/lib/first-payroll-canonical-preview.ts`) to `pg_catalog`. All **35 direct table dependencies** were present, but **17 source-declared columns across five tables** were absent. The canonical preview also directly selects WFM attendance-cutoff policy and lock tables which were missing.

**WFM additive source restoration** (from exact previously committed source, not historical-receipt replay):
- `drizzle/0033_wfm_schedule_guardrails.sql`, blob `3edb6c1e1913ba8668da2533bb5a14ab3a47d74d` — `workforce_schedule_guardrail_policies`
- `drizzle/0087_wfm_attendance_cutoff_locks.sql`, blob `ae0025eb2d686a61e91e14aeb90a4e513fe14262` — `workforce_attendance_lock_policies` and `workforce_attendance_period_locks`

Rehearsed all six source DDL statements together on isolated pre-repair Neon branch `br-sweet-wildflower-b7hlzuen` with a deliberate `WFM_DEV_EXPECTED_ROLLBACK`, confirming zero new clone tables. The same DDL was then committed to the connected **fictional development** branch under pinned target and record-count guards. **3/3 live structural parity checks passed**: schedule guardrails (10 columns/1 FK/3 indexes), attendance lock policies (6 columns/2 FKs/1 index), period locks (16 columns/3 FKs/3 validated CHECKs/3 indexes). All three tables have zero fictional rows.

**First-payroll reader columns and related benefit definitions** were rehearsed on the unchanged clone with a deliberate `PAYROLL_READER_CLONE_EXPECTED_ROLLBACK` and verified to have left no tables/columns behind. Reused isolated additive DDL from:
- `drizzle/0091_rr29_ot_night_meal_allowance.sql` (`b23408c65c848402f6545698ed8393a7b2c366e3`): 2 `de_minimis_grants` basis fields and index
- `drizzle/0103_independent_employee_loan_deductions.sql` (`0c880a5afce38ad50e401f4db9fa6562fd2a080c`): 6 loan approval fields, independent review CHECK, default and index
- `drizzle/0086_hmo_benefits_automation.sql` (`bec01ceb636e83abf39cb41324d90a666d10b540`): benefit-plan/enrollment field extensions, new `benefit_dependents` and `benefit_enrollment_events` plus indexes. **The archival UPDATE was explicitly excluded** and zero rows existed to backfill
- `drizzle/0014_year_end_tax_settlement.sql` (`cef2eec0b81376328094ed67d05e364d73e36b67`): 5 year-end adjustment fields and indexes
- `docs/sql/issue1113-expense-claim-actor-review-only.sql` (`fe95f9b5187eaff80a2c9e6368b05ba847d2e4f7`): *only* its reviewed `expense_claims.submitted_by_user_id` integer, nullable, `users(id)` FK physical definition was used. Its isolated-only original branch guard was **not replayed or bypassed**; new explicit development project/branch/endpoint and empty-row guards were applied, as documented in the execution record

All six relevant existing business tables had **zero fictional rows** before these additions. The 18 selected DDL statements were applied in one development-only transaction, with checks that original fictional data counts remained **8 employees / 3 runs / 18 entries / 6 memberships**. No payroll/approval/benefit/expense data was updated, inserted, deleted, or moved. Live catalog grew **147 → 149 tables**, due only to the two new benefit relations.

**Current connected fictional dev catalog: 149 regular public tables, 125 source-declared tables still absent (271 source tables minus 146 present names; 3 existing `ess_` relations declared elsewhere).** A fresh source-to-catalog scan confirms **35/35 direct first-payroll preview table names and 505/505 direct model column names present**. This is a *static direct-dependency column-presence check*; it does not certify correct type/FK semantics across every table, transitive helper paths, authenticated 200/403 HTTP behavior, employer-specific values or real payroll readiness.

The actual end-to-end acceptance matrix runs **independently in fresh disposable PG16/18 services** and must be judged by current PR exact-head results, not by claims inferred from this catalog repair. #907 paid/production-grade backup stays deferred pre-launch for fictional development.
