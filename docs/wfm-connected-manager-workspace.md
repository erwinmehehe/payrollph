# Connected WFM manager workspace

The Workforce destination opens on **Today**, with **Weekly roster** and **Approvals** as the three primary views. The existing coverage, timecard, overtime, swap, individual schedule, bulk roster, worksite, costing and guardrail tools remain available in a labeled selector.

## Delivered workflow

- Today combines the existing scoped Live Floor with attendance/timecard triage and source navigation for weekly planning, coverage recovery and payroll time preparation.
- Weekly roster retains the existing tenant-scoped seven-day roster, guarded changes and employee receipt review.
- Approvals provides direct navigation to the original claim, swap, overtime, correction, timesheet and optionally enabled batch review screens. It does not manufacture a combined approval total or introduce a shortcut decision endpoint.
- Opening a timecard review from a triage signal passes the selected exact period into Timesheets instead of resetting to its default date window.
- The standalone Today floor opens the Time & attendance destination directly; the existing Coverage floor keeps its local attendance-review anchor.
- Inactive source panels are unmounted. Schedule catalog and employee-preview reads start only when Individual schedules is selected. Employer, user and available access-scope changes remount the workspace to discard old navigation, snapshots and form state.
- Schedule/timesheet defaults use Philippine work dates. Unknown or restricted sources retain their existing loading/error/partial states.

## Boundaries

This changes client navigation and source presentation. It adds no API, schema, permission, notification delivery, feature activation, automatic approval, payroll calculation or payment action. Existing server authorization, maker/checker, MFA and employer pilot flags remain authoritative. The current brand assets are untouched.

## Review and acceptance

Automated component-render regressions verify the initial Today view, hidden-panel exclusion, approval source links, disabled batch pilot and exact cutoff initialization. Existing WFM regression suites cover roster scope, floor evidence, timesheet snapshots and governed source writes.

Before production merge, verify current-head CI and browser checks. In a synthetic staging employer, exercise desktop and 375px mobile layouts, arrow/Home/End tab navigation, secondary tool selection, attendance source navigation, partial-source errors, employer switching, cutoff handoff and source approval/rejection. No real-employer pilot acceptance is claimed by these component changes; the existing WFM pilot matrix and issue #579 remain separate.
