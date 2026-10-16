# Issue #1113 — First-payroll read-path schema rehearsal (2026-10-16)

**Disposition: ISOLATED SQL/STRUCTURE PASS; NOT A LIVE APP OR PAYROLL ACCEPTANCE.**
**Do not merge this Draft PR into main or apply these archived migrations to the default Neon branch.**

## Recovery from tool interruption

Neon, GitHub and Vercel connectors recovered after prior temporary timeouts. Independently verified:
- Original/default Neon branch: `br-lucky-sound-b79i56jw`, project `calm-wave-70219564`.
- Isolated normal rehearsal branch: `br-mute-mode-b740q5zx` (parent original), database `neondb`.
- Existing actively tested QA branch: `br-green-hat-b77qj8fs` and protected QA preview **left untouched**.
- GitHub draft PR [#1116](https://github.com/erwinmehehe/payrollph/pull/1116) remains unmerged.
- Main advanced from the original audit commit `acf61b1714d73b18930a0ab30d0932860c66fb91` to `a8b01b510ae6a742de01def64244b7615cb12fd1`. This includes a new default-OFF year-end prior-evidence feature and archived migration `drizzle/0127_year_end_prior_evidence.sql`. The prior audit intentionally remains a timestamped snapshot of its original `main` SHA.

## Component-level migration rehearsals (new Neon child branch only)

After the initial six-table recovery rehearsal (see [initial result](./issue1113-isolated-schema-rehearsal-20261016.md)), source-to-catalog inspection showed `employee_compensation_components` missing from the first-payroll GET readers. Inspected archived `drizzle/0126_compensation_governance_forward_repair.sql`, confirmed its eight required parent tables had integer primary keys and its six target compensation tables plus reserved indexes/sequences were absent. On the exact isolated branch, ran **28 guarded statements in one transaction**, including 25 original source statements. Its own structural postflight passed and generated the six compensation tables at their expected column counts (16, 12, 19, 13, 20 and 17). **No existing compensation row or payroll record was modified.**

The next source-vs-Drizzle comparison identified 17 missing columns in five populated-schema/zero-data tables used by the first-payroll readers:
- `de_minimis_grants`: 2 fields, already defined in archived `drizzle/0091_rr29_ot_night_meal_allowance.sql`.
- `employee_loans`: 6 review/authorization fields, already defined in `drizzle/0103_independent_employee_loan_deductions.sql`.
- `benefit_enrollments`: 3 provider fields, already defined in `drizzle/0086_hmo_benefits_automation.sql`.
- `expense_claims`: `submitted_by_user_id`, staged as a [fail-closed branch-specific candidate](../sql/issue1113-expense-claim-actor-review-only.sql); no confirmed archived migration was discovered for this field.
- `year_end_adjustments`: 5 approval/run fields, already defined in `drizzle/0014_year_end_tax_settlement.sql`.

**All five affected tables contained zero rows on both original and rehearsal.** A second **25-statement guarded PostgreSQL transaction** used exact source SQL from the four archived files, followed by the review-only actor-FK candidate and postflight. The archived `0086` includes a historical `UPDATE benefit_enrollments SET effective_on = started_on`; because the table had 0 rows, **zero rows were updated**. It also creates `benefit_dependents` and `benefit_enrollment_events`, both absent before the rehearsal. No application release flag, payroll header, entry, expense approval, attendance cutoff state, or money instruction was changed.

**This source-by-source component test is NOT proof that the entire archived migration history can be replayed safely. No migration receipt, protected cutover, audit ledger, DBA approval or production release was written.** Historical migration order/lineage is still unadopted. Never run `db:push` against the original database.

## Verification against latest `main` source

- `src/db/schema.ts` now declares **271** main tables.
- New rehearsal database now has **148** public tables; **126** main-declared tables remain absent and **3** existing main-declared tables still lack columns (`documents`, `government_filing_validations`, `job_applicants`). This is a targeted payroll path rehearsal, **not full schema parity**.
- Parsed the **actual** `.from()`/`join()` table references in `src/lib/first-payroll-preview.ts` and `src/lib/first-payroll-canonical-preview.ts`, mapping symbols and columns to the latest `main` Drizzle source. All **35/35 direct table/column schemas are now complete** on the new isolated branch.
- Widened inspection to six relevant helper modules including `payroll-engine.ts`, `workforce-timesheet-server.ts`, `workforce-schedule-window.ts`, `workforce-attendance-lock.ts`, `spend-claim-evidence.ts`, and `payroll-retro-source-lookup.ts`. Found **50** table references across this broader static source scan; the only two catalog misses were `expense_claim_evidence` and `expense_category_policies`, which are behind the **Spend payroll release flag**. Code returns legacy claims without querying these tables while the flag is OFF; **this conditional behavior has not been verified in a deployed preview against the new branch**.
- Ran **8/8 non-mutating, read-only SQL shape checks** using `SELECT ... WHERE false LIMIT 0` against actual recovered columns: first-payroll progress, cutoff locks, compensation assignments, de minimis wage basis, loan independent approvals, benefits provider state, expense submitter FK, year-end approval fields. All parsed and executed without a schema/permission error, returning no employee records.

## Preservation proof

After all SQL tests, compared **row-content MD5 aggregates** of the nine original business-data tables against the untouched default Neon branch. **9/9 identical**: `organizations` (1), `org_units` (3), `employees` (8), `employee_pay_profiles` (8), `users` (6), `user_organizations` (6), `payroll_runs` (3), `payroll_entries` (18), and `time_punches` (16). Session-history tables were excluded because they can change independently.

The original Neon database is still 136 public tables and still lacks first-payroll progress and compensation component tables. The active QA branch is not the new rehearsal branch. Neither the original nor active QA had its database credentials, DDL or business records changed by this recovery pass.

## Why real application acceptance is still blocked

**No isolated Vercel database binding for the new branch:** Vercel returned **zero branch-scoped Preview environment variables** for Git ref `qa/issue1113-schema-recovery-review-20261016`. The currently tested Preview connects to a *different* branch. Deploying before binding `DATABASE_URL` and `DATABASE_URL_UNPOOLED` specifically to the new branch could accidentally use inherited or unrelated credentials; **do not deploy a new branch without verifying isolated bindings.** Cred-bearing Neon strings must be moved by an authorized person **directly in Neon and Vercel consoles**, never pasted into issues/chat or shuttled across connector tools. The branch-scoped pooled endpoint must correspond to the NEW rehearsal branch, with unpooled for migrations. Preview-only data/secrets must remain isolated.

Even with database bindings, app GET acceptance remains gated by real authentication and default-OFF first-payroll feature flags. Keep the flag OFF until historical receipts, all affected schema invariants, tenant access, timesheet approval, cutoff locks, and maker/checker conditions are independently evidenced. The original three fictional payroll run headers still disagree with employee-entry totals ([#1102](https://github.com/erwinmehehe/payrollph/issues/1102)).

**New historical source drift:** Current main added `drizzle/0127_year_end_prior_evidence.sql`; the table is still absent on the rehearsal branch. A future post-cutover migration must **not** reuse number 0127, and review PR #1116 must be reconciled/rebased with latest main before any release decision.

## Gate

- **PASS:** Connector recovery; new branch identity; isolated source-backed transactions; **35/35 direct first-payroll reader schema contracts**; **8/8 SQL shape checks**; **9/9 original-record data preservation**.
- **PENDING / NO-GO:** Protected branch-scoped Vercel preview and real logged-in application GETs; full transitive runtime testing; historic receipts/cutover; other 126 missing tables/3 partial tables; review of new source 0127; real payroll reconciliation, browser MFA login, payout and statutory filing.

**No real money movement, government submission, authentication bypass, production migration, or runtime feature-flag activation was performed.**
