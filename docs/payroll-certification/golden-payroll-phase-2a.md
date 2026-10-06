# Golden payroll certification — Phase 2A

Issue: #192

Phase 2A executes **50 employee-level payroll scenarios through the real PayrollPH payroll engine** and reconciles every employee against immutable expected values committed in `certification/golden-payroll-phase2a.json`.

## What is reconciled for every employee

- semi-monthly gross/basic pay
- SSS employee contribution
- PhilHealth employee contribution
- Pag-IBIG mandatory employee contribution
- taxable compensation
- BIR semi-monthly withholding tax
- total deductions
- net pay
- SSS employer contribution
- Employees' Compensation employer contribution
- PhilHealth employer contribution
- Pag-IBIG employer contribution
- payroll exception status

The catalog spans monthly salaries from **₱20,000 to ₱1,200,000**, crossing SSS/MPF caps, PhilHealth caps, Pag-IBIG caps and every BIR semi-monthly withholding bracket.

## GL reconciliation

The same payroll run is passed to the production `generateJournalCsv()` exporter. The certification checks:

- SSS liability
- PhilHealth liability
- Pag-IBIG liability
- BIR withholding liability
- total statutory liabilities
- net payroll / Cash-Bank credit
- employer statutory expense
- total journal debits
- total journal credits
- debit = credit within ₱0.01

Expected aggregate journal totals are also immutable literals in the Phase 2A catalog.

## Command

```bash
npm run payroll:golden:phase2a
```

Evidence artifact:

```text
qa-artifacts/golden-payroll-phase2a-reconciliation.json
```

## Independence boundary

The reconciliation script intentionally does **not** import PayrollPH's SSS, PhilHealth, Pag-IBIG or withholding calculator functions to produce expected results. Expected numbers are committed as static literals and compared to actual output from the real payroll engine.

## Still required

Phase 2B remains responsible for complex lifecycle and exception cases:

- ₱90,000 13th-month / other-benefit pool crossing
- mid-cutoff hire and separation
- retro pay
- holiday + rest day + OT + NSD
- paid/unpaid/partial leave
- government/company loans and insufficient-net waterfall
- month-final statutory true-up

Independent CPA/payroll-practitioner sign-off, real parallel payroll cycles, government acceptance and bank UAT also remain external certification gates.
