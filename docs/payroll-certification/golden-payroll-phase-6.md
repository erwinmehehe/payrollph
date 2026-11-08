# Golden payroll certification — Phase 6 statutory boundaries

Issue: #192

Phase 6 runs **9 employee-level cases through the real PayrollPH payroll engine** (enqueue and drain against a disposable database) at the statutory edges that Phases 1–5 step over. Phase 2A covers salaries from 20,000 in 2,000 steps, so it never lands on an SSS or withholding edge. Every expected value is an immutable literal in `certification/golden-payroll-phase6.json`, derived by hand from the published rules and never with PayrollPH functions. Comparison is exact to the centavo, and every case also checks the employer-side shares (SSS, EC, PhilHealth, Pag-IBIG) and that the printed payslip adds up.

All cases are one monthly-salaried employee, the September 1–15, 2026 first cutoff, with the 50/50 contribution split.

| Case | Monthly salary | Edge it proves |
| --- | ---: | --- |
| `sssBelowEcThreshold` | 14,740 | MSC 14,500: EC ₱10/month (₱5.00 per cutoff) |
| `sssAtEcThreshold` | 14,760 | MSC 15,000: EC steps up to ₱30/month (₱15.00). Net is **lower** than the 14,740 worker despite higher pay |
| `sssBelowCap` | 34,740 | MSC 34,500, one step under the cap |
| `sssAtCap` | 34,780 | MSC 35,000, the cap |
| `philHealthBelowFloor` | 9,000 | PhilHealth uses the ₱10,000 floor, not the salary (₱125.00 per cutoff, not ₱112.50) |
| `taxInFifteenPercentBracket` | 36,000 | Taxable ₱16,575, just under the 16,667 edge: 15% bracket |
| `taxJustPastTwentyPercentEdge` | 36,200 | Taxable ₱16,672.50: ₱937.50 + 20% of the ₱5.50 over the edge |
| `taxTopOfTwentyPercentBracket` | 70,000 | Taxable ₱33,150, just under the 33,333 edge |
| `taxJustPastTwentyFivePercentEdge` | 70,400 | Taxable ₱33,345: ₱4,270.70 + 25% of the ₱12 over the edge |

## Mutation evidence

Three statutory constants were each changed and confirmed to fail exactly the case designed to catch them, before the file was restored: PhilHealth floor 10,000 → 9,000 (`philHealthBelowFloor`), SSS EC threshold 15,000 → 16,000 (`sssAtEcThreshold`), and the 16,667 bracket edge → 16,700 (`taxJustPastTwentyPercentEdge`).

## Not covered

- **Regular 13th-month pay.** Regular payroll runs do not compute it (only final pay and year-end do), so there is nothing to certify here yet.
- The PhilHealth ₱100,000 ceiling and the Pag-IBIG ₱10,000 cap are exercised by Phase 2A.
- Daily-paid and hourly workers' statutory contributions (now certified in Phase 8).
- Second-cutoff month-to-date true-up (Phase 2B).

Salaries 9,000 and 14,740–14,760 are below the NCR minimum-wage equivalent. They are valid fictional part-time rates used only to reach the SSS and PhilHealth edges.

## Run

```bash
npm run payroll:golden:phase6
```

Evidence is written to `qa-artifacts/golden-payroll-phase6-reconciliation.json`, and CI runs the suite after Phase 4 and uploads it.
