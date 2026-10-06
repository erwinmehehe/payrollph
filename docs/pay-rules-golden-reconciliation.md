# Pay Rules golden reconciliation

This gate protects the configurable Pay Rules families before customer activation.

## Coverage

The engineering golden suite contains **64 fixed expected-value cases**:

| Rule family | Cases | Independent expected-value basis |
| --- | ---: | --- |
| worked_time_premium | 16 | worked hours × (base hourly rate × premium % + fixed hourly premium) |
| holiday_rest_day_premium | 16 | regular worked hours × base hourly rate × company top-up % |
| overtime_premium | 16 | validated OT hours × base hourly rate × company top-up % |
| night_differential_premium | 16 | night-window hours × holiday/rest/OT-adjusted hourly base × company extra differential % |

The expected peso values are stored as fixed constants in
`tests/pay-policy-golden-reconciliation.test.ts`. The test does not calculate its
expected amount by calling production payroll helpers.

Every family also verifies:

- statutory-floor mode remains additive-only;
- statutory holiday/rest-day, OT and 10% night-differential multipliers remain authoritative;
- OT authorization remains evidence-only and cannot suppress entitlement;
- taxable treatment is preserved;
- SSS-base inclusion is preserved;
- Pag-IBIG-base inclusion is preserved;
- exact applied-rule metadata retains the statutory multiplier where applicable.

## What this gate proves

This is an **engineering reconciliation gate** for the four migrated configurable
Pay Rules families. It provides repeatable, reviewable expected-value evidence
against the executable rule resolvers and complements the existing payroll-engine
integration tests.

## What this gate does not prove

This does **not** complete the external payroll-certification issue.

Before Linaw calls payroll outputs independently certified or filing/bank certified,
the project still needs:

1. independent CPA/payroll-practitioner review and sign-off of the broader 50–100
   payroll scenarios;
2. 2–3 real parallel payroll cycles against an incumbent payroll process;
3. government acceptance evidence for generated statutory files;
4. proprietary bank UAT/acceptance evidence;
5. documented tolerances, exception ownership, and retained acceptance evidence.

Those remain tracked separately in issue #192.

## Review rule

A migrated Pay Rules family must not be treated as activation-ready if any golden
case or its existing end-to-end payroll integration tests fail.
