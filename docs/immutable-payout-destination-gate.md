# Money movement must use frozen payroll destinations

The approved/released payroll entry includes `trace.payment` captured at
calculation time. Before this patch the PayMongo disbursement loader used
mutable employee bank details instead. A destination change after release
could therefore silently redirect payments without changing released totals.

Live PayMongo preflight, initial disbursement and failed-transfer retries now
all use `loadPayrollPayoutRows` with mandatory original snapshots:
- Missing or malformed frozen destination: no payout
- Employee's currently approved account/bank/mobile/number no longer
  semantically matches frozen snapshot: no payout, independent review required
- Cross-organization employee, unreadable account, missing released state,
  employee count mismatch, net-total mismatch or invalid cents: no payout
- Recipient name, account, bank and references come from the frozen record,
  never from mutable employee display details.
- Final bank-file fallback applies the same frozen/live destination comparison.

Operational consequence: even a separately approved HR change cannot silently
update a previously released money instruction. Account changes require a
governed payout reauthorization procedure and fresh testing before resubmission.
This PR does not implement an override, transfer approval UI, or automatic
redisbursement; all missing evidence stays blocked.

Read-only preflight calls and synthetic tests never submit to PayMongo.
No private bank details or secrets should be logged.
