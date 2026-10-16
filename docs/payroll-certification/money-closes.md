# Signed final-pay review and exact 13th-month cents

Both flags are default OFF. Source merge is not activation, filing, money
authority or a production migration. No payroll-engine.ts arithmetic was edited.

`FINAL_PAY_SIGNED_REVIEW_ENABLED=true` adds a read-only signed reconciliation
balance to new computation results, the reviewer card and CSV. It derives from
frozen gross + signed tax adjustment - requested statutory - **applied** loans.
It is not a negative payout or an adjudication of employee debt. Existing
uncollected-tax/statutory evidence, allocation policy and approval/release holds
remain authoritative. Malformed amounts are unverified, never silently zero.
Legacy frozen rows can be reviewed without rewriting them. Flag OFF omits the
new card, result property, API capability and CSV rows.

`EXACT_THIRTEENTH_CENTAVOS_ENABLED=true` divides earned basic integer cents by 12
and rounds the remainder half-up: a remainder of 6 through 11 adds one cent.
PHP120000.06 therefore gives PHP10000.01; PHP0.05 gives zero and PHP0.06 gives
PHP0.01. The helper rejects non-centavo, nonfinite, negative or over-PHP1-trillion
Number sources. This is a bounded implementation tie policy, not a claim that
DOLE specifically prescribes this centavo algorithm. The underlying formula is
[1/12 of earned basic salary](https://dole.gov.ph/news/doles-bwc-issues-q-a-on-13th-month-pay/).

Compliance helper, final pay and year-end use the same new helper only with the
flag ON. The global round2 helper and payroll engine file are unchanged.
Final-pay source fingerprints include centavo-half-up-v1 while enabled, so
changing either direction invalidates stale financial approval sources. Bound
year-end rows carrying this policy cannot be silently replaced. Settled rows
are never recomputed in place. Recompute and independently review *unsettled*
packages before rollout; use audited corrections for settled payroll.

Testing includes executed replacements for the two A-3 TODOs, an independent
BigInt remainder oracle, flag-OFF parity, bad-source states, nonnegative payout,
stale-source evidence and desktop/390px screenshots. The dedicated disposable
PG job runs golden suites with both flags ON; normal CI remains default OFF.

The 0127 rehearsal executes the **actual** canonical SQL after transactionally
dropping only an empty disposable CI intake table. It checks tenant FK,
maker/checker, encrypted storage and rollback. Its explicit CI/localhost/app_db
guard is required. It is not a production migration or a full canonical-chain
rehearsal. Production receipt, real-employer reconciliation, tax-practitioner
review and physical-device/operator acceptance remain separate release gates.
