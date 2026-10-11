# WFM Demand-to-Staffing Planner — manager what-if pilot

**Release status:** draft, default OFF. Stacked on WFM aggregate demand #828, including branch-integrated issued forecasts from #832. Never merge or activate a payroll provider to satisfy this feature's database migration history.

## Manager journey (now in source)

1. A separately authorized company People admin imports aggregate demand and issues a SHA-checked, as-of future demand forecast. No unsupported provider certification is claimed.
2. In **Workforce → Coverage**, the new default-OFF Demand-to-Staffing panel selects an active worksite, a shift, a specific role (or legacy generic requirement) and a frozen issued forecast. It is hidden unless both `NEXT_PUBLIC_WFM_ISSUED_DEMAND_FORECASTS_ENABLED=true` and `NEXT_PUBLIC_WFM_DEMAND_STAFFING_ENABLED=true` are set.
3. The manager supplies hypothetical **activity units per worker hour** and **percentage of forecast volume to cover**. Neither has a fabricated default nor becomes approved policy. An explicit acknowledgment is required.
4. Forecasts are matched by exact Philippine interval over the whole selected shift, including overnights. The **busiest 15/30/60-minute forecast interval**, not the daily average, drives the preliminary worker count. Every expected forecast interval must exist. Partial/missing forecast evidence means **unknown**, never zero. A future shift that has started or passed also becomes unknown.
5. Role-specific **already scheduled and available** headcount comes from the existing, role-scoped coverage GET, not the browser's proposed values. Missing/ambiguous requirements remain unknown. Alternate upper-forecast sensitivity shows a second comparison. Limited policy/role/shift/cost mismatches are clearly flagged.
6. Visible illustrative **added base-pay exposure** derives only from an existing People/payroll-authorized labor benchmark for that requirement. Shift wall duration and unpaid breaks are accounted for. No invented employee wages, statutory multipliers, holiday/night premiums, benefit rates or overtime approval. Overtime and named-worker eligibility stay **unverified**.
7. A manager can acknowledge a local review and follow the link to the **existing** WFM smart recovery/stage-for-approval control. This is not a persisted sign-off. The planner makes **no HTTP mutation** and cannot stage, approve, publish, clock, or pay anyone.

The WFM kernel and source-joining module have fictional unit tests for peak throughput, missing intervals, missing role requirements, cross-tenant/hash mismatches, cost redaction, overnight shifts, bounded inputs and non-publishing behavior.

## Security and evidence boundaries

The component uses the existing `GET /api/workforce/demand-observations/issued` (role-scoped employer/worksite, SHA-integrity checked and independently default-OFF allowlisted) and `GET /api/workforce/coverage` (role-scoped, job profile/capability/site/leave/availability calculations and People/payroll-only labor-cost output). The client joins **only those previously authorized, scoped values**. It refuses mixed-tenant source snapshots and filtered Dynamic Group roster comparisons.

A ranked top-five candidate list is **not** proof of an exhaustive, rest-certified eligible workforce. Hence the preview deliberately leaves `availableEligibleHeadcount=null` and candidate/mandatory rest/availability status unknown even when it can compute a forecast-driven gap. This means the UI is always **review-required**, not production-autonomous optimization.

The existing recovery flow handles worker-level eligibility, conflict detection, rest policy and separately governed approval **after a fresh authoritative server check**. This feature does not bypass that process or transform estimated demand into live requirements. Later headcount planning policies must be versioned and approved server-side before operational decisions.

## Required follow-up before any pilot promotion

- [ ] Exact-head full CI, TS/Next build, synthetic Postgres and 375px actual browser screenshot tests with isolated two-tenant fixtures (not only these source tests).
- [ ] Reconcile complete and missing issue horizons, overlap/split shifts, historical corrections, overnight service day, partial leave, role changes, credentials, employee availability and rest policy in staging.
- [ ] Implement an independently consented, authenticated source adapter with verified freshness, correction provenance and missing-interval handling (#838). The existing aggregate import is not a real POS API.
- [ ] Version and approve productivity/service policy by worksite/role/effective date, with approver trace and objective service metric; typed what-if inputs do **not** satisfy this.
- [ ] Add a server-rechecked authorization and review snapshot if this planner is ever allowed to feed a persisted staffing requirement; do not accept browser-created headcount as authorization.
- [ ] Make full projected cost and overtime evidence specific to candidate employees and authorized wage/OT policies. Continue to deny employee-level action on unknown skill/site/leave/rest/hour evidence.
- [ ] DBA independently checks proposed WFM SQL 0112 and 0113 and applied schema/checksums before any migration. Xendit provider remains an unrelated draft at 0114.
- [ ] Complete independent WFM-01–14 human acceptance (#691), real no-money payroll shadow period (#579), and production gate (#112); all remain **NO-GO**.

## Focused tests

```bash
npx tsx --test tests/workforce-demand-staffing-planner.test.ts tests/workforce-demand-staffing-evidence.test.ts
npm run typecheck
npm run build
```

No credentials, provider records, employee data, real wages, deployment, migration or production flag activation were used to build this source.
