# Separate bug fix: prior-employer tax at final-pay separation

**Status:** draft code change, NOT Golden Payroll Phase 15 certification. No live finance authority or production flag enablement. No migrations, payouts, provider credentials or production data.

## Confirmed defect and governing BIR text

BIR Revenue Regulations **11-2018**, amending RR 2-98, **section 2.79(B)(5)(b)** (Annualized Withholding Tax Method), expressly applies when the employer-employee relationship ends before the end of the calendar year. Step 1 determines taxable compensation, **Step 2 adds taxable compensation from previous employer(s) in the same year**, Step 3 applies the annual tax schedule, and Step 4 reconciles tax due with **cumulative withholding, including previous employer(s)**. The regulation specifies how deficiency withholding and refunds are handled when employment terminates.

Official BIR reference: https://bir-cdn.bir.gov.ph/local/pdf/Digest%20RR%2011-2018.pdf (annualized method and Annex E, effective 2023).

The existing Separation API was reading **the current employer's Released payroll and earlier imported payroll-provider rows**, but it did not read the **different previous employer's** reviewed Form 2316 evidence. That could change a refund to a collection. Payroll-provider imports (Phase 13) and previous-employer evidence (Phase 12) have distinct meanings; do not merge them into the 13th-month salary entitlement.

## Remediation design

- Reuse the existing encrypted, maker/checker-approved **Phase 12** prior-employer evidence for the same organization, worker, and tax year. No unreviewed monetary values may be supplied by the Separation request.
- When **YEAR_END_PRIOR_EVIDENCE_ENABLED=true inside a disposable test process**, prior evidence is **required** before computing separation pay, including a maker/checker-approved `none-confirmed` declaration for a worker with no prior employer. Missing, invalid, undecryptable or unapproved evidence fails closed.
- Enforce authenticated legal-employer/entity access before decryption.
- Feed that verified evidence to the existing `annualizeWithPrior()` calculation after computing current-employer gross, 13th month and benefits; previous-employer withholding is a credit, **never current-employer tax withheld**.
- Keep a non-PII digest/revision/tax-year/status fingerprint in the separation snapshot. Recheck source approval and the fingerprint **inside the initiating, Finance approval and manual release transactions**. Changed evidence or a flag switched OFF blocks an already reviewed prior-evidence package, rather than releasing stale annualization.
- **Do not activate the flag in production**. With the flag OFF and no package previously prepared with this evidence, ordinary final-pay arithmetic and snapshots follow the existing path. This fixes the opt-in code path, not production activation.

## Hand-derived fictional reconciliation, never copied from engine output

Existing Phase 12 worker: employed at the current employer July–December 2026 at PHP 30,000/month.

| Item | Calculation | PHP |
| --- | --- | ---: |
| Current employer basic earned | 6 x 30,000 | 180,000.00 |
| Current employer 13th month | 180,000 / 12 | 15,000.00 |
| Current employer statutory contributions | Phase 12 fixture | 14,700.00 |
| Current employer taxable income | 180,000 + 15,000 - 15,000 - 14,700 | 165,300.00 |
| Previous employer taxable income | Independently documented Phase 12 Form 2316 fixture | 165,000.00 |
| Combined taxable income | 165,300 + 165,000 | 330,300.00 |
| Tax due (RR 11-2018 Annex E, effective 2023) | (330,300 - 250,000) x 15% | 12,045.00 |
| Previous employer withheld | Phase 12 Form 2316 fixture | 1,500.00 |
| Current employer withheld | Phase 12 current year payroll fixture | 6,044.40 |
| **Collect on separation** | 12,045 - 1,500 - 6,044.40 | **4,500.60** |
| Final-pay gross (unpaid current-employer 13th only) | 180,000 / 12 | 15,000.00 |
| **Final-pay net** | 15,000 - 4,500.60 | **10,499.40** |

The same **current-only** inputs without approved previous-employer evidence give annual tax due 0 and a current-employer-only refund of PHP 6,044.40, **net PHP 21,044.40**. That remains the flag-OFF legacy behavior, *not a correct calculation for a worker with an omitted prior employer*.

### Shared benefits ceiling example

NIRC **section 32(B)(7)(e), as amended by RA 10963**, and RR **11-2018** exempt 13th-month and qualifying other benefits only up to a shared **PHP 90,000 calendar-year ceiling**. If the prior employer already exempted 80,000, the current employer's 15,000 13th month has 10,000 exemption left and 5,000 taxable overflow.

