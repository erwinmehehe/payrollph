# #1113 — Worksite decision column: source reconciliation and guarded candidate

## Current follow-up — 2026-10-17

The numbering hold described below is superseded: #1136 merged as
`f49ea7a4a9c58cf88f437913f82aeb55f9d4fd47`. The exact candidate DO body is
promoted into `drizzle/0130_worksite_assignment_decision_forward.sql` with
updated header comments only. The PostgreSQL rehearsal now executes **0130**;
the original unnumbered file remains a historical review artifact.
`0131_separation_record_forward_repair.sql` separately addresses the 18
separation-column omissions. See `issue-1113-separation-forward-plan.md` for
the catalog inventory, route impact, defaults, maker/checker and rollback.
Source merge can proceed after current-head checks. Production execution is
still a separate protected action; #899/#907 and genuine target/receipt gates
remain unverified. Statements below about draft #1136 and a reserved 0129
describe the earlier candidate stage, not the current source merge status.

**Status:** Source-only, unnumbered, NOT applied. The objective is to repair a reproducible PostgreSQL schema mismatch without weakening tenancy, replaying historical SQL or changing money records.

## Proven source-level root cause

- Current `src/db/schema.ts` defines `employeeWorksiteAssignments.decision` as `varchar(8) NOT NULL DEFAULT 'allow'`.
- Historical `drizzle/0023_workforce_worksites.sql` creates `employee_worksite_assignments` **without** that column. It defines the target's integer PK, org/employee/worksite foreign keys, dates, defaults and indexes.
- `drizzle/0058_hcm_worksite_authorization_decisions.sql` adds a `decision` field to **`hcm_worksite_authorizations`**, a different relation. It does not repair the older worksite assignment table.
- Issue [#1113](https://github.com/erwinmehehe/payrollph/issues/1113) records a former isolated QA branch where adding the expected field restored authenticated Live Floor 200. This PR does **not** repeat that live/QA connection or independently confirm today's production column inventory.
- The `GET /api/workforce/live-floor` route performs a Drizzle `select().from(employeeWorksiteAssignments)`: Drizzle selects its declared `decision` column, so an older relation missing it can raise PostgreSQL 42703 even where the route does not use decision for its response. There may be *additional* production route dependencies; this source fix is not a system-wide release proof.

## Why this SQL is not numbered yet

The source-control migration guard in `scripts/check-sql-migration-history.mjs` requires **unique, contiguous** numbers after current `drizzle/0128_*`. [PR #1136](https://github.com/erwinmehehe/payrollph/pull/1136) already proposes `drizzle/0129_non_recovery_fk_names_forward.sql` and expressly remains **DRAFT / NO-GO** pending #1154's 51 synthetic catalog dispositions and independent DBA/security acceptance.

Issuing a competing `0129` or skipping to `0130` now would undermine the guard. Therefore the guarded exact SQL is retained at `docs/sql/issue-1113-worksite-decision-forward-candidate.sql`, **not** in the live numbered train. A separate reviewed PR can promote the exact reviewed logic into the **next free contiguous number** after the current numbering conflict is resolved, obtaining a new checksum and actual migration receipts before any protected APPLY.

Do not rename, replay or rewrite `0023`, `0058` or any already committed migration.

## Candidate safety and limitations

The SQL consists of a **single PostgreSQL DO statement**: it finds the exact persistent public worksite-assignment table; takes an immediate `ACCESS EXCLUSIVE ... NOWAIT` lock; checks existing column contracts, the integer primary key and validated org/employee/worksite foreign-key deletion semantics; rejects any preexisting `decision` field (including a correct-looking one without a receipt); adds **only** `decision varchar(8) NOT NULL DEFAULT 'allow'`; and checks its exact type, nullability and default after the ALTER.

It has no row UPDATE/backfill, no INSERT/DELETE, no GRANT, no other table DDL and no automatic compatibility fallback. Existing authorizations acquire the documented `allow` default through PostgreSQL's constant-default column addition. That policy is inherited from the current Drizzle source: **do not introduce a different deny-by-default behavior without explicit HR/WFM/security approval**. The application source does not declare a decision CHECK constraint on this table; adding one would be a separate schema-contract change.

Even a constant-default, metadata-optimized ADD COLUMN requires an exclusive table lock. It must be scheduled, independently reviewed and tied to a verified target and migration journal. `NOWAIT` fails instead of queuing behind existing readers; if another session can take the lock, the statement still holds that lock for its transaction duration.

The SQL is NOT safe to execute manually on a shared database simply because its preflight passes. The eventual protected runner must atomically record the exact numbered source path and SHA in the reviewed migration journal. The present legacy database is not proven ready for that runner.

## Test evidence required (synthetic only)

The dedicated `.github/workflows/issue-1113-worksite-forward-qa.yml` runs on **fresh disposable PostgreSQL 16 and 18** with `localhost:5432/app_db`, CI-only environment identity and `npm run db:push` used **only** to create the fresh synthetic reference schema. The test:
1. Verifies an initially empty employer/payroll database and current Drizzle worksite decision column contract.
2. Inserts a fictional worker/worksite/assignment in a transaction, temporarily drops `decision` to reproduce the old schema, executes the full candidate and compares column definitions, PK/FK constraints, indexes, assignment identity and `allow` default.
3. Tests rejection of any already-present decision column, wrong sibling column type, missing worksite FK and repeat execution; independently tests a held reader lock fails with SQLSTATE `55P03`.
4. **ROLLBACKs the entire transaction** and confirms the original catalog and zero employer/payroll records. CI results are neither real migration receipts nor human/device UAT.

No Neon credentials, production migration secrets, agency keys, or real employee data are passed to this workflow.

## Production/pilot gates — all remain outstanding

- [ ] Confirm actual Vercel/worker production DB host, branch, endpoint and least-privileged DBA/audit role.
- [ ] Reconcile historical migration path+byte-SHA receipts and adopt the genuine P0-4 cutover/journal; review [#1161](https://github.com/erwinmehehe/payrollph/pull/1161) controls.
- [ ] Complete restore-impact review [#899](https://github.com/erwinmehehe/payrollph/issues/899) and witnessed offsite encrypted backup/restore [#907](https://github.com/erwinmehehe/payrollph/issues/907).
- [ ] Resolve `0129`/PR [#1136](https://github.com/erwinmehehe/payrollph/pull/1136) and [#1154](https://github.com/erwinmehehe/payrollph/issues/1154) without blindly applying destructive Atlas DDL. Assign the next valid unique number to a separately reviewed PR.
- [ ] On an approved isolated production-like branch, prove exact target preflight, row preservation, complete source-schema parity, PII-free signed-session Live Floor 200 and tenant/unit role denials, rollback and lock-window handling.
- [ ] Approve a *separate* protected exact-SHA PLAN followed by specifically authorized APPLY; independently verify the post-apply catalog and live read behavior. No production `db:push`.
- [ ] Separately inventory **all 18 reported missing `separation_records` columns** in #1113 against the current source and actual approved target; final-pay/maker-checker/loan/tax effect must be reviewed before any separate DDL proposal. This candidate intentionally does **not** touch separation/payroll tables.
- [ ] Complete the unrelated attendance, compensation, WFM UAT, parallel payroll and release gates before declaring pilot GO.

**Explicit deployment state: NO-GO.** Passing tests only makes this candidate reviewable source. No production SQL was applied, and no issue/PR acceptance may be inferred from synthetic CI.
