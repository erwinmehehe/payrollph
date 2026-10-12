# WFM deterministic greedy roster pilot — read-only, default OFF

**Engineering candidate. Not an autonomous scheduling feature, not a payroll calculator, and not a production-approved roster.**

## Workflow

1. A workforce manager opens **Coverage → Generate a balanced roster** (hidden unless `NEXT_PUBLIC_WFM_GREEDY_ROSTER_UI_ENABLED=true`) and selects one authorized worksite and a future Philippine date range of up to 14 days.
2. `GET /api/workforce/greedy-roster?organizationId=...&worksiteId=...&startDate=...&endDate=...` is **disabled unless** the critical server flag `WFM_GREEDY_ROSTER_ENABLED=true`. The session must have the existing `WORKFORCE_MANAGER_ROLES` permission. Unit-scoped managers only see their own unit's worksite and employees. Employer and site IDs from the browser are never treated as authority.
3. The server loads **recorded staffing requirements per shift/job profile**, the full bounded eligible worker population (not Coverage's top-five suggestions), effective schedule patterns/overrides, worksite authorizations, availability rules including adjacent overnight intervals, approved leave with exact current interval sets, approved OT minutes, separation status, effective-dated positions, mandatory skills/credentials and existing tenant schedule guardrails. When a worksite authorization is legacy/unconfigured, the candidate is **unknown**, never silently approved.
4. Verified already-scheduled headcount counts toward each requirement. The deterministic solver handles the remaining positions in **scarce-candidate-first order**, then unpopular nights/weekends/holidays, then calendar/requirement ID. For each position it selects the lowest projected worker minutes, with an unpopular-shift rotation weight, finally breaking ties by employee ID.
5. Every candidate re-runs the existing `evaluateScheduleGuardrails` with a tentative shift added to the worker's committed schedule. Overlaps, minimum rest, consecutive days and rolling weeks are checked across adjacent days and overnight windows. The solver applies extra **conservative employer pilot caps** of 12 paid hours/day, 48 paid hours/rolling 7 days and 8 ordinary hours/day with no unapproved overtime. An employer may change its existing guardrail policy; this solver never weakens it or grants override authority.
6. The result reports `roster[]` entries as `existing` or `suggested`, and **one `unfilled[]` entry for each missing worker position**, with a primary reason and count of excluded candidates by reason. It also reports projected minutes and unpopular shift counts per worker. Optional holiday/rest-day warnings are **not pay calculations**.
7. No endpoint writes a shift, staffing requirement, leave, audit event, payroll record or payment. The manager must use the established **maker-checker**, current-source guardrail/leave/site/OT, and pay-premium review processes for every later publication. A stale draft confers no entitlement or approval.

## Scope and limitations

- The rule-set adapter uses `workforce_schedule_guardrail_policies` from current `main`. Draft PR #859 (separate roster-publish rules) is **not merged**, so this solver cannot be represented as having integrated that newer unpublished rules checker. Its publisher must still recheck any subsequently merged rule set.
- Without existing configured guardrails, solver-only default controls are 660 minutes' rest, six consecutive days, and 2880 rolling-seven-day minutes. These are **company scheduling safeguards**, not universal Philippine statutory caps. Labor Code ordinary working hours and actual statutory premium calculations belong to the payroll engine and qualified reviewers.
- Fairness uses **prior 28 days of scheduled/rostered paid minutes**, existing future shifts in the selected horizon, and historical counts of night/weekend shifts. It does **not** infer employee consent, preferences, contract hours, actual worked time, protected class, or a fair legal distribution. Because source data can be incomplete, any employee-level recommendation requires review.
- Precisely timed approved leave only permits a candidate when the requested shift does not overlap any interval. Older/ambiguous leave and half-day leave conservatively block suggested work rather than guessing clock placement. Worksite governance must be explicit; any missing/contradictory source blocks or fails the preview. The API intentionally does **not** infer pay, statutory leave eligibility, agency compliance, or a real optimized workforce solution.
- Bounded pilot: 100 requirements, 200 positions, 1000 visible employees, maximum 14 days. It fails closed on exceeding limits instead of truncating candidate evidence.
- Greedy is not a global optimizer. A deterministically chosen early fill may leave a later slot unfilled even if a backtracking solver could cover both. The server returns **that gap and reasons**; it does not invent a complete solution. Historical fairness and deterministic tie-breaking make the result reproducible, not universally equitable.
- Unit-scoped sites must have an explicit owning org unit matching the manager's active scope. Dynamic-group filtered views do not reuse the full-worksite solver results, so the panel stays hidden when a Dynamic Group is selected.

## Engineering checks and acceptance

Run against the **exact PR head**:

```bash
npx tsc --noEmit
npm run lint
TZ=Asia/Manila npx tsx --test tests/workforce-greedy-roster.test.ts
TZ=Asia/Manila npm test
npm run payroll:golden
npm run payroll:golden:phase2a
npm run payroll:golden:phase2b
npm run payroll:golden:pay-rules
npm run build
```

Do not enable either flag without independent two-tenant, large-population and 375px browser tests; verified leave-interval/midnight/competency and scheduling-rule sign-off; production DB readiness; and a no-money shadow comparison. No public access, automatic shift publication or bank connectivity is added in this iteration.

## Conservative pilot policy and source integrity

A disabled or zero-valued legacy guardrail does not disable the solver's separate 660-minute rest, six-consecutive-day, and 2,880-minute rolling-week pilot safeguards. An existing stricter configured setting is honored. The baseline and proposed schedules are evaluated with the same effective blocking policy, so pre-existing violations cannot be misclassified as introduced by this one draft. Unassigned schedule dates, invalid rest-day configuration and previously approved day-off overrides are never silently replaced by a recommendation.
