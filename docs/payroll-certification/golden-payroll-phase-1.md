# Golden payroll certification — Phase 1

Issue: #192

## Purpose

This phase adds an executable, evidence-producing statutory boundary catalog before PayrollPH is described as independently certified.

The catalog contains **83 hard-coded expected cases**. Expected results are taken from cited government rules and are not calculated from the PayrollPH functions under test.

### Coverage

| Family | Cases | What is covered |
| --- | ---: | --- |
| SSS / MPF / EC | 14 | MSC floor, bracket midpoints, EC threshold, MPF transition, maximum MSC |
| PhilHealth | 10 | income floor/ceiling, 5% premium, odd-centavo employer remainder |
| Pag-IBIG | 10 | 1%/2% employee breakpoint, 2% employer share, ₱10,000 MFS cap |
| BIR withholding | 17 | all semi-monthly tax brackets, boundaries, MWE exemption |
| Statutory deduction timing | 12 | first-cutoff, second-cutoff, split collection and true-ups |
| Holiday/rest-day/OT factors | 20 | ordinary, special, regular and double holiday combinations |
| **Total** | **83** | |

The executable command is:

```bash
npm run payroll:golden
```

It writes:

```text
qa-artifacts/golden-payroll-certification.json
```

The report includes the catalog SHA-256, cited rule sources, every input/expected/actual result, and an explicit limitations section.

## Source evidence

- **SSS:** Circular No. 2024-006, Schedule of SSS Contributions for Business Employers and Employees, effective January 2025.
- **PhilHealth:** Advisory No. 2025-0002, 5% premium, ₱10,000 income floor and ₱100,000 ceiling.
- **Pag-IBIG:** Circular No. 460, effective February 2024, increasing maximum fund salary to ₱10,000.
- **BIR:** RR No. 11-2018 Annex E, withholding tax table effective January 1, 2023 onwards.
- **DOLE/BWC:** Handbook on Workers' Statutory Monetary Benefits, 2024 edition, for holiday, premium and overtime pay rules.

## What this does **not** certify

This is intentionally only Phase 1. It does not complete issue #192 by itself.

Still required before broad payroll certification claims:

1. 50–100 **employee-level gross-to-net golden payroll scenarios** reconciling gross, taxable income, EE/ER statutory contributions, withholding tax, loans, net pay and GL.
2. Independent CPA/payroll-practitioner review and sign-off of those scenarios.
3. Two to three real parallel payroll cycles against an incumbent payroll system.
4. Government portal/file acceptance evidence.
5. Proprietary bank portal UAT/acceptance evidence.
6. Documented tolerance policy and named exception ownership.

A green result proves only that the currently encoded statutory boundary functions match this independently expected catalog.
