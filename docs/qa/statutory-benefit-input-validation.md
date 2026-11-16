# Statutory advisory calculator input validation

Evidence label: **SOLO_VERIFIED_DEV_RECOVERY**. Pure library tests with fictional records; no database, employer data, payment, claim submission or provider access.

The libraries introduced by #1995 are currently unwired: no application route imports either calculator. This repair makes their runtime input boundary safe before a future caller uses them. TypeScript types alone do not validate deserialized input.

## Reproduced failures

- `serviceMonths: NaN` bypassed the six-month eligibility comparison; the same defect affected aggregate service and surgery service records.
- Missing required `priorPaidDeliveries` silently became zero, allowing a paternity entitlement from an incomplete record.
- Truthy strings such as `soloParent: "false"` or `companySickLeaveExhausted: "false"` were treated as confirmed facts.
- Invalid previously-paid sickness counters could expand a day limit or produce `NaN` payments.
- Infinite pay could become an infinite maximum-pay recommendation or differential. An exemption could hide invalid supplied pay.
- Unknown maternity/confinement kinds selected the ordinary live-birth/home branch.
- Non-integer or non-finite date offsets generated invalid deadlines. Hospital calculations ignored malformed start dates and could use a discharge before confinement.
- Malformed supplied contribution payment dates were ignored when their rows lay outside the ADSC window.

## Resulting contract

Malformed records throw `RangeError` before an eligibility recommendation or amount is returned. Required fields cannot borrow optional defaults. Optional counters default only when `undefined`; explicit `null`, strings, non-finite numbers, negative or unsafe counts are rejected. Fractional service months remain allowed. Service measured within twelve months cannot exceed twelve.

Money inputs and derived monetary results must fit a safe centavo magnitude. Day counts are non-negative safe integers; date offsets are signed safe integers. Derived dates retain the supported four-digit year format; leap-day clipping and negative offsets remain supported. Date/month validation errors do not echo the submitted contents.

The existing contribution window, statutory quantities, MSC cap, monetary rounding formula and review flags remain in place. This PR does not settle leave-unit interpretation, contribution eligibility for zero MSC, agency rounding, tax treatment, source-verification gaps or employer policy decisions. It grants no statutory certification or live payroll approval.

## Verification and rollback

`tests/statutory-benefit-input-validation.test.ts` exercises malformed deserialized records, compound overflow, dates and valid controls. The original `tests/statutory-leave-and-sss-benefits.test.ts` remains unchanged and verifies existing valid computations.

The initial twelve regression groups reproduced eleven failures before the repair; the valid-control group already passed. The PR records final test, type/lint and current-head CI results separately. Linux/PG proof and full-system payroll certification are not claimed by these unit tests.

Rollback is a code revert of these pure library changes. No schema, active endpoint, source-proof receipt, coverage credit, deployment flag or data migration is involved.
