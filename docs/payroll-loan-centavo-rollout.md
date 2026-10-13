# Exact payroll loan settlement

`EXACT_PAYROLL_LOAN_SETTLEMENT_ENABLED` defaults off. The disabled path preserves the existing posting, rounding, status and one-cent tolerance; the enabled path validates persisted centavos, refuses even a one-cent overdraft and posts an exact remaining balance. Neither path changes payroll-engine calculations or grants deduction authority.

Before activation, run the full Asia/Manila suite and all four payroll golden suites; verify release-time transaction rollback on an invalid loan, idempotent repeat release, tenant isolation and concurrent balance changes in a disposable PostgreSQL fixture. Reconcile deductions against the approved loan schedule. Source merge does not authorize a real payroll release.

Rollback: disable the flag to restore the previous posting policy for future transactions. Do not reverse already posted loan payments or alter historical payroll automatically; any ledger correction follows the existing maker/checker process. No database migration is introduced.
