# Golden payroll certification — Phase 2B

Issue: #192

Phase 2B exercises complex payroll lifecycle paths through the authoritative PayrollPH engine and ledger state.

## Golden cases

1. **₱90,000 shared benefits pool crossing** — prior released payroll carries ₱85,000 of qualifying benefits; the current ₱7,000 bonus exempts ₱5,000 and taxes ₱2,000.
2. **Mid-cutoff hire** — a monthly employee starting September 8 is prorated over the September 1–15 cutoff and reconciled through contributions, withholding and net pay.
3. **Retro pay** — a pending effective-dated retro adjustment is included once in gross and tax bases.
4. **Leave treatment** — paid, unpaid and 50%-paid leave preserve monthly salary semantics and do not double-pay.
5. **Loan waterfall** — government loan recovery precedes company loan recovery; lower-priority recovery is capped by disposable pay.
6. **Month-final statutory true-up** — the final cutoff reads a released earlier cutoff and reconciles SSS, PhilHealth and Pag-IBIG to actual month-to-date amounts.
7. **Special holiday + rest day + OT + NSD** — statutory premium factors and approved OT evidence are reconciled from actual attendance.
8. **Final pay** — final salary, prorated 13th month, tax refund, final statutory deductions and loan recovery are reconciled through the final-pay engine.

Expected values are immutable literals in `certification/golden-payroll-phase2b.json`.

## Command

```bash
npm run payroll:golden:phase2b
```

Evidence artifact:

```text
qa-artifacts/golden-payroll-phase2b-reconciliation.json
```

## Certification boundary

Phase 2B is engineering evidence. It does not replace independent CPA/payroll-practitioner sign-off, real parallel payroll cycles, government portal/file acceptance, or proprietary bank UAT.
