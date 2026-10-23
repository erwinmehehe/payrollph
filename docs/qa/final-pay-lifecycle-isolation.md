# Final-pay lifecycle investigation

`scripts/qa/final-pay-lifecycle-http.mjs` exercises real separation and approval
handlers with PostgreSQL and fictional employers. It runs after the existing
money-path proof in both flag-state CI jobs. CI always uses HTTP, production-mode
session authentication and recent MFA. The disposable localhost target guard runs
before importing database modules; manual final-pay release must stay disabled.

Two independent attacker employers compare nonempty own packages against a real
high-ID victim package created through the separation endpoint. Separation intent
passes actual HR and owner approval endpoints before final-pay computation.
Tests cover GET/POST/PATCH, forged worker/employer/package selectors, department
clearances, maker self-approval rejection, independent approval, recent MFA,
employee denial and revoked membership with a retained session. SQL snapshots
include separation, employee, payroll, approval, audit, IT and HCM state after
each denied request and after both complete attacker journeys.

A current-year released payroll fixture with PHP 1,200,000 taxable wages and no
withholding produces a tax collection exceeding final gross. The executed route
must retain unpaid mandatory deductions, floor the payable amount to zero and
reject approval without altering financial state.

Manual release remains held with `FINAL_PAY_MANUAL_RELEASE_NOT_CERTIFIED`; this
test does not certify settlement, exercise an enabled release, call providers or
authorize production activation. No application behavior or payroll math changes.
No inventory coverage credit or audit closure is claimed.

Local direct-handler diagnosis initially passed 206 assertions and 26 denied
requests with real PostgreSQL. Its test-only identity adapter is forbidden in CI
and is not HTTP authentication acceptance. Focused calculation, shortfall, JSONB
and loan-authority tests passed 28/28. Final HTTP CI evidence remains required.
