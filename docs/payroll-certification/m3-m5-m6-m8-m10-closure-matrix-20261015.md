# PayrollPH money findings — source status and independent closure gates (15 Oct 2026)

**Scope:** Source-only synthetic engineering continuation from [audit #744](https://github.com/erwinmehehe/payrollph/issues/744#issuecomment-6169142226). GitHub main code and merged history are not independent Philippine payroll/agency certification. The current environment is owner-confirmed fictional development. Do not move money, submit agency filings, or release real-employer payroll based on this document.

| Audit finding | Verified source stage | What must actually be evidenced before closure |
| --- | --- | --- |
| M-3 P1 negative final-pay tax/mandatory net | Remediated in #765 | Signed maker/checker comparison of requested/applied/unpaid tax and statutory liability; negative-net synthetic and real approved ledger acceptance; final-pay export, review, approval and accounting treatment; no silently waived tax |
| M-5 P1 prior-year 13th and HOLIDAY_UNWORKED | Prior-year year-attribution merged #791; follow-up source proof in this PR | Independent reviewed DOLE policy for unworked holiday pay and employer-specific integrated-basic exceptions; prior-year 13th correction versus already-paid and imported ledgers; signed employee/year ledger and exact centavo proof |
| M-6 P2 PhilHealth base | Fixed MBS source + tests in #989 | Payroll reviewer attest to each daily-paid equivalent monthly salary input, effective rate month, cutoff and plan; no substitution of actual OT/bonus gross for fixed MBS |
| M-8 P2 gross below mandatory deductions | Source remediated #765 | Gross=100, required=230, applied=100, uncollected=130, net=0: payslip and accounting liability foot in centavos, evidence survives failed checks and export, agency remittance handling approved |
| M-10 P2 prior-month retro SSS/HDMF | Source-month release block merged #989; review-only queue added in this PR | Written separate SSS and Pag-IBIG treatment for positive/negative backpay when prior month was remitted or not; original Released source period and employee row; signed before/after contribution calculations, posted remittance reconciliation, actual agency acceptance receipts |

## M-5 decision record

The DOLE's published guidance computes statutory 13th month from basic salary earned in the calendar year. Holiday pay is generally excluded unless an individual agreement, collective agreement or established employer policy/practice treats it as part of basic salary. The distinct `HOLIDAY_UNWORKED` line remains excluded by default from the final-pay base; `BASIC` worked earnings remain basic. **Do not confuse holiday eligibility for wage payment with classification for 13th-month pay**.

Official sources:
- https://dole.gov.ph/no-delays-allowed-on-13th-month-pay-dole1/
- https://dole.gov.ph/news/doles-bwc-issues-q-a-on-13th-month-pay/
- https://nwpc.dole.gov.ph/wp-content/uploads/2023/08/2023-07-25-Handbook-on-Workers-Statutory-Monetary-Benefits-2023_edition.pdf

Required before accepting integrated holiday pay for a particular employer: identity and effective dates of the signed policy/contract/CBA or documented established practice, payroll/legal reviewer, employee applicability, historic holiday-paid ledger, prior 13th-month base and actual 13th already paid. Any adjustment for 2025 BASIC pay settled in 2026 is excluded from **2026** earnings, but its impact on **2025** entitlement is not automatically known or paid. Compute signed difference of 2025 basic and 2025 13th already paid separately and approve it; do not assume all retro amount/12 is payable without that proof.

The M-5 source lookup now also requires: (a) original payroll run same organization, (b) source run status `Released`, and (c) employee actually has an original payroll entry in that run. An unverified source produces null dates and retains the existing `FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED` block. Its test is a structural route guard plus pure 13th tests; still conduct isolated PostgreSQL released/unreleased/foreign-worker validation before any employer onboarding.

## M-10 agency determination record

Neither source work month nor later payout date by itself establishes the legal **agency posting/remittance** month for an employer wage correction. SSS's published employed-member MSC description uses actual remuneration; Pag-IBIG HDMF Circular 274 defines monthly compensation and corresponding employee/employer contribution rates. Neither document reviewed here establishes a universally safe automated correction procedure for all already-remitted prior months.

Official sources:
- https://www.sss.gov.ph/pay-contribution/
- https://www.sss.gov.ph/employees/
- https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20No.%20274%20-%20Revised%20Guidelines%20on%20Pag-IBIG%20Fund%20Membership.pdf

The new `retroAgencyReconciliationRows` function records adjustment ID, signed amount, centavos, verified original **source work month**, current calculation cutoff month and unresolved/review status. It does **not** calculate a corrected MSC, decide a contribution posting month, allocate employee/employer shares, issue adjustment file or unblock release. Existing `STATUTORY_RETRO_ATTRIBUTION_UNVERIFIED` remains a **high, blocking, non-acknowledgeable** assurance finding.

Required independent matrix, each agency separately: same-month basic correction; previous-month positive and negative correction; December-to-January correction; missing/foreign/unreleased original source; original employee entry absent; prior monthly filing/remittance not yet posted, posted, and amended; contribution maximum/cap and rate-version boundaries; voluntary above-minimum Pag-IBIG election if relevant. Preserve original and revised remittance receipts, employee/employer amounts, monthly MSC/compensation figures and approval identifiers. Do not infer success from a synthetic green test.

## Release and acceptance discipline

- **Engineering QA:** current-head CI lint, TypeScript, full four golden-payroll suites, relevant unit and disposable-PG isolation tests, release non-waiver negative tests, unchanged same-month legacy calculation, exact SHA review.
- **Independent money reviewer:** Philippine payroll-qualified practitioner and employer policy owner independently sign off expected versus actual per worker, per calendar year/month and every centavo, with no unexplained difference above PHP 0.01.
- **Separate release:** #579 real-employer parallel payroll with no money movement; government acceptance receipts required before advertising any approved agency filing; #744 source states remain unchanged until signed evidence.

**No-go by design:** M-5 employer-specific holiday inclusion and prior-year true-up are not automatic; M-10 prior-month statutory adjustments are not auto-posted and payroll stays blocked for uncertain source periods. No changes to actual remittance, bank, payout, existing development schema, feature flags or historic ledger.
