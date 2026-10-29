# Combined payroll recovery regression (#1553 + #1555)

## Contract

`tests/payroll-combined-recovery-postgres.test.ts` invokes the actual payroll
creation route handler with a controlled session adapter, then the actual worker
against disposable PostgreSQL. It discards the first creation response body,
retries the same key, commits one chunk, models death after claiming the remaining
chunk, refuses a fresh lease steal, and expires only the fictional fixture lease.
A replacement finishes the same run. Creation retries during and after processing
must leave the run, receipt, jobs, register, history and audit unchanged.

An independently created uninterrupted employer/run uses the same fictional pay
inputs. Compare each entry's gross/deductions/net/status/line items and the run
totals. Require PHP 30,000 combined gross, exact centavo sum identities, two unique
employee entries and payslips, one draft audit, one lease-recovery audit and one
completion audit. Previously committed entry/history IDs and values survive.
A third employer has a populated saved draft; its financial snapshot is unchanged.

The PG16/PG18 connected-first-payroll workflow executes this scenario with
calculation history OFF and ON **only inside each disposable test process**.
No production flags or provider configuration are changed. The existing separate
worker test still proves the live old-worker/replacement lock race and audit veto.

## Executed local evidence

- Base: main `790e5de49523e31807495e1495dcd3483588d4ce`.
- Actual local PostgreSQL 18.6, fresh uniquely named task-owned localhost database.
- Combined scenario PASS with history OFF; PASS with history ON (two immutable
  revision-one history rows). Restored final source passes again.
- Negative control: disable only expired-processing-job selection in the worker;
  scenario fails at the replacement's `processed === true` assertion. Restore
  source; PASS. No runtime source changes are included in this PR.
- Source/type/lint/tenant checks are reported in the PR body after execution.

## Boundaries

This is a route-handler/database integration test, **not real-login HTTP or a
browser test**. Losing the response and lease expiry are simulated deterministically;
no actual process is killed and the test does not wait 30 minutes. Agreement with
an uninterrupted run proves recovery parity, not independent statutory accuracy.
No approval, release, bank/provider settlement, real-employer reconciliation or
production acceptance is claimed. Exact-head PG16/PG18 CI must run on the new PR.

The historical #1555 queue-policy and source-review failures occurred after its
merge (04:14 UTC): jobs at 04:35/04:51 UTC refused a PR no longer open. Their errors
were `Current PR is missing from the open PR list` and
`REVIEW_GATE_PR_HEAD_OR_FILE_SET_UNVERIFIED`. Leave those fail-closed checks intact;
neither failure demonstrates a payroll-calculation regression. #1553 had no failed
checks at inspection, but some post-merge jobs remained queued; queued is not PASS.
