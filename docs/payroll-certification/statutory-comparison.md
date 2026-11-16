# Statutory payroll comparison — official source vs. real engine

**Scope:** SOLO_DEV, fictional input only; test-and-document review of **19** synthetic workers, **33** BIR tax vectors and **2** shared-benefits cases (**54 units of comparison**). **Official-table reference date: 2025-11-15**. Pure statutory-function vectors retain that original 2025 applicability and their unchanged hand-derived expected amounts. **Separate real-engine comparison date: July 1–15, 2026 (payday July 15, 2026)**, the earliest convenient no-national-holiday cutoff using the repository's existing certified **2026** holiday calendar. The 2026 engine run checks whether those reference amounts continue to match its calculation; it is **not** independent certification that each 2025 source remains legally applicable in 2026, nor a full 2026 statutory payroll sign-off.

**Evidence boundary:** Original PR head `21d6b4b` completed general CI and other applicable checks successfully, but full PostgreSQL 16 `npm test` recorded **5,532 PASS, 1 FAIL, 24 SKIP**: this new engine case used a **2025-11-15** work-period end, correctly rejected by `nationalHolidayCalendarForDate` because only a 2026 national-holiday pack is installed. That is a **test-fixture scope defect**, not evidence of incorrect financial arithmetic. The earlier PostgreSQL 18 job passed but **did not include this new comparison** in its targeted test command. This revision retains the 2025 pure oracles, uses a source-justified July 2026 engine fixture, and adds this test explicitly to both PostgreSQL jobs. **New-head exact results must still be observed before counting any agreement.** The expected column below is independently transcribed and worked from the cited first-party documents; it is **not** obtained from `src/**`, `certification/**`, or an independent *non-government* transcription. The source publication's silence on rounding or month-by-month deduction timing does not establish an agency-approved convention.

## Snapshot / result taxonomy

| Classification | Case count | Meaning |
| --- | ---: | --- |
| **AGREES** | 0 **pending execution** | Count only after the CI-engine actual equals an independently source-derived oracle in centavos and the original source is applicable. |
| **DISAGREES** | 0 **confirmed** | A comparison different from a verified official value needs the exact observed trace, arithmetic, citation, and a documented expected failure; no claim before execution. |
| **SOURCE NOT VERIFIED** | 2 | C07 and C14: official premium total is derivable; **which party receives the unmatched centavo** is not fixed by the available official source. These full-worker results are excluded from AGREES regardless of numeric equality. |
| **PENDING EXECUTION** | 52 | 17 source-resolved worker cases + 33 BIR vectors + 2 benefit cases. Pending is **not** AGREES, DISAGREES, or SOURCE NOT VERIFIED. |

**Status accounting:** 54 = 0 AGREES + 0 confirmed DISAGREES + 2 SOURCE NOT VERIFIED + 52 PENDING EXECUTION. Update this table only from **observed exact-PR-head** CI results, retaining a source row and printed difference for each result. A test exit code or accepted code review is not a government payroll certificate.

## Full-engine fixture correction — 2026 calendar without inventing 2025 data

