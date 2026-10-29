# Payroll interruption recovery — worker audit boundary

This first recovery change fixes two confirmed calculation-worker defects. It does not certify every possible interrupted payroll operation.

## Fixed transaction boundaries

- `enqueuePayrollRun`: the existing row lock, run state claim, destructive register/job reset, replacement job and `Payroll job queued` audit now commit in one transaction. An audit INSERT veto preserves the prior run, entries, payslips and job IDs.
- Final calculation chunk: register/payslip/history writes, totals, processed-chunk cursor, job completion and `Payroll calculation completed` audit now commit in the same locked transaction. A veto rolls back the chunk; the existing worker failure handler records the failed job without advancing its cursor. Retrying that job computes the chunk once.
- `recordAuditEvent` accepts an internal transaction writer; default callers retain their previous behavior. No exception is swallowed and no audit/tenant guard is relaxed.

## Executed local evidence

Twenty focused tests passed, including real PostgreSQL 18 in a new uniquely named disposable loopback database. No existing `app_db` was reset or modified. The new `payroll-recovery-audit-postgres.test.ts` checks:

1. A real PostgreSQL trigger vetoes only this fictional employer's queue audit. Enqueue rejects and its entire business/audit snapshot is unchanged.
2. Two simultaneous enqueue calls produce one success, one rejection, one job and one queue audit.
3. A completion-audit veto leaves no computed register or payslip and does not advance the chunk cursor. The worker records a retryable failure.
4. Two retry workers complete exactly one register entry and payslip with positive net and the expected PHP 15,000 gross, one completion audit and a completed job.
5. A lost-response retry finds no eligible completed job and changes nothing.
6. A vetoed recalculation preserves existing calculated register, payslip and job IDs; a separately populated fictional employer remains unchanged.

Negative controls restored the old enqueue audit boundary and old completion audit boundary independently. Both made the test fail at the expected persisted-state assertions. Restoring the fixes passed again.

## CI evidence still required

The existing Payout Claim Safety workflow now runs the new worker regression against fresh PG16. The existing route-level real-PG checker race test also injects an audit veto before racing approve/decline, verifies both task and run remain pending after failure, then retains exactly-one-decision and stale-retry assertions. Authentication/certification adapters in that older route test remain controlled; it is not a real-login browser proof.

These new CI-head results are pending at PR creation. The checker regression was not run locally because its existing guard requires a GitHub Actions-owned disposable `app_db`. CI identity was not forged and that guard was not loosened.

## Remaining recovery work

- New-run POST intent/idempotency and lost-response recovery need their own API/UI design: a run-level enqueue lock does not deduplicate two independently created drafts.
- Draft-creation audit and the process route's request-level audit still use separate commits. This change makes the worker's own durable queue/completion records atomic, not every audit event in the request lifecycle.
- A process killed after claiming a job can still require stale-lease recovery; the tests here exercise caught failure and retry, not process-kill recovery.
- Client refresh-after-success behavior outside the first-payroll guide needs its own browser cases. Existing guide fixes and this worker regression do not prove all workspace mutations.

No money flags, migrations, live payroll, provider requests, production SQL or independent human acceptance are part of this change. Do not mark these remaining items complete from green CI.
