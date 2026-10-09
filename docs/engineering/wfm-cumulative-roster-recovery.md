# WFM smart roster recovery — cumulative safety for draft planning

Rippling-style WFM needs a **manager-readable schedule draft with real-time capacity tradeoffs** rather than isolated, highest-score-per-shift suggestions. PayrollPH's existing WFM Coverage panel already resolves availability, job-profile/credential eligibility, approved leave, worksites and schedule overlap. This improvement builds on that verified data.

## Manager-facing draft safeguards

- Uses the existing best-fit coverage simulator; it remains **read-only** until a manager explicitly stages proposed shifts through the existing governed `stage_recovery_plan` action, which produces **pending claims, not published assignments**.
- Carries each employee's simulated hours and number of prior proposed shifts forward so the same candidate cannot be repeatedly picked based on a stale planning baseline.
- Examines requirements **chronologically** to calculate consecutive days from already selected drafts.
- Applies **conservative company-planning thresholds** of 96 projected hours across the Coverage panel's 14-day window and six consecutive working days. These are draft filters, **not universally applicable Philippine labor-law interpretations**; statutory overtime/rest-day and employer-specific rules remain in their authoritative payroll/guardrail modules.
- Rejects proposals with **missing shift duration, missing scheduled workload, invalid dates or missing streak evidence** rather than fabricating safety values.
- Updates preview scoring to distribute work more fairly when comparably eligible alternatives exist, without assigning anyone automatically.
- Shows exclusion counts for high-risk, projected capacity, consecutive-day, and incomplete evidence checks.

## Existing independent approval chain

A manager may stage only the remaining draft suggestions for approval. The server rechecks live eligibility, approved leave, schedule and worksite before storing pending claims. Managers or independent approvers then decide whether the changes are acceptable; **no simulated draft may directly publish a roster or alter payroll**.

## Acceptance before release

- [ ] Verify sorted dates and repeat-assignment caps against synthetic 14-day work schedules.
- [ ] Verify company-specific allowable hours and additional consecutive-day policies with HR and Philippine payroll reviewers; the pilot thresholds must be configurable before broad roll-out.
- [ ] Confirm server-side staging cannot bypass governed approvals and role/tenant boundary checks.
- [ ] Compare cost/premium projections against actual approved rates and statutory controls before labeling the feature payroll-compliant.
- [ ] Test >100 shifts, split/overnight work, dynamic worker groups, location changes and worker qualification expiry in staging.

## Next toward intelligent scheduling

Introduce a versioned, approved company scheduling policy, shift-level holiday/OT cost preview, operator-confirmed draft generation from last week's rota or typed intent, fairness history, and notification on **approved** schedule publication. Genuine predictive/AI recommendations should be evaluated against real employer scheduling data before enabling.
