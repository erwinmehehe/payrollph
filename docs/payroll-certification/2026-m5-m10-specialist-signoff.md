# 2026 M-5 / M-10 independent Philippine payroll review and sign-off worksheet

Prepared **2026-11-20** for [#1043 M-5](https://github.com/erwinmehehe/payrollph/issues/1043), [#1044 M-10](https://github.com/erwinmehehe/payrollph/issues/1044), linked [#1999](https://github.com/erwinmehehe/payrollph/issues/1999). **All results below are review prompts / fictional arithmetic, not approvals.**

## M-10 — SSS and HDMF retrospective corrections

**Source law vs. posting decision are not interchangeable.** [SSS Circular 2024-006](https://www.sss.gov.ph/wp-content/uploads/2024/12/2025-SSS-Contribution-Table-rev.pdf) and [Pag-IBIG Circular 460](https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/Circular%20No.%20460%20-%20Guidelines%20on%20the%20Pag-IBIG%20Fund%27s%20Implementation%20of%20Increase%20in%20the%20MFS%20Effective%20February%202024.pdf) govern monthly rates/contribution bases. [SSS Citizen's Charter](https://www.sss.gov.ph/wp-content/uploads/2024/07/6a-2023-sss-citizens-charter-1st-edition.pdf) explicitly describes requests to adjust **posted/unposted employer payments**. [Pag-IBIG Circular 499 index](https://www.pagibigfund.gov.ph/about_publication_circulars_memberservices.html) records eSRS changes effective **2026-08-21**. None of these reviewed materials independently establishes one universal automatic rule for all post-paid retro adjustments.

**Mandatory per-item evidence fields:** tenant and legal employer; worker ID (fictional in public); original Released payroll run ID and signed source entry; source **work** period start/end; payment/correction period; original paid EE/ER/EC and source MSC/fund salary; current engine proposed delta; prior agency remittance status and receipt; agency-specific approved treatment; signed amount in integer centavos; new agency remittance status and acceptance receipt; independent checker and reviewer signed source SHA. Never assume work month equals remittance/correction month.

| Case | Fictional employer / original work | Adjustment in current cutoff | Prior agency payment state | Expected interim system behavior | Agency decision and evidence |
| --- | --- | --- | --- | --- | --- |
| M10-01 | A, October 2026 source within October 2026 | +₱500.00 | Not submitted | Source-month identity may be shown; **do not infer a new SSS/HDMF MSC or posting rule** | **PENDING** on whether current month's already computed contribution changes |
| M10-02 | A, September 2026 paid in October | +₱750.25 | Not submitted | Preserve original Released source and work month; **BLOCK** posting without documented treatment | **PENDING** separate SSS and HDMF instructions |
| M10-03 | A, September paid in October | +₱750.25 | Submitted, unposted | **BLOCK** duplicate/overlapping remittance; show pending state and original receipt | **PENDING** agency handling and reversal workflow |
| M10-04 | A, September paid in October | +₱750.25 | Posted/accepted | **BLOCK** automatic recomputation / duplicate collection | **PENDING** approved correction with posting receipt |
| M10-05 | A, September paid in October | -₱100.00 | Posted/accepted | **BLOCK** automatic worker clawback or negative agency remittance | **PENDING** agency refund/reversal allowance |
| M10-06 | A, December 2025 corrected in January 2026 | +₱1,200.00 | Accepted 2025 month | **BLOCK**, preserve year-specific rate/MSC and original posting identity | **PENDING** 2025/2026 agency attribution, prior-year forms |
| M10-07 | B, own past period | +₱500.00 | Any | Prove independent B-only source; A cannot access or post B's corrections | **PENDING** two-tenant PG HTTP, unchanged victim audit/payroll |
| M10-08 | A selects a B employee/run, or draft run | +₱500.00 | Any | **REJECT / fail closed** on cross-tenant, missing worker, draft / unreleased source | **PENDING** real DB integration and API proof |
| M10-09 | Missing/multi-month source or sub-cent adjustment | +₱1.234 | Unknown | **REJECT**, preserve error and never invent work month or truncate amount | Existing unit tests support class; exact-head retest needed |
| M10-10 | A, correction accepted by agency | Authorized ± amount | Agency correction posted | Match agency receipt, original+new EE/ER ledger, no duplicate posting | **NOT RUN** until an actual agency acknowledgment is available |

Engineering must continue to preserve **`STATUTORY_RETRO_ATTRIBUTION_UNVERIFIED` as non-waivable**. A checkbox equivalent to `acknowledgeExceptions=true` must never release an unresolved prior-period remittance. Any implementation of a correction formula must be a **separate reviewed code PR after written agency/practitioner determination**, not silently added in this paperwork PR.

### Agency-specific determination form (not yet signed)

| Required decision | SSS | Pag-IBIG |
| --- | --- | --- |
| Qualified agency/practitioner reviewer and authority | **UNASSIGNED** | **UNASSIGNED** |
| Document and effective date for the exact worker class | **PENDING** | **PENDING** |
| When source work month vs remittance month controls contribution basis | **PENDING** | **PENDING** |
| Not submitted vs unposted vs accepted/posted corrections | **PENDING** | **PENDING** |
| File/form/portal route, including post-August 2026 eSRS | **PENDING** | **PENDING** |
| EE/ER impact, SSS MPF/EC where applicable, and rounding | **PENDING** | **PENDING** |
| Corrected before/after centavo ledger and approved test case IDs | **NOT RUN** | **NOT RUN** |
| Agency acceptance receipt and independent witness | **NONE** | **NONE** |
| Exact reviewed source SHA + reviewer signature/date | **NONE** | **NONE** |

## M-5 — prior-year 13th-month true-up and unworked holiday inclusion

**Core 2026 authority:** [DOLE Labor Advisory 21, Series 2026](https://dole.gov.ph/php_assets/uploads/2026/11/LA-21-26-Guidelines-on-the-Payment-of-Thirteenth-Month-Pay.pdf), issued November 2026, defines minimum 13th month as **total BASIC actually earned during the relevant calendar year / 12**. Ordinary unintegrated holiday pay, OT, night differential and other excluded premiums do not automatically become BASIC. Agreement, CBA or established company policy/practice may require inclusion. This is **separate** from BIR's shared ₱90,000 13th/other-benefits tax exclusion.

| Fictional case | Independent arithmetic | System expected behavior pending review |
| --- | --- | --- |
| M5-01: 2025 BASIC ₱300,000, 13th already paid ₱25,000 | 300,000 / 12 = **₱25,000**; outstanding **₱0** | Reference baseline only; source run and employee must match |
| M5-02: +₱1,200 earned in **2025**, settled in 2026 | (300,000 + 1,200)/12 = **₱25,100**; theoretical prior-year difference **+₱100** | Preserve **2025** source year, report 2025 recalculation, **do not add ₱1,200 to 2026 13th base**; payout or remittance policy **PENDING** |
| M5-03: -₱1,200 earned in **2025**, settled in 2026 | (300,000 - 1,200)/12 = **₱24,900**; theoretical difference **-₱100** vs previously paid | Do not automatically recover ₱100 or deduct from wages; require specialist and employer approval |
| M5-04: 2026 BASIC ₱360,000 before/after a prior-year-only retro | 360,000 / 12 = **₱30,000** either way | Never double count an earlier-year retro as 2026 BASIC |
| M5-05: unworked regular holiday line ₱1,000, no signed integration policy | **Default ordinary basic base unchanged** by separate unintegrated ₱1,000 holiday line | Do not silently include in 13th; policy classification needs review |
| M5-06: same line explicitly treated as BASIC by CBA/contract/company practice | Applicable income treatment depends on **effective-dated signed policy and worker scope** | **PENDING** independent review; no inferred blanket override |
| M5-07: cost-of-living allowance (COLA) | Older [DOLE Q&A](https://dole.gov.ph/news/doles-bwc-issues-q-a-on-13th-month-pay/) says COLA is included, whereas [2026 advisory](https://dole.gov.ph/news/dole-clarifies-13th-month-pay-rules-ensures-workers-receive-rightful-benefits/) lists COLA as generally excluded unless integrated | **SOURCE INTERPRETATION HOLD**; qualified specialist must resolve applicability by work year and actual company practice |
| M5-08: missing historical payroll, draft/foreign original run, unmatched employee, or ambiguous year | **No lawful expected amount can be determined from incomplete source** | Preserve `FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED`; do not treat missing evidence as zero |
| M5-09: final pay and prior-year 13th already settled | Reconcile earned basic, prior paid amount, tax treatment, deductions and final run | **PENDING** independent centavo comparison, no automatic money movement |

### M-5 sign-off form (not yet signed)

| Required verification | Review evidence |
| --- | --- |
| Qualified PH payroll / CPA reviewer and credentials privately verified | **UNASSIGNED** |
| DOLE 2026 LA 21 and older CO LA / policy conflicts resolved | **NOT APPROVED** |
| Employer policy owner (contract, CBA, past practice) signs effective dates | **UNASSIGNED** |
| Test original Released run, exact worker + legal employer and valid work-year | **NOT RUN on new candidate head** |
| Frozen expected / actual / delta in integer centavos including negative cases | **PENDING** |
| Review prior paid 13th, prior-year adjustment and current-year separation | **PENDING** |
| Confirm no unauthorized refunds, deductions, or historical payslip rewrite | **PENDING** |
| Source commit SHA, maker/checker, reviewer signature and date | **NONE** |

### Closure rule

**#1043 and #1044 must remain OPEN** until specialist determination, exact-head functional/PG tests, independently witnessed money/agency reconciliation, employer approval and all applicable launch gates are evidenced. A source-only document and any passing synthetic regression are not those acceptances. No real employer PII, agency credentials, private remittance receipts, or signatures should be placed in this public repo.