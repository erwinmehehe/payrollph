# Issue #993 — Canonical complex-pay read-only preview, engineering change

**Status:** Source candidate. Not an authorized production payroll, release, or completed independent UAT.

## Shared computation

The canonical worker's `executePayrollChunk` now has a narrowly scoped **read-only projection** mode. It runs the same authoritative `calculateEmployeePay` invocation and the same read-side assembly for effective salary, attendance punches, WFM schedules/OT, local and national holidays, paid leave, benefits, approved earnings, recurring components, loans, retro, MWE evidence, prior released payroll and statutory true-up. The production queue enters through `processPayrollChunk` and retains its existing mutation path. The projection supplies a **query-only** reader and a synthetic in-memory run. The new mode never invokes schema bootstrappers, payment-account sealing, writes to `payroll_runs`, `payroll_entries`, `payslips`, audit events, bank files, or external agencies. The route already owns authorization and wraps reads in `REPEATABLE READ, READ ONLY`.

The read-only retro source lookup accepts an optional query-only reader and uses it for both its parent query and nested `exists` subquery. The expense evidence helper also receives this reader; unreviewed legacy expense claims remain fail-closed. **Do not use this projection outside the protected route**, and never treat the synthetic negative run ID as an approval or a persisted payroll record.

## Scope and readiness

- Requires an active, exact primary legal employer; refuses multi-entity and mismatched employee cohorts.
- Retains company-wide payroll role gating, exact-period HR review, maker/checker roles and the existing private, no-cache response.
- Allows prior **released** cutoff context to contribute to statutory reconciliations; refuses an active overlapping run.
- Requires WFM timesheet approval for employees with punches, even where active WFM policy is advisory. Honors enforced timesheet policy for the full selected cohort and any configured payroll-cutoff attendance lock.
- Blocks incomplete punches, pending leave, unapproved overtime/loan/recurring pay and pending supplementary earnings.
- Withholds amounts for employees with corrections or unresolved expense evidence, missing TIN/payout/profile, and for any canonical calculation exception.
- Caps inline previews at 200 workers; larger employers need a paginated, reviewed design.
- If a source query fails, including due to missing deployed schema or migration history, no partial monetary projection is returned.

## Test matrix and evidence to obtain

Source tests provide a five-worker fictional, query-only projection harness for ordinary monthly, daily, hourly with attendance, approved leave and an approved allowance/loan, plus a direct monthly calculation equality check and invalid-cohort preflight. They prove there is no data-write method on the injected reader and the production calculation function is reused.

**Independent acceptance still required** before closing issue #993:
1. Full disposable PostgreSQL 16 and 18 integration tests with real Drizzle queries, synthetic two-employer/overlapping employee numbers, exact legal-employer scoping, status transitions and no persistent changes.
2. At least five independently reconciled **preview vs no-release canonical run** pairs with centavo-level per-component parity; not merely a direct calculator unit test.
3. Browser 375px/390px error/retry, role/tenant switch and historical WFM approval staleness.
4. Independent #852/#853 human UAT, #579 witnessed payroll and production DB/recovery approvals remain separate.

The source PR must pass exact-head CI and security review. Do **not** enable production feature flags, execute migrations or change employer payroll/payment state as part of this change.