Taxable income = 165,300 + 165,000 + 5,000 = 335,300. Tax due = (335,300 - 250,000) x 15% = **12,795.00**; collect = 12,795 - 1,500 - 6,044.40 = **5,250.60**; final-pay net = **9,749.40**. The current employer's 13th-month entitlement remains **15,000.00**, independent of the other employer's wages.

BIR reference: https://bir-cdn.bir.gov.ph/local/pdf/RMC%20No%2050-2018.pdf (excess de minimis joining the other-benefits pool) is relevant to reviewed leave allocations, but no new leave tax rule is introduced in this fix.

## Existing phases; no double-counting

- **Phase 7:** final-pay gross/net, taxable/exempt leave allocation, loan caps and refund/collect arithmetic.
- **Phase 12:** validated different prior-employer Form 2316 values, maker/checker approval, shared PHP 90k ceiling and prior withholding credits **at year-end**.
- **Phase 13:** same-employer earlier payroll-provider imports, paid 13th month and year-end tax; distinct from previous employer.
- **Phase 14:** shared statutory de minimis limits across imported and calculated same-employer payroll.

The new tests specifically bind the missing **separation** application to the Phase 12 evidence and verify the original flag-OFF calculation remains unchanged.

## Not covered / release restrictions

- This is **not** Golden Payroll Phase 15's full matrix of half-cent, variable salary, unpaid absences, monthly/semi-monthly equivalence, partial-cutoff separation or all leave-year cases.
- No production flag default, real payout, external provider, bank settlement, BIR submission or migration is authorized or exercised.
- No evidence is invented for workers with a previous employer. A worker without approved evidence is **held** when the existing prior-evidence flag is enabled.
- A worker whose flag is OFF and previous-employer record is absent is on the unchanged legacy path. This remains a production-activation risk; do not describe it as a legal cure in default-OFF mode.
- Minimum wage earners with prior-employer evidence remain deferred by Phase 12's `PRIOR_MWE_REVIEW_DEFERRED`; multi-entity eligibility must still be tested under the real access model.
- Full authenticated HTTP, maker/checker-to-release PG16 integration, mutation evidence and tenant source re-certification of the modified Separation route must be demonstrated on the **exact PR head** before any merge. Changing a pinned route requires renewed security evidence and must **not** silently preserve old tenant-method credit.
- This draft fix is not a tax-authority certification, live finance approval or independent demonstration that a bank settlement occurred.

## Source citations

1. BIR Revenue Regulations **11-2018**, amending RR 2-98, §2.79(B)(5)(b), annualized method, steps 1–4, and Annex E.
2. NIRC **§32(B)(7)(e)** as amended by **RA 10963** — combined 13th month and other benefits exemption.
3. BIR Revenue Memorandum Circular **50-2018** — excess de minimis and the benefits pool.
4. BIR Revenue Regulations **29-2025**, §1 amending RR 2-98 §2.78.1(A)(3) — unused private vacation leave (12 days effective January 2026), unchanged by this patch: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2029-2025.pdf.

## Current-head reconciliation and review fixes (November 14, 2026)

- Merged the final-pay remediation onto a newer `main` while preserving the independently updated DL-01 restricted-runner workflow, proof ledger, and their newer source guards.
- With `MULTI_ENTITY_ENABLED=true`, the Separation **GET** response is filtered by the authorized selected legal employer; **POST** and **PATCH** enforce the persisted worker's legal employer, not merely organization membership. Group-wide aggregate roles are not authority to view individual final-pay records.
- A prepared prior-employer evidence snapshot cannot pass the creation transaction if `YEAR_END_PRIOR_EVIDENCE_ENABLED` switched OFF after computation. The Finance approval and release gates still revalidate the approved digest/revision.
- Added source regressions and disposable PostgreSQL same-organization/different-legal-employer denial tests. No new production privileges, payouts, provider calls or tenant isolation coverage credits.
- Remaining acceptance is **not complete** until the flag-ON authenticated Separation API's positive and negative multi-employer cases are proved on the merged head, along with independent human payroll/tax and security sign-offs. Do not merge or enable production flags based on source tests or previous flag-OFF HTTP evidence.
