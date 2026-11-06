# Golden payroll certification — Phase 4 tax classification

Issue: #192

Phase 4 runs **9 employee-level cases through the real PayrollPH payroll engine** (enqueue and drain against a disposable database) for tax-classification paths that Phases 1–3 do not exercise. Every expected value is an immutable literal in `certification/golden-payroll-phase4.json`, computed by hand from the cited rules and never with PayrollPH functions. Comparison is exact to the centavo.

| Case | What it proves |
| --- | --- |
| `deMinimisWithinCeiling` | Rice subsidy inside the RR 29-2025 ₱2,500/month ceiling is fully tax-exempt |
| `deMinimisExcessIntoPool` | Excess over the ceiling moves into the ₱90,000 other-benefits pool and stays exempt while the pool has room |
| `deMinimisExcessAfterExhaustedPool` | The same excess is taxed once a released payroll has used the full ₱90,000 pool |
| `leaveConversionExempt` | Monetized vacation leave flagged exempt is excluded from taxable compensation |
| `leaveConversionTaxable` | The same amount flagged taxable is ordinary compensation |
| `yearEndRefund` | An approved year-end refund raises net by exactly the refund, without changing cutoff withholding |
| `yearEndCollection` | An approved year-end additional tax lowers net by exactly the collection |
| `mweTaxableAllowance` | An approved NCR minimum wage earner pays tax only on other taxable compensation |
| `nonMweTaxableAllowance` | The identical worker without an MWE classification is taxed in full, so the exemption is real |

Every case except `yearEndRefund` also proves that the printed payslip lines add up to the stored gross, deductions and net.

## Positions that need practitioner review

The catalog takes an explicit position on three points:

1. **SSS base.** De minimis benefits and monetized leave count as SSS compensation ("all actual remuneration", RA 11199 Sec. 8(f)), up to the ₱35,000 MSC cap. PhilHealth stays on basic salary. Please confirm.
2. **MWE taxable compensation.** For a minimum wage earner, taxable compensation is gross less the statutory minimum wage and less employee contributions, matching BIR Form 2316's separate non-taxable items. Please confirm this for an MWE who also has other taxable pay.
3. **Leave monetization flag.** The engine follows the stored tax-exempt flag. This catalog does not prove that more than 12 monetized days can never be flagged exempt.

## Payslip reconciliation

Every case checks that the printed lines add up to the stored centavos, using the shared classifier in `src/lib/payslip-line-buckets.ts` (economic bucket, not sign). The year-end refund case is the regression test for the bug where the +₱1,200 refund printed as an earning: it now prints as a deduction credit, earnings equal the stored ₱15,000.00 gross and deductions equal the stored ₱528.70.

## Mutation evidence

Two changes were each confirmed to fail this suite before the engine was restored: forcing `treatAsMwe = false`, and zeroing the de minimis exemption.

## Command

```bash
npm run payroll:golden:phase4
```

Evidence artifact:

```text
qa-artifacts/golden-payroll-phase4-reconciliation.json
```

This is engineering evidence. It does not replace independent CPA or payroll-practitioner sign-off, real parallel payroll cycles, or government acceptance.
