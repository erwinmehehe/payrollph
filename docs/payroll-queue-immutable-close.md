# P0: payroll register immutability below the HTTP route

The exported `enqueuePayrollRun` utility formerly deleted existing payroll
entries and processing jobs before any status check. The HTTP process endpoint
blocked `Released`, but direct integrations and scripts could call this helper.

Hardening:
- Holds a transaction-scoped **FOR UPDATE row lock** on `payroll_runs`.
- Only Draft/Failed/Needs review/Recalculating runs may be enqueued.
- `Pending approval`, `Ready for release`, `Queued`, `Releasing` and
  `Released` cannot be overwritten by a direct enqueue.
- A **certified payroll_month_closures** row for the employer/pay month blocks
  recalculation even for a stale Draft record.
- Deletes, run state reset and new processing-job creation commit atomically.
- Existing API payroll recalculation still performs attendance/timesheet gates
  and its own approval-invalidation transaction before invoking this utility.
- No released payroll, payslip, payout or ledger is intentionally rewritten.

Negative and control-flow tests insert synthetic released, certified and open
payroll runs to validate persistence and legal-entity/pay-month scoping.
All non-HTTP/DBA writes and direct `processPayrollChunk` calls need separate
staging concurrency and financial-control audit. Not production certified.