- The actual real payroll engine *must* call `nationalHolidayCalendarForDate(periodEnd)`. Only calendar-year **2026** is present in `NATIONAL_HOLIDAY_RULE_PACKS`; an attempted November 2025 payroll **must** fail closed rather than silently receiving an empty or 2026 calendar.
- The synthetic integration run is therefore **2026-07-01 through 2026-07-15**, with July 15 payday. [Presidential Proclamation No. 1006, s. 2025](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/99678) and the repo's 2026 calendar contain **no national regular or special non-working holiday in that window**. This asserts only the national calendar, not local employer holidays.
- For the one explicitly approved *fictional* NCR non-agriculture minimum-wage case C17, **₱695/day** under [NWPC Wage Order NCR-26](https://nwpc.dole.gov.ph/wp-content/uploads/2025/06/01.-Wage-Order-No.-NCR-26.pdf) still precedes [NCR-27's July 25, 2026 first tranche](https://nwpc.dole.gov.ph/secretary-tolentino-announces-historic-wage-hike-in-ncr/). Do not alter the MWE amount simply to appease a later wage screen.
- [The Philippine Information Agency's report of PhilHealth's May 2026 announcement](https://pia.gov.ph/news/philhealth-sets-5-premium-contribution-rate-for-2026/) corroborates a 5% 2026 rate and unchanged ₱10,000/₱100,000 bounds, **not the unresolved odd-cent employee/employer allocation**. SSS, BIR and HDMF tables are tested at their declared original effective dates; independent current-source/agency confirmation and other 2026 cases remain outside this narrow regression (see [#1999](https://github.com/erwinmehehe/payrollph/issues/1999)).
- Both disposable **PG16 and PG18** workflow jobs now explicitly execute the statutory comparison test. PG16 also retains its full regression inventory. A green job after this revision is an *engineering check*, never human/agency acceptance.

## Original agency sources and effective dates

| Key | Original document / exact table or section | Effective on applicable pay date | First-party source |
| --- | --- | --- | --- |
| **S** | **SSS** Circular No. 2024-006, *Schedule of SSS Contributions for Business Employers and Employees*, **page 1**, relevant **Monthly Salary Credit / Range of Compensation** row: regular SS, MPF, **EE**, **ER**, employer-only **EC**. The `SSS bracket` cells below select the named row, not a rounded estimate. | **2025-01-01** | [SSS schedule (PDF)](https://www.sss.gov.ph/wp-content/uploads/2024/12/2025-SSS-Contribution-Table-rev.pdf); [Circular publication](https://www.sss.gov.ph/wp-content/uploads/2024/12/CI-2024-006-Publication.pdf) |
| **P** | **PhilHealth** Advisory No. **2025-0002**, **page 1**, employee premium schedule **2025**: 5% **Monthly Basic Salary**, ₱10,000 floor / ₱100,000 ceiling, total monthly premium ₱500–₱5,000; **PhilHealth Circular 2020-0005 §IV** for covered employed members and equal EE/ER sharing. The advisory has **no independently verified instruction** for an odd-centavo split. | **Calendar 2025** (2025 advisory; older Circular 2020-0005 defines monthly basic base) | [PhilHealth 2025 advisory (PDF)](https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf); [Circular 2020-0005 (PDF)](https://www.philhealth.gov.ph/circulars/2020/circ2020-0005.pdf) |
| **H** | **Pag-IBIG / HDMF** Circular No. **460**, original circular **pages 1–2, §C table and maximum fund salary**, ₱1,500 monthly compensation boundary (EE 1% through ₱1,500; EE 2% above; ER 2%); fund-salary ceiling **₱10,000**, so ordinary mandatory EE / ER max **₱200 each**. The Department of Migrant Workers hosts a scan of the original Pag-IBIG circular as an official attachment; this table refers to ordinary covered employees, **not** the separate special OFW timing described by the host advisory. | **2024-02-01** for ordinary members (Circular §F) | [DMW government-hosted original Circular 460, annex pages 1–2 (PDF)](https://dmw.gov.ph/archives/v1/resources/dsms/DMW/ISN-EXT/2025/DMW-ADVISORY-37-2025.pdf); [Pag-IBIG official circular location](https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/Circular%20No.%20460%20-%20Guidelines%20on%20the%20Pag-IBIG%20Fund%27s%20Implementation%20of%20Increase%20in%20the%20MFS%20Effective%20February%202024.pdf) |
| **T-M / T-S** | **BIR** RR No. **11-2018**, **Annex E, page 1**, *Withholding Tax Table effective January 1, 2023 and onwards*, **Monthly** and **Semi-Monthly** columns **1–6**. The isolated vector's `column` is the exact published column. Input is **taxable compensation after mandatory employee deductions**, not gross pay. | **2023-01-01 onward** | [BIR Annex E (PDF)](https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf) |
| **T-A** | **BIR** Form **1700** (Jan 2018 ENCS v6), **page 2, Table 2: Tax Rates effective 2023 and onwards**, annual graduated income tax brackets **1–6**. | **2023-01-01 onward** | [BIR original Form 1700 (PDF)](https://bir-cdn.bir.gov.ph/local/pdf/1700%20Jan%202018%20ENCS%20v6.pdf) |
| **D** | **DOLE** Handbook on Workers' Statutory Monetary Benefits, **13th Month Pay** section, 1/12 of basic salary **actually earned** for the calendar year. | Existing DOLE PD 851 / guidelines; used on 2025 fictional earned basic | [DOLE/NWPC Handbook, 2023 ed. (PDF)](https://nwpc.dole.gov.ph/wp-content/uploads/2023/08/2023-07-25-Handbook-on-Workers-Statutory-Monetary-Benefits-2023_edition.pdf) |
| **B** | **BIR** RMC **50-2018**, **Q&A section on NIRC §32(B)(7)(e)**, one shared **₱90,000** exclusion for 13th month **and other benefits**, only excess taxable; original circular's 13th/other-benefits discussion. | From TRAIN amendments effective **2018** | [BIR RMC 50-2018 (PDF)](https://bir-cdn.bir.gov.ph/local/pdf/RMC%20No%2050-2018.pdf) |
| **W** | **NWPC** Wage Order **NCR-26**, published wage rate table for **non-agriculture ₱695/day**, for the **fictional C17 MWE** only. No automatic MWE inference from salary. | **2025-07-18** | [NWPC NCR-26 (PDF)](https://nwpc.dole.gov.ph/wp-content/uploads/2025/06/01.-Wage-Order-No.-NCR-26.pdf) |

## 19 fictional employee cases — official monthly source comparison

All money amounts are **PHP**, to two decimals where material. `SSS MSC / EE / ER / EC` is the official monthly MSC and employee/employer/EC amounts. `PH EE/ER` is monthly **employee/employer** (or total only where unverified). `HDMF EE/ER` is monthly mandatory ordinary-member employee/employer. All rows use the exact named **S** bracket row, **P** 2025 band, **H** §C rate tier. The annual salary of the isolated tax vectors below is not inferred from these synthetic workers.

| Case | Monthly basic | Pay frequency | SSS compensation row (S p1) | SSS MSC / EE / ER / EC (S) | PH EE / ER (P) | HDMF EE / ER (H) | Boundary / status |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| C01 | 1,500.00 | Semi-monthly | <5,250 | 5,000 / 250 / 500 / 10 | 250 / 250 | 15 / 30 | undefined |
| C02 | 1,500.01 | Semi-monthly | <5,250 | 5,000 / 250 / 500 / 10 | 250 / 250 | 30 / 30 | undefined |
| C03 | 5,249.99 | Semi-monthly | <5,250 | 5,000 / 250 / 500 / 10 | 250 / 250 | 105 / 105 | undefined |
| C04 | 5,250.00 | Semi-monthly | 5,250–5,749.99 | 5,500 / 275 / 550 / 10 | 250 / 250 | 105 / 105 | undefined |
| C05 | 9,000.00 | Semi-monthly | 8,750–9,249.99 | 9,000 / 450 / 900 / 10 | 250 / 250 | 180 / 180 | undefined |
| C06 | 10,000.00 | Semi-monthly | 9,750–10,249.99 | 10,000 / 500 / 1,000 / 10 | 250 / 250 | 200 / 200 | undefined |
| C07 | 10,000.20 | Semi-monthly | 9,750–10,249.99 | 10,000 / 500 / 1,000 / 10 | NOT VERIFIED; total 500.01 | 200 / 200 | undefined |
| C08 | 14,749.99 | Semi-monthly | 14,250–14,749.99 | 14,500 / 725 / 1,450 / 10 | 368.75 / 368.75 | 200 / 200 | undefined |
| C09 | 14,750.00 | Semi-monthly | 14,750–15,249.99 | 15,000 / 750 / 1,500 / 30 | 368.75 / 368.75 | 200 / 200 | undefined |
| C10 | 14,750.01 | Semi-monthly | 14,750–15,249.99 | 15,000 / 750 / 1,500 / 30 | 368.75 / 368.75 | 200 / 200 | undefined |
| C11 | 25,250.00 | Semi-monthly | 25,250–25,749.99 | 25,500 / 1,275 / 2,550 / 30 | 631.25 / 631.25 | 200 / 200 | undefined |
| C12 | 34,749.99 | Semi-monthly | 34,250–34,749.99 | 34,500 / 1,725 / 3,450 / 30 | 868.75 / 868.75 | 200 / 200 | undefined |
| C13 | 34,750.00 | Semi-monthly | 34,750 and over | 35,000 / 1,750 / 3,500 / 30 | 868.75 / 868.75 | 200 / 200 | undefined |
| C14 | 77,777.00 | Semi-monthly | 34,750 and over | 35,000 / 1,750 / 3,500 / 30 | NOT VERIFIED; total 3,888.85 | 200 / 200 | undefined |
| C15 | 100,000.00 | Semi-monthly | 34,750 and over | 35,000 / 1,750 / 3,500 / 30 | 2,500 / 2,500 | 200 / 200 | undefined |
| C16 | 100,000.01 | Semi-monthly | 34,750 and over | 35,000 / 1,750 / 3,500 / 30 | 2,500 / 2,500 | 200 / 200 | undefined |
| C17 | 16,680.00 | Semi-monthly | 16,250–16,749.99 | 16,500 / 825 / 1,650 / 30 | 417 / 417 | 200 / 200 | undefined |
| C18 | 20,000.00 | Semi-monthly | 19,750–20,249.99 | 20,000 / 1,000 / 2,000 / 30 | 500 / 500 | 200 / 200 | undefined |
| C19 | 400,000.00 | Semi-monthly | 34,750 and over | 35,000 / 1,750 / 3,500 / 30 | 2,500 / 2,500 | 200 / 200 | undefined |

**Verified source vs software cutoff policy:** The monthly SSS, PHIC, HDMF numbers above are directly calculated from official tables; splitting the **monthly employee** share across the two semi-monthly cutoffs is an existing PayrollPH **software policy**. Official source rows here do not separately prescribe the cutoff rounding or which cutoff collects an odd cent; these software policies are **not certified agency instructions**.

### Real-engine first-cutoff comparison (employer + employee)

Cutoff **expected** is a manual application of the monthly official values, PayrollPH's stated 50/50 collection convention and BIR **Annex E semi-monthly** bracket. Cell format `cutoff employee SSS / PhilHealth / Pag-IBIG / BIR WHT / net`. C03/C08/C12 are PROVISIONAL software-projection estimates from the separately documented rounded-gross basis, not an agency-approved half of the contractual monthly SSS obligation. `Gross` and loan show the arithmetic context. **Engine** and **difference in centavos** remain **NOT RUN**, not zeros, until the disposable-Postgres job prints and asserts those actual fields.

| Case | Salary / month | Cutoff gross | Frequency | Official-derived cutoff expected (SSS / PH / HDMF / WHT / net) | Engine observed | Δ centavos | Status |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| C01 | 1,500.00 | 750.00 | Semi-monthly | 125.00 / 125.00 / 7.50 / 0.00 / 492.50 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C02 | 1,500.01 | 750.01 | Semi-monthly | 125.00 / 125.00 / 15.00 / 0.00 / 485.01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C03 | 5,249.99 | 2,625.00 | Semi-monthly | 137.50 / 125.00 / 52.50 / 0.00 / 2,310.00 (PROVISIONAL projection) | NOT RUN | NOT COMPUTED | MONTH-END SOURCE PARITY OPEN #2003 |
| C04 | 5,250.00 | 2,625.00 | Semi-monthly | 137.50 / 125.00 / 52.50 / 0.00 / 2,310.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C05 | 9,000.00 | 4,500.00 | Semi-monthly | 225.00 / 125.00 / 90.00 / 0.00 / 4,060.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C06 | 10,000.00 | 5,000.00 | Semi-monthly | 250.00 / 125.00 / 100.00 / 0.00 / 4,525.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C07 | 10,000.20 | 5,000.10 | Semi-monthly | 250.00 / NOT VERIFIED / 100.00 / NOT VERIFIED / NOT VERIFIED | NOT RUN | NOT COMPUTED | SOURCE NOT VERIFIED (PH split) |
| C08 | 14,749.99 | 7,375.00 | Semi-monthly | 375.00 / 184.38 / 100.00 / 0.00 / 6,715.62 (PROVISIONAL projection) | NOT RUN | NOT COMPUTED | MONTH-END SOURCE PARITY OPEN #2003 |
| C09 | 14,750.00 | 7,375.00 | Semi-monthly | 375.00 / 184.38 / 100.00 / 0.00 / 6,715.62 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C10 | 14,750.01 | 7,375.01 | Semi-monthly | 375.00 / 184.38 / 100.00 / 0.00 / 6,715.63 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C11 | 25,250.00 | 12,625.00 | Semi-monthly | 637.50 / 315.63 / 100.00 / 173.23 / 11,398.64 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C12 | 34,749.99 | 17,375.00 | Semi-monthly | 875.00 / 434.38 / 100.00 / 832.29 / 15,133.33 (PROVISIONAL projection) | NOT RUN | NOT COMPUTED | MONTH-END SOURCE PARITY OPEN #2003 |
| C13 | 34,750.00 | 17,375.00 | Semi-monthly | 875.00 / 434.38 / 100.00 / 832.29 / 15,133.33 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C14 | 77,777.00 | 38,888.50 | Semi-monthly | 875.00 / NOT VERIFIED / 100.00 / NOT VERIFIED / NOT VERIFIED | NOT RUN | NOT COMPUTED | SOURCE NOT VERIFIED (PH split) |
| C15 | 100,000.00 | 50,000.00 | Semi-monthly | 875.00 / 1,250.00 / 100.00 / 7,881.20 / 39,893.80 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C16 | 100,000.01 | 50,000.01 | Semi-monthly | 875.00 / 1,250.00 / 100.00 / 7,881.20 / 39,893.81 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C17 | 16,680.00 | 8,340.00 | Semi-monthly | 412.50 / 208.50 / 100.00 / 0.00 / 7,619.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C18 | 20,000.00 | 10,000.00 | Semi-monthly | 500.00 / 250.00 / 100.00 / 0.00 / 0.01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C19 | 400,000.00 | 200,000.00 | Semi-monthly | 875.00 / 1,250.00 / 100.00 / 51,103.30 / 146,671.70 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |

### Employer-only first-cutoff evidence — SSS ER, EC, PHIC ER, HDMF ER

These **separate employer liabilities are not employee deductions**. Each expected column is hand-worked from **S** page 1, **P** page 1 and **H** §C official **monthly employer shares**, with the repo's pre-existing first-cutoff half-collection **software convention**; that timing and half-cent allocation are not agency-certified. `EC` is employer-only. The CI test reads the **real engine's persisted trace** keys `sssEmployerCutoff`, `sssEmployerEcCutoff`, `philHealthEmployerCutoff` and `pagIbigEmployerCutoff`, emits an observed value and **signed centavo delta for each**, and refuses mismatches when a statutory oracle exists.

| Worker | SSS employer / EC / PhilHealth employer / HDMF employer — first cutoff expected PHP | Engine employer actual | Employer-side Δ centavos | Status |
| --- | --- | --- | --- | --- |
| C01 | 250.00 / 5.00 / 125.00 / 15.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C02 | 250.00 / 5.00 / 125.00 / 15.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C03 | 275.00 / 5.00 / 125.00 / 52.50 (PROVISIONAL projection) | NOT RUN | NOT COMPUTED | MONTH-END SOURCE PARITY OPEN #2003 |
| C04 | 275.00 / 5.00 / 125.00 / 52.50 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C05 | 450.00 / 5.00 / 125.00 / 90.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C06 | 500.00 / 5.00 / 125.00 / 100.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C07 | 500.00 / 5.00 / **NOT VERIFIED** / 100.00 | NOT RUN | NOT COMPUTED | PH share SOURCE NOT VERIFIED; other components pending |
| C08 | 750.00 / 15.00 / 184.38 / 100.00 (PROVISIONAL projection) | NOT RUN | NOT COMPUTED | MONTH-END SOURCE PARITY OPEN #2003 |
| C09 | 750.00 / 15.00 / 184.38 / 100.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C10 | 750.00 / 15.00 / 184.38 / 100.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C11 | 1,275.00 / 15.00 / 315.63 / 100.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C12 | 1,750.00 / 15.00 / 434.38 / 100.00 (PROVISIONAL projection) | NOT RUN | NOT COMPUTED | MONTH-END SOURCE PARITY OPEN #2003 |
| C13 | 1,750.00 / 15.00 / 434.38 / 100.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C14 | 1,750.00 / 15.00 / **NOT VERIFIED** / 100.00 | NOT RUN | NOT COMPUTED | PH share SOURCE NOT VERIFIED; other components pending |
| C15 | 1,750.00 / 15.00 / 1,250.00 / 100.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C16 | 1,750.00 / 15.00 / 1,250.00 / 100.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C17 | 825.00 / 15.00 / 208.50 / 100.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C18 | 1,000.00 / 15.00 / 250.00 / 100.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| C19 | 1,750.00 / 15.00 / 1,250.00 / 100.00 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |

**Output contract:** `STATUTORY_COMPARISON_MONTHLY_EVIDENCE` includes official monthly EE/ER shares, observed `computeSss`/`computePhilHealth`/`computePagIbig` values, and each `deltaCentavos` including null for unverified PhilHealth share. `STATUTORY_COMPARISON_EVIDENCE` includes the disposable database employer **and** employee cutoff amounts, and signed centavo differences. In both outputs, `null` is **not zero** and cannot count as AGREES.

**Manual worked examples:**

- **C04 versus C03, SSS exact boundary:** Official **S** page 1 sets salary **₱5,249.99** in lowest MSC **₱5,000**, EE **₱250**, ER **₱500**, EC **₱10**; at **₱5,250.00**, next MSC **₱5,500** yields EE **₱275**, ER **₱550**, EC **₱10**. Employer EC is **not deducted** from the worker. A half-cutoff employee deduction moves from **₱125.00** to **₱137.50**.
- **C08/C09/C10, SSS EC boundary:** Official **S** page 1 compensation **₱14,749.99** selects MSC **₱14,500**, employee **₱725**, employer **₱1,450**, EC **₱10**. Salary **₱14,750.00** and **₱14,750.01** selects MSC **₱15,000**, employee **₱750**, employer **₱1,500**, EC **₱30**.
- **C12/C13, maximum MSC:** SSS **S** last rows: salary **₱34,749.99** MSC **₱34,500**, employee **₱1,725** versus **₱34,750.00** MSC **₱35,000**, employee **₱1,750**. Above that the credit stays **₱35,000**. The source monthly employee differential is **₱25.00**, or a **₱12.50** first-cutoff difference under the split convention.
- **C05/C06 and C15/C16, PhilHealth floor/cap:** Official **P** page 1: **₱9,000** actual basic still uses **₱10,000 × 5% = ₱500** premium, EE **₱250**, ER **₱250**; at **₱100,000** the premium **₱5,000**, EE/ER **₱2,500**; at **₱100,000.01** the premium remains capped.
- **C07/C14, known ambiguity, not a statutory DISAGREES:** **P** determines C07 **₱10,000.20 × 5% = ₱500.01** total premium; equal ideal halves are **₱250.005**. For C14 **₱77,777 × 5% = ₱3,888.85**; ideal halves **₱1,944.425**. Available primary sources **do not designate whether the extra centavo belongs to EE or ER or whether another rounding sequence applies**. The engine's documented employer-remainder convention cannot be labeled AGREES; no official EE/ER expected integer centavos, related first-cutoff tax and net oracle, or difference is asserted.
- **C01/C02/C06, HDMF:** **H §C** at **₱1,500.00** EE **₱15** / ER **₱30**; at **₱1,500.01** EE approximately **₱30.0002**, rounded to **₱30.00**, ER **₱30.00**; at **₱10,000** and **above**, EE and ER each **₱200.00**. Ordinary mandatory contributions only; no optional excess.
- **C11, BIR on net taxable cutoff:** Gross **₱12,625.00** − SSS **₱637.50** − PH EE **₱315.63** − HDMF **₱100.00** = **₱11,571.87** taxable. **T-S column 2:** `(11,571.87 − 10,417) × 15% = ₱173.2305 → ₱173.23` withholding; net **₱11,398.64**.
- **C17, MWE:** **W** non-agricultural NCR wage **₱695/day × 24 workdays = ₱16,680** synthetic basic; independently approved fixture classification, no other taxable compensation. **BIR RMC 50-2018** minimum wage / statutory wage exemption produces zero withholding. Software must not turn a below-minimum warning into automatic tax eligibility.
- **C18, tiny net:** Fictional first-cutoff **₱10,000**, mandatory EE **₱500 + ₱250 + ₱100**, WHT **₱0**, available **₱9,150**, illustrative employee-authorized loan deduction **₱9,149.99**, leaving **₱0.01 net**. Loan enforceability/priority is employer policy, **not** established by S/P/H/T. No payment or authorization granted by this fixture.

## 33 BIR official rate table vectors — all six bands and every published boundary

These **isolated statutory-function** comparisons feed **taxable compensation**, *not* gross wages, to the real BIR function. For monthly rate vectors, an illustrative worker could have that amount of monthly **taxable**, not necessarily gross, salary; for semi-monthly vectors, it is **per-cutoff taxable** after employee deductions; annual vectors use tax-year **taxable** income. A standalone rate-vector is **not represented as a worker in the disposable PG run**. Every expected value is derived directly from Annex E (monthly/semi-monthly) or original BIR annual Table 2, and should match exactly to integer centavos.

| Vector | Pay / taxable interval | Taxable input PHP | Official BIR WHT PHP | Exact citation (document / table / column) | Engine observed | Δ centavos | Status |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| T01 | monthly (inside) | 10,000.00 | 0.00 | T-M (RR 11-2018 Annex E p1), column 1; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T02 | monthly (inside) | 25,000.00 | 625.05 | T-M (RR 11-2018 Annex E p1), column 2; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T03 | monthly (inside) | 40,000.00 | 3,208.40 | T-M (RR 11-2018 Annex E p1), column 3; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T04 | monthly (inside) | 100,000.00 | 16,875.05 | T-M (RR 11-2018 Annex E p1), column 4; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T05 | monthly (inside) | 300,000.00 | 73,541.70 | T-M (RR 11-2018 Annex E p1), column 5; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T06 | monthly (inside) | 800,000.00 | 230,208.35 | T-M (RR 11-2018 Annex E p1), column 6; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T07 | monthly (boundary) | 20,833.00 | 0.00 | T-M (RR 11-2018 Annex E p1), column 1; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T08 | monthly (boundary) | 33,333.00 | 1,875.00 | T-M (RR 11-2018 Annex E p1), column 2; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T09 | monthly (boundary) | 66,667.00 | 8,541.80 | T-M (RR 11-2018 Annex E p1), column 3; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T10 | monthly (boundary) | 166,667.00 | 33,541.80 | T-M (RR 11-2018 Annex E p1), column 4; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T11 | monthly (boundary) | 666,667.00 | 183,541.80 | T-M (RR 11-2018 Annex E p1), column 5; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T12 | semi-monthly (inside) | 5,000.00 | 0.00 | T-S (RR 11-2018 Annex E p1), column 1; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T13 | semi-monthly (inside) | 12,000.00 | 237.45 | T-S (RR 11-2018 Annex E p1), column 2; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T14 | semi-monthly (inside) | 20,000.00 | 1,604.10 | T-S (RR 11-2018 Annex E p1), column 3; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T15 | semi-monthly (inside) | 50,000.00 | 8,437.45 | T-S (RR 11-2018 Annex E p1), column 4; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T16 | semi-monthly (inside) | 150,000.00 | 36,770.80 | T-S (RR 11-2018 Annex E p1), column 5; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T17 | semi-monthly (inside) | 400,000.00 | 115,104.15 | T-S (RR 11-2018 Annex E p1), column 6; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T18 | semi-monthly (boundary) | 10,417.00 | 0.00 | T-S (RR 11-2018 Annex E p1), column 1; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T19 | semi-monthly (boundary) | 16,667.00 | 937.50 | T-S (RR 11-2018 Annex E p1), column 2; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T20 | semi-monthly (boundary) | 33,333.00 | 4,270.70 | T-S (RR 11-2018 Annex E p1), column 3; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T21 | semi-monthly (boundary) | 83,333.00 | 16,770.70 | T-S (RR 11-2018 Annex E p1), column 4; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T22 | semi-monthly (boundary) | 333,333.00 | 91,770.70 | T-S (RR 11-2018 Annex E p1), column 5; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T23 | annual (inside) | 100,000.00 | 0.00 | T-A (Form 1700 p2, Table 2), column 1; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T24 | annual (inside) | 300,000.00 | 7,500.00 | T-A (Form 1700 p2, Table 2), column 2; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T25 | annual (inside) | 500,000.00 | 42,500.00 | T-A (Form 1700 p2, Table 2), column 3; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T26 | annual (inside) | 1,000,000.00 | 152,500.00 | T-A (Form 1700 p2, Table 2), column 4; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T27 | annual (inside) | 3,000,000.00 | 702,500.00 | T-A (Form 1700 p2, Table 2), column 5; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T28 | annual (inside) | 10,000,000.00 | 2,902,500.00 | T-A (Form 1700 p2, Table 2), column 6; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T29 | annual (boundary) | 250,000.00 | 0.00 | T-A (Form 1700 p2, Table 2), column 1; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T30 | annual (boundary) | 400,000.00 | 22,500.00 | T-A (Form 1700 p2, Table 2), column 2; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T31 | annual (boundary) | 800,000.00 | 102,500.00 | T-A (Form 1700 p2, Table 2), column 3; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T32 | annual (boundary) | 2,000,000.00 | 402,500.00 | T-A (Form 1700 p2, Table 2), column 4; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| T33 | annual (boundary) | 8,000,000.00 | 2,202,500.00 | T-A (Form 1700 p2, Table 2), column 5; effective 2023-01-01 | NOT RUN | NOT COMPUTED | PENDING EXECUTION |

**BIR column continuity:** Annex E expresses base tax and percentage over each bracket's lower bound; at **monthly ₱66,667** both neighboring formulas yield **₱8,541.80**. At **semi-monthly ₱33,333** they yield **₱4,270.70**. Annual Table 2 at **₱800,000** yields **₱102,500**. The six inside-band cases and five upper boundaries per pay frequency guard rounding, off-by-one and proper table selection; an annual vector is not monthly tax multiplied by 12.

## DOLE 13th month and shared ₱90,000 tax-exempt benefits — two cases

These two cases call the real final-pay `computeFinalPay` and `annualize` functions, with **no payroll filing, payout or flag activation**. Worker earns **₱300,000 BASIC** in 2025; **D (handbook 13th month section)** determines **₱300,000/12 = ₱25,000** entitlement. Additional benefits are included once in gross. **B (RMC 50-2018 13th/other-benefits Q&A)** limits **combined** exemption to ₱90,000. **T-A (BIR annual Table 2, column 2)** determines the annual withholding liability:

| Case | Annual basic | 13th month | Other benefits | Combined benefits | Official exempt / taxable excess | Annual taxable compensation | Official annual tax | Engine observed | Δ centavos | Status |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | --- | --- |
| B01 **under ceiling** | 300,000.00 | 25,000.00 | 50,000.00 | 75,000.00 | 75,000.00 / **0.00** | 300,000.00 | **7,500.00** | NOT RUN | NOT COMPUTED | PENDING EXECUTION |
| B02 **over ceiling** | 300,000.00 | 25,000.00 | 80,000.00 | 105,000.00 | 90,000.00 / **15,000.00** | 315,000.00 | **9,750.00** | NOT RUN | NOT COMPUTED | PENDING EXECUTION |

**Arithmetic:** B01: `(300,000−250,000)×15%=7,500`; B02 `300,000 + (105,000−90,000) = 315,000`, `(315,000−250,000)×15%=9,750`. Other benefit category eligibility, prior payouts, current tax year, and half-cent rounding require independent human approval before any real use.

## UNVERIFIED RATE / NEEDS-RULING markers — owner inventory reconciliation

An owner-supplied plan reportedly lists **six** unverified rates, **but that exact six-item owner list has not been attached or independently located** in the inspected repository. **Do not invent six numbered rate facts.** The actual named markers found at `main ed85509d3349b85abb0c57ea7e0746464ba454d1` are:

| Marker / exact location | Actual described issue | Status after this work |
| --- | --- | --- |
| **F-05**, `docs/qa/payroll-e2e-findings.md`, finding register; `docs/qa/payroll-e2e-phase-a-decision-memo.md` | Holiday eligibility / prior-day proof and employer-specific exceptions: **NEEDS-RULING / UNVERIFIED RATE** | **OPEN**: outside the four agency rate tables; no employment policy certification |
| **F-06**, same two documents | Holiday, rest-day, OT, night-differential combinations and rounding: **NEEDS-RULING / UNVERIFIED RATE** | **OPEN**: no new holiday source audit; golden premium expected values are not external practitioner sign-off |
| **F-07**, same two documents | Regional minimum wage classification, SSS/PHIC/HDMF/BIR agency rates, historical attribution/remittance: **NEEDS-RULING / UNVERIFIED RATE** | **PARTIAL**: narrow 2025 ordinary-member **S/P/H/T** published table figures independently addressed; employee category, retro period, split rounding, other wage orders and legal filing still **OPEN** |
| **F-08**, same two documents | 13th-month basic inclusions, lawful recoveries and exact-cent ties: **NEEDS-RULING / UNVERIFIED RATE** | **PARTIAL**: basic/12 and shared benefit ceiling addressed; employer policies, prior-year claims, sub-centavo rounding **OPEN** |
| **F-09**, `docs/qa/payroll-e2e-phase-a-decision-memo.md` | Worker vs aggregate centavo rounding rule; memo collectively calls F-05–F-09 **NEEDS-RULING / UNVERIFIED RATE** | **OPEN**: per-worker convention is not an official split-allocation rule |
| **Other repo-wide A-3 generic warning**, `docs/payroll-certification/payroll-accuracy-source-crosscheck-20261018.md` | “Preserve existing A-3 UNVERIFIED RATE markers” without itemized six rate lines | **NOT ITEMIZED / NOT CONFIRMED**: a generic warning is *not a sixth identified rate* |

Separately, **four source-watch date fields are null** in `src/lib/statutory-rule-watch.ts`: `RULE_FAMILY_LAST_VERIFIED.sss`, `.philhealth`, `.pagibig`, `["bir-withholding"]`. This PR **does not update their source-verification dates** or replace independent signing. `wage-orders` carries an older date but category applicability requires employer-locality evidence. The absence of an exact six-item plan is an explicit **provenance gap** for the owner to resolve; this work closes **zero** of those broad practice/rounding approval holds.

## First-cutoff source vs product projection — three observed table-boundary cases

**Established on previous exact head `7061051`:** PG16 and PG18 both fail C03: first-cutoff employee SSS was **PHP 137.50** rather than the initial **PHP 125.00** fixture. The SSS table itself is correct at either compensation: the **contracted monthly pay** is PHP 5,249.99 (MSC PHP 5,000; employee EE PHP 250/month), but the engine's **first-cutoff projection** doubles the already-centavo-rounded PHP 2,625.00 gross to PHP 5,250.00 (MSC PHP 5,500; employee EE PHP 275/month). At the first cutoff, the configured 50/50 estimate is PHP 137.50. This is **not** evidence that the agency mandates the first-cutoff deduction. It is a difference between *monthly source based on contracted pay* and *interim software estimate based on projected actual gross*.

The same one-cent projection crosses two more SSS compensation-row boundaries:

| Case | Contract monthly basic (2025 official monthly source) | Round first cutoff gross; double as projected monthly | Source EE monthly from contract | Projected SSS EE monthly | Interim EE first cutoff / ER first cutoff / EC first cutoff | WHT / net at first cutoff |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| C03 | PHP 5,249.99 | PHP 2,625.00 × 2 = PHP 5,250.00 | PHP 250.00 | PHP 275.00 | 137.50 / 275.00 / 5.00 | 0.00 / 2,310.00 |
| C08 | PHP 14,749.99 | PHP 7,375.00 × 2 = PHP 14,750.00 | PHP 725.00 | PHP 750.00 | 375.00 / 750.00 / 15.00 | 0.00 / 6,715.62 |
| C12 | PHP 34,749.99 | PHP 17,375.00 × 2 = PHP 34,750.00 | PHP 1,725.00 | PHP 1,750.00 | 875.00 / 1,750.00 / 15.00 | 832.29 / 15,133.33 |

These three **literal projected-first-cutoff software-policy expectations** are entered separately in the real-engine test. Their **original source-based 2025 monthly salary/bracket oracles remain unchanged** and are still asserted by the pure statutory tests. A green provisional comparison cannot be counted as agency acceptance, cannot claim the monthly payroll is exact, and does not prove the next cutoff corrects the total. Separate independent full-month gross-centavo carry, SSS true-up, tax, net and employer/liability acceptance is required in [#2003](https://github.com/erwinmehehe/payrollph/issues/2003) and two-month follow-up [#1999](https://github.com/erwinmehehe/payrollph/issues/1999). No production logic, historical receipts or tenant proof is modified here.

## DISAGREES — finding ledger

**Observed first-cutoff difference is not an official MONTHLY-rate disagreement:** C03 at head `7061051`, source-contracted PHP 5,249.99 vs first-cutoff software projection PHP 5,250.00, expected PHP 125.00 from half the contracted monthly SSS employee share vs engine PHP 137.50 based on projected monthly remuneration (delta +1,250 centavos). Both SSS table rows are internally correct for their respective monthly bases; the full-month pay-cent carry and posting must be independently accepted in #2003. No agency has certified the software's provisional cutoff allocation.\n\n**No DISAGREES is established without an observed real-engine value tied to an exact official table row.** Do not infer that a matching repository table or a previous golden fixture proves AGREES. A hypothetical failure is not a verified discrepancy; the executed test is expected to fail loudly for previously undocumented differences, with the failing case and observed amounts retained in CI. Do **not** modify `src/**` or silently switch to skipped/expected-failure assertions. If CI identifies a real difference, record **worker / S,P,H,T source row / official hand value / real engine value / signed difference in centavos / legal interpretation / observed CI SHA** here, and then pin the repo's **documented knownFinding expected-current** convention in a separate test-only revision, or keep a test-only doc finding where appropriate.

**Known non-resolution, not DISAGREES:** PhilHealth C07 and C14 odd-centavo EE/ER assignment. Formula verifies the total premium; the split's *statutory* oracle is **SOURCE NOT VERIFIED**, so even matching the engine's chosen centavos cannot be counted as AGREES.

## Executable checks / integration evidence

- New test: `tests/payroll-e2e-fictional-statutory-comparison.test.ts` (checked into this proposed branch). Pure tests statically assert the cited **19 monthly source rows**, **33 BIR vectors**, **DOLE basic/12** and **two benefit-pool** hand oracles. No expected value is generated from `src/lib/ph-statutory-rule-packs.ts` or `certification/**`.
- Real DB test creates 19 fictional employees and payroll entries (including employer SSS, EC, PHIC and HDMF liabilities) via `enqueuePayrollRun` / `drainPayrollQueue` and emits observed money values and `deltaCentavos`. It is **deliberately gated** to `CI=true`, `DEMO_MODE=false` and exactly `postgresql://postgres:postgres@127.0.0.1:5432/app_db`. On any other environment it reports an **explicit skip = NOT RUN**, never a pass. Delete the disposable synthetic organization and end the pool.
- The updated `.github/workflows/payroll-e2e-fictional.yml` includes this new real-engine statutory comparison test in the **targeted PG16 and PG18** checks; PG16 additionally retains full `npm test`. This closes a prior false-assurance gap where PG18 finished green without actually exercising the new case. **Record actual conclusions from the revised PR head** before merge consideration.
- This PR intentionally leaves **money, payout, provider, CSP and calculation-history flags OFF**; no release, posting, filing, submission, external calls, prod/Neon SQL, migration, schema, or real employer data. All evidence SOLO_DEV; no human practitioner signature, cash transfer, bank adapter or agency acceptance.
- **Targeted local commands** (pure test safe outside CI; DB case explicitly skipped): `npx tsx --test tests/payroll-e2e-fictional-statutory-comparison.test.ts`; `npx tsc --noEmit`; `npm run lint`. **Connected DB** only in the guarded disposable PG CI workflow. Any green test is a reproducible engineering check, *not* statutory certification.

## Not covered

Official **2026** PhilHealth primary advisory and actual rates as of November 2026, new law/circular after the 2025 fixture date, source updates post-filing; PhilHealth **odd-cent allocation**, employer-remittance system round-off, cutoff split timing or unpaid contribution handling; SSS/HDMF prior-period retro source month, accepted revisions, member posting and nonordinary member categories; varying PhilHealth salary bases for daily/hourly workers, noncash wage elements, bonus/OT classification, additional 13th inclusions/leave settlements, MWE category exceptions, 2026 wage classes and geography, BIR cumulative true-up and 2316/1601/1604 filings, and real bank/provider/external acceptance. No independently accepted real-employer payroll cycle, CPA attestation, or legal approval is supplied. This PR **does not certify PayrollPH for production**.
