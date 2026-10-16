# Issue #1045 — M-3 / M-6 / M-8 independent money acceptance pack

**Status: ENGINEERING REHEARSAL COMPLETE; INDEPENDENT PAYROLL/ACCOUNTING ACCEPTANCE NOT_RUN; REAL-CUSTOMER RELEASE NO-GO.**

The original source defects for M-3 and M-8 (#765) and M-6 (#989) are recorded as remediated. This pack provides fictional, deterministic evidence and a private review handoff. It does **not** certify legal or statutory correctness, accept accounting/recovery policy, or authorize releases or filings.

## Reproduce the engineering evidence

Use Node 22, a clean checkout of the PR's exact source SHA and a development workstation/sandbox **without production database, employee data, credentials, migration, SQL, bank or agency access**.

~~~sh
git rev-parse HEAD
git status --porcelain
npm ci --ignore-scripts
npx tsx scripts/qa/issue-1045-money-acceptance.ts
sha256sum qa-artifacts/issue-1045-money-acceptance/observations.json
sha256sum qa-artifacts/issue-1045-money-acceptance/observations.csv
~~~

The script keeps **literal expected** values separate from the current calculators' **observed** values, reconciles via integer centavos, fails nonzero for an unexpected amount, and records each metric's variance and `humanReviewStatus: NOT_RUN`. Output is generated locally in Git-ignored `qa-artifacts/issue-1045-money-acceptance/observations.{json,csv}`. Do **not** commit real employee records, reviewer identities, signed acceptance, financial originals or private artifact hashes to GitHub.

### Rehearsal already observed (fictional source only)

| Evidence | Result |
| --- | --- |
| Rehearsal checkout SHA | `48860faa48706498a3cfb9576319e985397b5194` |
| Executed script SHA-256 | `2cfb947e1391e90e31f0653feb920136a2be5622d3aa43bfcb42d6e41a9be233` |
| Fictional cases | **23** |
| Expected / observed metrics | **160** |
| Engineering centavo mismatches | **0** |
| Run environment | Disposable Node 22 sandbox, outbound deny-all during rehearsal, no active database |
| Qualified practitioner / accountant acceptance | **NOT_RUN** |
| Actual payslip, ledger, maker/checker, agency acceptance | **NOT_RUN** |

The observations are reproducible source-behavior evidence; the expectations are *working hypotheses pending independent human verification*, not authenticated legal payroll entitlements. The reviewer must rerun against the exact commit ultimately submitted for acceptance and retain generated artifact hashes privately.

## M-3 — Final-pay negative shortfalls and liabilities

Configured annual withholding derives from `src/lib/ph-statutory-rule-packs.ts:88-95` and `src/lib/annualization.ts`; allocation follows `src/lib/final-pay.ts:129-249`. Each annualized tax, component classification, adjustment and debt-recovery treatment needs independent review.

| Fictional case | Arithmetic hypothesis | Observed outcome |
| --- | --- | --- |
| M3-F01 | Taxable basic 300,000: (300,000 − 250,000) × 15% = **PHP 7,500.00**; available gross 0 | Requested tax **7,500.00**, applied **0.00**, unpaid **7,500.00**, derived signed mandatory balance **−7,500.00**, net payable **0.00** |
| M3-F02 | Benefit 500 assumed within annual exemption; taxable 300,000 − 200 statutory = 299,800; (299,800 − 250,000) × 15% = **7,470.00** | Gross **500.00**, applied tax **500.00**, unpaid tax **6,970.00** plus unpaid statutory **200.00** = **7,170.00** |
| M3-F03 | Zero gross; statutory requested **123.45**, separate loan request **500.00** | Statutory unpaid **123.45**, loan deferred **500.00**, payable zero |
| M3-F04 | Gross **900.00** − mandatory **300.00** − loan **250.00** | Net **350.00**, unpaid mandatory **0.00** |
| M3-F05 | Prior withholding **10,000.00**, annual tax due **7,500.00** | Tax adjustment/refund **+2,500.00**, net **2,500.00**, refund legality still subject to review |
| M3-R01 / R02 | Gross 0 − tax 7,500 − statutory 50 = **−7,550.00** | Read-only review CSV reports **7,550.00** unresolved and blocks release; absent immutable component split says **NOT RECORDED — RECOMPUTE** |

A nonnegative `netFinalPay` is a **payable floor**, not proof of zero liability. The derived negative diagnostic (`grossFinalPay + taxAdjustment − finalStatutoryDeductions`) is not a persisted signed-net API field. Tax-first application is a **provisional presentation order**, not a lawful rule for partial remittance or collection. Do not sign off accounting recoverability or statutory debt without a qualified practitioner and accountant.

**NOT_RUN and required:** independently witnessed immutable separation record, maker/checker snapshot and fingerprint, review CSV byte check, actual fictional payslip/GL/export comparison, release-block proof in an isolated synthetic database, and independently approved recovery/refund and loan-authorization policy.

## M-6 — PhilHealth monthly basic salary (MBS)

**Official-source checkpoints requiring practitioner interpretation:** [PhilHealth Circular 2020-0005](https://www.philhealth.gov.ph/circulars/2020/circ2020-0005.pdf), [PhilHealth Circular 2018-0001](https://www.philhealth.gov.ph/circulars/2018/circ2018-0001.pdf), [PhilHealth Advisory 2025-0002](https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf), and [Philippine Information Agency's 2026 rate announcement](https://pia.gov.ph/news/philhealth-sets-5-premium-contribution-rate-for-2026/). Configured source: `src/lib/ph-statutory-rule-packs.ts:55-65`; monthly equivalent: `src/lib/pay-basis.ts:24-70`; premium: `src/lib/payroll-rules.ts:45-68`.

Working rate: 5%, monthly salary floor PHP 10,000, ceiling PHP 100,000. Fixed MBS is not inflated by OT, bonuses or allowances and is not reduced solely by attendance deductions. These configured figures are **UNVERIFIED RATE — needs independent effective-period check**.

| Fictional case | Configured arithmetic | Observed MBS / premium / employee / employer (PHP) |
| --- | --- | --- |
| M6-P01 | Monthly 32,000 × 5% | **32,000 / 1,600 / 800 / 800** |
| M6-P02 | Monthly 9,000 floored to 10,000 | **10,000 / 500 / 250 / 250** |
| M6-P03 | Monthly 125,000 capped at 100,000 | **100,000 / 5,000 / 2,500 / 2,500** |
| M6-P04 | Monthly 10,000.20 × 5% = 500.01 | **10,000.20 / 500.01 / 250.00 / 250.01** |
| M6-P05 / P06 | Daily 700 × *configured* 20 vs 26 days | **14,000 / 700 / 350 / 350** vs **18,200 / 910 / 455 / 455** |
| M6-P07 | Daily 800 × *configured* 22 days | **17,600 / 880 / 440 / 440** |
| M6-P08 / P09 | Daily cap / floor examples | **100,000 / 5,000 / 2,500 / 2,500** and **10,000 / 500 / 250 / 250** |
| M6-P10 | Monthly 35,200 / 22 / 8 = 200 per hour; 15m late = 50, 30m undertime = 100 | Fixed **35,200** MBS; premium **1,760**, split **880 / 880**, not reduced by lateness |

**Critical dependency:** The configured `standardWorkDaysPerMonth` (20, 22, 26, etc.) is **not automatically the lawful equivalent monthly basic salary** for a specific worker. The reviewer must independently establish contract, actual workweek, paid holidays, employment start/end dates, and the applicable DOLE equivalent monthly rate. Do not assert a universal daily multiplier. Verify actual payroll exclusion of non-basic income and attendance deductions; independent EPRS/agency acceptance is **NOT_RUN**.

## M-8 — Requested / applied / uncollected mandatory deductions

Source: `src/lib/payroll-mandatory-shortfall.ts:16-95` and `src/lib/payroll-assurance.ts`. The allocation algorithm gives a provisional tax-first presentation, **not** a legal decision to waive or partially remit an agency payable.

| Fictional case | Arithmetic | Observed |
| --- | --- | --- |
| M8-D01 | Gross **100**; SSS **80** + PHIC **40** + HDMF **10** + tax **100** = requested **230** | Applied tax **100**, other applied **0**; uncollected **80 + 40 + 10 = 130**; net **0** |
| M8-D02 | Gross 0; SSS 10.01 + PHIC 5 + HDMF 2.02 | **17.03** entirely unpaid; net zero |
| M8-D03 | Gross **0.01**, SSS due **0.02** | Applied **0.01**; uncollected **0.01** |
| M8-D04 | Gross **300**, requested **230** | All **230** applied; zero unpaid; net **70** |
| M8-D05 | Gross **100** plus year-end tax refund **50**, net mandatory demand **200** | Applied net **100**, uncollected **100**; refund line remains **−50** |
| M8-G01 | Trace requested **230**, applied **100**, unpaid **130** | Assurance reports `MANDATORY_DEDUCTIONS_UNCOLLECTED` **high / blocking** |

The actual payslip, GL/journal, payroll export and agency-payable comparison remains **NOT_RUN**. Do not invent a GL payable for the PHP 130 absent approved source mapping and policy. Maker/checker must observe that a high mandatory shortfall prevents release and ordinary exception acknowledgement cannot override that blocker.

## Private human reviewer acceptance protocol

Use `docs/qa/issue-1045-private-review-template.csv` to create **a private copy**. The blank template deliberately contains no real employees, reviewers, amounts or signatures. Retain identity and access information, private screenshot/hash references, payroll originals and account mappings **only in a restricted encrypted vault**, not GitHub.

1. **Independent qualified Philippine payroll practitioner:** derive statutory and final-pay working expectations from authentic, effective official issuances and verified fictional employment calendars; record each expected-versus-observed amount and any unexplained deviation **greater than PHP 0.01**.
2. **Separate accounting checker:** determine and sign legal/accounting treatment of gross/net, requested/applied/uncollected contributions and tax, recoveries, refunds, GL balances, payslip and export.
3. **Separate actual maker/checker witnesses:** on an authorized isolated fictional database/UI, test the final-pay and payroll release blockers and immutability/fingerprint; record runtime deployed SHA, role, test date/time, reviewer assertion and opaque evidence reference.
4. **Deciding owner:** review unresolved high-severity defects, source authority, evidence hashes and separate human signatures; record a decision for this exact build, never infer it from green code tests.

| Gate | Current state |
| --- | --- |
| 23 fictional cases, 160 engine consistency comparisons | **ENGINEERING_MATCH (0 differences)** |
| Effective official rate and daily MBS equivalence | **NOT_RUN** |
| Live fictional UI/database maker-checker/payslip/GL/export witness | **NOT_RUN** |
| Recovery/refund and statutory allocation policy signoff | **BLOCKED** |
| Independent practitioner and accounting checker | **NOT_RUN** |
| Consenting real-employer parallel pay period #579 | **NOT_RUN — separate protected gate** |
| Official agency filing/acknowledgement and bank acceptance | **NOT_RUN** |
| Real-customer payroll activation | **NO-GO** |

Do **not** close issue #1045 or claim legal payroll certification based on this pack. M-10 prior-period SSS/HDMF remittance policy remains a separate open ticket.
