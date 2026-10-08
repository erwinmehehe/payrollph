# First payroll readiness scope

The first payroll setup card is **not** a payroll or statutory certification.

It checks only company workspace metadata, existence of active employees, nonempty bank/payout fields and distinct payroll/checker role assignments. A green setup card is permission to start preparing a payroll run, **not** permission to release money.

Separate stage gates:
- **Configure workspace:** the five setup checks on the first-payroll card
- **Calculate payroll:** inspect per-employee pay-basis/ID/rest-day/attendance/leave and effective-dated source data in the HR Payroll Readiness center; correct exceptions before running calculations
- **Release payroll:** per-run Payroll Release Checklist and Payroll Assurance must pass, including calculation completeness, authoritative exceptions, statutory treatment, bank data, and an independent checker approval bound to the exact payroll snapshot
- **Independently certified:** actual employer/pay period must reconcile employee-by-employee with an authorized incumbent source and independent signed evidence; see issue #579; never infer from synthetic CI results

The first-payroll card intentionally remains separate from the deep HR and per-run release checkers; it displays an explicit stage distinction instead of incorrectly calling the workspace 'ready for first payroll' or 'certified'.
