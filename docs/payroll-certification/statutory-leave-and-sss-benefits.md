# Statutory leave and SSS employer-advanced benefits

Status: library and golden tests only. Evidence label `SOLO_VERIFIED_DEV`. No route, schema, balance write, payment or filing is added, so no tenant-isolation ledger credit moves and nothing is activated. This is not a payroll certification.

Code: `src/lib/statutory-leave.ts`, `src/lib/sss-employer-benefits.ts`. Tests: `tests/statutory-leave-and-sss-benefits.test.ts` (17 hand-derived cases).

Scope note: domestic workers (Kasambahay) are out of scope by owner decision.

## Statutory leave rules

| Leave | Rule encoded | Source | Read |
| --- | --- | --- | --- |
| Service incentive | 5 days a year after one year of aggregate service; blocked for the four listed exemptions | Labor Code Art. 95 | **Summary only.** Confirm verbatim text and the IRR exclusions. |
| Maternity, live birth | 105 days, 120 with solo parent, any mode of delivery; up to 7 days allocable to the father or an alternate caregiver; optional 30 days unpaid extension | RA 11210 IRR Rule III-IV, VIII | Primary |
| Maternity, miscarriage or ETP | 60 days; no solo-parent extra applied | RA 11210 IRR Rule III | Primary |
| Paternity | 7 days, legitimate spouse, cohabiting, first four deliveries (a miscarriage counts as a delivery) | RA 8187 Sec. 2-3 | Primary |
| Solo parent | 7 working days a year, paid, after six months of service, forfeitable and noncumulative | RA 11861 amending RA 8972 | Primary |
| VAWC | up to 10 paid days in addition to other paid leaves, extendible as the protection order specifies | RA 9262 Sec. 43 | Primary |
| Gynecological surgery | 2 months full pay on gross monthly compensation, after six months of service in the last twelve | RA 9710 Sec. 18 | Primary |

Primary means a Lawphil reproduction was read, not checked against the Official Gazette.

## SSS employer-advanced benefits

- ADSC: six highest MSCs in the twelve months before the semester of contingency, divided by 180. The semester is the two quarters ending in the quarter of the contingency. Contributions paid on or after the semester start are excluded. MSC is capped at 20,000 for benefit computation (SSS Circular 2020-032 as cited on the SSS pages). Eligibility is at least three monthly contributions in the window.
- Maternity: 100% of ADSC for 105, 120 (solo parent) or 60 days. The employer advances it within 30 days of the application; SSS reimburses up to 100% of ADSC for those days. The employer pays the difference between full pay and the SSS benefit unless DOLE-exempt. Prescriptive period 10 years.
- Sickness: 90% of ADSC for SSS-approved days, at most 120 a year and 240 for the same illness, at least four days of confinement, company sick leave used up. Home confinement: employee notifies the employer within five calendar days and the employer notifies SSS within five calendar days of receipt. Hospital confinement: the employer notifies SSS within one year of discharge. Reimbursement claims are due within one year.

Sources: the official SSS maternity and sickness benefit pages, and the RA 11210 IRR. The sample computation images were not read.

## Hand-derived reference case

Contingency 2026-08-10, semester Apr-Sep 2026, window 2025-04 to 2026-03. MSCs: six at 10,000 then six at 12,000. Six highest total 72,000, ADSC 400.00. Live birth 105 days: 42,000.00. Solo parent 120 days: 48,000.00. Miscarriage 60 days: 24,000.00. Sickness 10 approved days: 360.00 a day, 3,600.00. If every credit is above 20,000, six capped credits total 120,000 and 105 days pays 70,000.00.

## SOURCE NOT VERIFIED (each is a review flag in the code, never a guess)

- Maternity full pay: the IRR defines it by working days; how it prices calendar leave days needs a payroll policy. The caller must supply `fullPayPerLeaveDay`.
- Employer liability when the employee has fewer than three contributions.
- Income-tax and withholding treatment of the SSS benefit and the differential.
- Rounding convention (the code rounds once to the centavo from the unrounded ADSC).
- Employer notice-to-SSS deadline and reimbursement filing deadline for maternity; employer advance timing for sickness.
- Whether the employer may recover from the employee if SSS denies a claim (the code says do not deduct).
- Whether sickness payment starts on day one or after day four; the code pays only SSS-approved days.
- Cash conversion and cumulation for most statutory leaves (not addressed by the cited text); IRR exclusions for service incentive leave.
- The actual gynecological leave period within the two-month ceiling.
- PhilHealth and Pag-IBIG: no employer-advanced cash benefit was researched or encoded. Pag-IBIG and SSS loan deductions already exist in `government-loan-remittance`.

## Not built yet

- Wiring to leave policies, balances, requests and payroll, which would touch tenant routes and need their own isolation proof.
- Leave types, approvals and the SSS notification workflow in the UI.
- Employer-to-SSS submission. The library computes and checks deadlines; nothing is filed.
