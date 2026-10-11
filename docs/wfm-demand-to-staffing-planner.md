# Demand-to-staffing planner — isolated engineering candidate

This pure planning kernel converts **approved aggregate workload forecast counts** into scenario headcounts using explicitly supplied productivity (units per paid worker hour), service coverage target and shift paid minutes. It compares the count with the already-approved roster headcount and a **separately scoped and verified** eligible-capacity count. It can estimate illustrative base and overtime labor costs if *all* corresponding cost assumptions are present.

The module deliberately **does not** query employee records or independently validate role eligibility, approved leave, worksite eligibility, mandatory rest, pay grade, overtime authorization or Philippine statutory premiums. API integration must obtain those checks from authoritative existing workforce guards, reject stale/out-of-scope evidence, and bind every assumption to a human-approved effective-dated policy. Unknown or incomplete inputs must remain unknown, never converted into zero coverage, wage or hours.

No live route, database migration, automatic publication, named assignment, payroll calculation, employee attendance determination or new feature flag is introduced. This can be reviewed against the WFM operational demand branch without activating source ingestion.

## Integration tasks (not completed)
- Connect a single authenticated, read-only manager preview API to **issued and scope-checked** forecasts with approved effective-dated productivity and service-level policies.
- Load worksite and role-specific scheduled headcount, qualified available candidate counts, maximum-hours limits, overtime approvals and rest policy from the existing authorization/coverage services. Do not accept those values from browser clients.
- Prove bounded scale, two-tenant isolation, unavailable providers, incomplete slots, reversals/corrections, zero counts and holiday/overnight policy before staging.
- Add scenario comparison, explicit manager review and independent approval. Schedule mutation must remain in the existing governed, revalidating roster path, never in the planner preview route.
- Rehearse schema 0112/0113 independently, reconcile WFM-01–14 (#691) and real no-money shadow payroll (#579) with private evidence. Both human acceptance gates remain NO-GO.

To run focused pure tests after checkout: `npx tsx --test tests/workforce-demand-staffing-planner.test.ts`.
