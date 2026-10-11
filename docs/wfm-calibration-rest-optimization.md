# WFM: historical recorded-time calibration and proposal rest optimization

**Status:** source-level, review-only enhancement. This is not a UKG-equivalent predictive model.

## History and forecast quality

The existing authorized Coverage screen has scheduled/actual/required labor-hour evidence in `laborVariance.rows`. The new read-only panel compares historical recorded hours with scheduled hours, calculating weighted absolute variance, signed hours gap and sample coverage **only** if at least seven complete rows across three past Philippine work dates are available.

Future rows, zero/missing recorded work, incomplete attendance and flagged source rows are not treated as genuine zero hours. When unmatched punches or role, capability, leave or site quality problems exist, the panel blocks the metric and requests reconciliation. This avoids describing missing clock evidence as observed underperformance.

The screen includes a one-click previous-14-days window, but there is no real customer demand feed (sales, calls, orders, traffic, POS), historical versioned demand observations or predictive model backtest. These numbers are **schedule-versus-recorded** operational calibration, not "forecast accuracy", overtime entitlement, proof of attendance misconduct or a payroll calculation. No PII or wage fields are added.

## Roster planning

The existing deterministic scarcity-first/balanced-hours planner already handles source-filtered eligible workers, overlapping assignments, workload budgets and consecutive-day caps. This increment adds `minimumRestMinutes` as an optional **blocking** company guardrail between **proposed** shift intervals, including across midnight and calendar dates. The proposal compares the real instant gaps, excludes an insufficiently rested candidate, and can select another already-eligible worker. The UI shows the skipped proposed rest-gap candidates.

Only an **active, enforcementMode=block** source policy is forwarded to the draft. Advisory policy is not silently treated as a statutory prohibition. Published adjacent-day schedules, applicable payroll premiums and all authoritative HR/site/leave/timecard locks are still verified by the existing server at stage and approval; this planner is advisory and never publishes or approves shifts.

## Acceptance/remaining UKG gap

- Run exact-head CI, TypeScript, full tests, cost/privacy source guards, production build and synthetic scenario comparisons (including overnight and adjacent dates).
- Perform manager/bookkeeper inspection with realistic shifts, unpaid breaks, missing punch cases and actual guardrail policy.
- Test historical 14-day windows with independent expected/recorded data and quality warnings in a scoped pilot.
- **Next:** separately ingest approved historical demand measures, record frozen predictions, then measure true demand forecast error by site/role/interval. Only after this may automated demand models be labeled predictive.
- No default feature activation, new schema, payroll adjustment, provider request or independent user acceptance is implied by this source increment.
