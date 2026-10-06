# Golden payroll certification — Phase 3 configurable Pay Rules

Phase 3 certifies every currently executable configurable premium family:

- `worked_time_premium`
- `holiday_rest_day_premium`
- `overtime_premium`
- `night_differential_premium`

Each family is checked twice:

1. **Direct policy-engine golden** against immutable expected amount/classification values.
2. **Database-backed payroll pair** with otherwise identical baseline and overlay employees.

The payroll pair proves that the employee-scoped rule adds exactly the expected premium while statutory/basic pay stays unchanged.

## Coverage sentinel

The certification script discovers exported `*_PREMIUM_EVENT` families from `src/lib/pay-policy-engine.ts`.

CI fails if the discovered executable family list differs from the Phase 3 catalog. A future Pay Rules family therefore cannot become executable without adding golden evidence.

## Invariants

- configurable pay is additive only;
- statutory pay remains authoritative;
- employee-scoped rules cannot leak to the baseline employee;
- tax and contribution-base classifications remain explicit;
- OT authorization remains evidence-only and cannot suppress statutory entitlement;
- statutory 10% night differential remains intact beneath company/CBA top-ups.

## Command

```bash
npm run payroll:golden:pay-rules
```

Evidence artifact:

```text
qa-artifacts/golden-pay-rules-phase3-reconciliation.json
```

This remains engineering evidence and does not replace independent practitioner sign-off or real parallel-payroll certification.
