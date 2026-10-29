# Payroll worker lease recovery and stale-attempt fencing

This change addresses a process dying **after** a queue claim was committed. Previously only queued/failed jobs could be claimed, leaving a processing job stranded indefinitely.

## Recovery contract

- Keep the existing `FOR UPDATE SKIP LOCKED` queue serialization. A processing job becomes eligible only after its database-clock lease is older than **30 minutes**. A legacy null lock timestamp falls back to its update timestamp; fresh leases are not stolen.
- Every claim increments the existing attempt counter and records its worker identity. Persisted chunk execution requires that exact attempt/worker to still own the processing job under the existing run/job row locks.
- Recovery writes `Payroll worker lease recovered` in the **same PostgreSQL claim transaction**. An audit veto leaves the previous attempt, lease and business data unchanged.
- An old worker whose replacement has claimed the job cannot commit register/history/payslip/totals or poison the replacement through its error handler. Failure-state updates also require the exact still-owned attempt and worker.
- Recovery resumes from the committed chunk cursor. It neither resets prior chunks nor re-enqueues the run. Existing Released/Releasing and source-identity/chunk guards remain authoritative.

The lease is conservative bounded-chunk recovery, not a promise that every calculation finishes within 30 minutes. If an old worker is merely slow, a replacement may recompute the uncommitted chunk; fencing prevents both from committing. No new service, scheduler activation, table, migration, payment capability or public endpoint is introduced.

## Executed local evidence

Real PostgreSQL 18 in a new uniquely named task-owned loopback database; no existing app_db reset, live credentials or provider calls:

1. Commit chunk one, model a worker killed after claiming chunk two, prove a fresh lease is untouched, then expire its timestamp and recover chunk two. Earlier entry IDs/values remain unchanged; final two-worker gross is PHP 30,000 and the completed cursor is two.
2. A real SQL audit INSERT veto rolls back the recovery claim and attempt increment; the next attempt succeeds after removing the fictional veto.
3. Hold the actual payroll-run row lock on a separate SQL connection. Start the real old worker, observe it waiting on that lock, expire its lease, then start a replacement and observe the incremented claim. Release the lock. The old worker fails its write fence; its error handler cannot fail the replacement. Remaining chunks complete with unique employees and exactly one completion audit.
4. An expired job cannot rewrite a fixture's already-Released run or its existing calculated register. A separate fictional employer remains unchanged.
5. Three negative controls fail as expected: restore queued/failed-only eligibility; remove the final attempt fence; remove the error-handler ownership fence. Restoring all safeguards passes again.

The worker regression plus existing lifecycle, calculation-history and heartbeat cases pass **21/21** locally. This is real worker/SQL execution with a deterministic lock barrier, not a real-time wait for a 30-minute crash or independent operator UAT. Synthetic fixture timestamps model lease expiry.

The existing Payout Claim Safety workflow runs this regression on fresh disposable PG16. Exact-head CI/security/payroll and canonical read-only preview regressions remain required before source merge. No test receipt certifies real-employer accuracy, bank settlement, agency acceptance or production rollout.
