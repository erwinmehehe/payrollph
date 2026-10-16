# Proposed 0129 — Non-recovery foreign-key name reconciliation

**Status: unapproved engineering proposal; draft only; production NO-GO.**
This is a *separate logical change* following the schema-recovery work
merged through #1120 and #1121. Diagnostic PR #1127 was **closed without
merging** by the repository owner; its deliberately failing Atlas/Squawk
workflow is **not** included here. This PR now targets `main` directly and
carries only the four minimum source-only disposable-PG16 fixture helpers
formerly inherited from the closed review branch. Neither that prior audit
nor `0129` establishes production parity, approval or genuine migration
receipts.
The original numbered 0115–0128 sources have not been modified by this PR.

## Why this change is deliberately narrow

The exact [#1127 independent PG16 evidence](https://github.com/erwinmehehe/payrollph/actions/runs/38885472043)
at `5c630909cbaaec101f083528cb316c8bbf718a47` contains **159
candidate-only #1031 non-PASS objects after 0128**. Of these, **108 rows
are 54 MISSING+EXTRA foreign-key name pairs**, across fifteen *non-recovery*
tables, with precisely equal child/parent keys, ON DELETE/UPDATE and validation
status. These are not the 49 recovery FK pairs already handled by proposed
`0128`. They are unrelated to the 2 material historical `NOT VALID`
differences.

Proposed `drizzle/0129_non_recovery_fk_names_forward.sql` contains **54
static `ALTER TABLE ... RENAME CONSTRAINT` statements and one catalog-only
preflight**. Each old name must be present on the exact public child table;
the target name must not already exist; the FK must be validated,
nondeferrable, single-column, have **integer child/parent FK
columns**, reference a **validated, single-column integer(id) PRIMARY KEY**
on `public.<expected-parent>`, use the exact expected ON DELETE action,
NO ACTION ON UPDATE and SIMPLE match semantics. Otherwise `P0001` with explicit
`ISSUE0129_...` code blocks the *entire* protected transaction.

Before catalog inspection, the preflight locks the **15 exact affected child
tables** in a deterministic ascending order using `ACCESS EXCLUSIVE` locks.
The protected runner must retain these locks in its single outer transaction
until all 54 renames complete, preventing concurrent FK replacement between
validation and rename (TOCTOU). Concurrent migrations should fail closed via
the runner's existing `lock_timeout`; no migration may depend on autocommit
between preflight and the renames. The disposable PG16 checkpoint independently
tests a second session's attempted concurrent FK replacement.

It performs no row reads, DML, BACKFILL, GRANT, REVOKE, constraint recreation,
validation, monetary changes, employer inference, migration journal updates,
or execution of historical 0039. It changes **names only**; the protected
runner must own atomic BEGIN, local lock/statement timeouts, schema context
and ROLLBACK on any failure. Never dispatch this SQL ad hoc or over pooled
production connections.

### Isolated tests and acceptance

One PR-only GitHub Actions workflow uses an ephemeral PostgreSQL 16
container with fictional/empty app data:

1. A guarded single `drizzle-kit push` initializes local `app_db`.
2. Clone to `atlas_candidate_db`, synthesize the missing-table baseline,
   and apply exact source **0115→0126** under the existing protected #1054
   synthetic pre/postflight.
3. Clone to `atlas_reconciled_db`; prove the **49 existing 0128 renames**
   and full transactional rollback; commit **only** the synthetic copy for
   independent catalog inspection.
4. Clone to `atlas_final_db`. For exact proposed **0129**, corrupt one
   historical FK name then its ON DELETE action **inside separate
   savepoints**. Each must fail with the explicit preflight error, then
   rollback to the identical complete constraint catalog. Next apply 0129
   inside a savepoint, prove all public FK OIDs/definitions/validation flags,
   other constraints, columns, indexes, functions and triggers unchanged
   except the **54 constraint names**, rollback and prove catalog identity.
   Finally apply only in this throwaway final DB for the next read-only step.
5. A separate restricted `catalog_auditor` account (read-only transactions,
   no row SELECT, app DML or elevated privilege) evaluates the existing
   `scripts/lib/issue-1031-schema-manifest.ts` and
   `src/lib/issue-1031-full-schema-diff.ts` **before and after**. It
   requires exactly **54 structurally identical name pairs** removed,
   and that **every other original full-catalog non-PASS row** remains
   byte-for-byte visible.

**Additional PG16/PG18 integrated rollback test:** the existing #1121
`tests/issue-1061-integrated-forward-train-postgres.test.mjs` now runs
the unchanged 0115–0126 sources, proposed 0128, then exact source 0129
*in the same fictional-money transaction* on both PostgreSQL majors.
It requires 54 structurally identical MISSING/EXTRA FK pairs to become
PASS, preserves *every* other #1031 non-PASS row, runs a positive rollback
and a negative reapply, asserts zero payroll-centavo changes, and finally
rolls back the entire test. The existing consolidated PG16/18 workflow
is triggered when 0129 changes. Evidence is **NOT_RUN / PENDING** until
the exact commit's workflow succeeds; no simulated PG16 success proves
PG18 safety.

**Expected, not yet an accepted test result at creation:** post-0129
#1031 aggregate changes only by 54 PASS, 54 fewer MISSING and 54 fewer
EXTRA relative to post-0128. The 54 pairs cover 108 catalog non-PASS
rows. Residual **51 candidate-only differences**, 155 baseline DRIFT
rows and other original source-baseline differences remain unresolved.
Treat actual job and SHA as the evidence; a regression or missing job is
`NOT_RUN`, not PASS. This PR does **not** attempt comprehensive
`schema.ts` changes: those can cause running code to request columns from
a real database before its protected migration cutover.

## Unresolved work explicitly outside 0129

- **22 additional forward FKs:** tenant-scoped and payment/employer
  contracts, including `NOT VALID` cases; app-model or release contract
  choices require security/DBA review.
- **2 existing FK validation-status DRIFT:** employee assignment and
  entity transfer `NOT VALID` are intentional historical safeguards;
  do not auto-VALIDATE without real data/DBA proof.
- **18 columns/indexes:** multi-entity scope, tenant-module navigation,
  payroll payout indexes and WFM effective window indexes need a
  separately gated `schema.ts` contract decision, not a blind reverse
  Atlas DROP.
- **6 check/unique objects:** payout amount positivity and transfer scope
  semantics require catalog-level equivalence review.
- **3 possible fixture artifacts:** `DROP TABLE ... CASCADE` in the
  synthetic baseline can remove external FKs. No real production starting
  catalog has been proven.
- The **115 Squawk warnings** in 0124–0126 are still open with zero
  waivers. CI lint evidence is not an independent DBA decision.
- The source's fresh Drizzle baseline also carries **155 #1031 DRIFT and
  127 EXTRA** rows. The model/deparser noise remains unwaived and must
  never be used to disguise forward-only discrepancies.

## Human-only STOP gates

**Do not merge or apply to production.** Before any future protected release:
verify actual target identity, privileges, historic migration 0127 and 0128
provenance/receipts and byte-level SHA-256, review #899 unintended restore
impact, satisfy #907 encrypted offsite backup and witnessed restore, obtain
independent qualified DBA/security approval, run protected PLAN then APPLY,
record authentic cutover receipts, rerun complete live #1031 and authenticated
RBAC/tenant-denial smoke, and verify payroll-centavo and provider-disabled
invariants. Never interpret PG16 synthetic success or lint warning tally
as any of those human approvals. PostgreSQL 18 is covered by the added full-train regression, but
**must still be marked NOT_RUN until exact-head PG18 CI completes successfully**.
The standalone fourth-database Atlas-style rehearsal remains PG16-only.
