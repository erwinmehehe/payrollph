# Golden payroll Phase 31: loan priority, benefit deferral and balance caps (proof-only)

Phase 30 proved the deduction waterfall at a salary where withholding is zero. Phase 31
proves three more rules at a taxed salary (30,000 monthly, withholding 503.70 a cutoff).

- Catalog: `certification/golden-payroll-phase31.json` (hand-derived literals, zero
  centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase31.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase31-pg16.yml`, an empty disposable PG16 on
  GitHub Actions. The harness refuses to run anywhere else.

**Proof-only.** No calculation, route, schema, migration or manifest file is changed. The
government-loan-first rule and the priority order are the product's own money-integrity
rules, not statutes.

## The three rules

1. **Government loans go first.** A loan whose type names SSS, Pag-IBIG, HDMF or calamity is
   deducted before any other loan whatever the ids, so when pay is short the company loan
   takes the shortfall.
2. **A benefit share that does not fit is deferred whole**, and the deductions after it still
   proceed (they are not held back for it).
3. **A loan never deducts more than its remaining balance.** That is not a shortfall, so it
   raises no review flag.

## Setup (tax year 2026, `split` timing, monthly salary 30,000)

Four workers hired 2026-07-01, so only the 12 engine cutoffs exist. An ordinary cutoff:
gross 15,000; SSS 750, PhilHealth 375, Pag-IBIG 100 (1,225); taxable 13,775; withholding
15% x (13,775 - 10,417) = 503.70; net 13,271.30. Disposable pay before optional
deductions: 13,271.30.

## Cases

| Case | Requested a cutoff | Taken | Net | Status |
|---|---|---|---|---|
| noDeductionControl | none | none | 13,271.30 | Ready |
| governmentLoanFirst | company loan 8,000 (older id) and SSS loan 8,000 | SSS loan **8,000**, company loan **5,271.30** (limited) | 0.00 | Exception |
| benefitShareDeferred | voluntary 500, benefit 15,000, company loan 6,000 | 500, benefit **0** (deferred), loan 6,000 | 6,771.30 | Exception |
| loanCappedByBalance | company loan 4,000 with 2,500 left | loan **2,500** | 10,771.30 | Ready |

Year end is the control's for every worker: gross 195,000 (180,000 + 15,000 accrued 13th
month), non-taxable 29,700, contributions 14,700, taxable 165,300, tax 0.00, withheld
6,044.40, refund 6,044.40. The loan's label ("Loan, SSS Salary Loan") names an agency, which
is exactly the case Phase 24 fixed at year end.

## Mutation checks (run locally, file restored afterwards)

| Mutation in `src/lib/payroll-engine.ts` | Result |
|---|---|
| government loans no longer ordered first | `governmentLoanFirst` fails (24 mismatches); the others pass |
| loan no longer capped by its remaining balance | `loanCappedByBalance` fails (24 mismatches); the others pass |
| benefit share taken partially instead of deferred | `benefitShareDeferred` fails (36 mismatches); the others pass |

## Limitations

- Only an SSS loan is exercised as a government loan. Pag-IBIG, HDMF and calamity types reach
  the same rule by name match, and several government loans ordered among themselves (by
  id) are not exercised.
- Release settlement (the balance falling, repaid status) is not exercised; the harness
  marks runs Released directly, so the capped balance recurs every cutoff.
- An earned wage advance is not exercised here (see Phase 30).
- Final pay (separation) is not exercised (see Phase 25).

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data.
Money, payout, provider, CSP and calculation-history flags stay off. No method is
credited or re-credited.
