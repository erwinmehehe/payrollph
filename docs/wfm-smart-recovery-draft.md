# WFM smart coverage draft and automation depth

## Scope of this increment

This is **review-first schedule assistance**, not fully automated rostering and not AI model output. The authenticated coverage page already has demand, leave, availability, role/skill/site eligibility, schedule constraints, manager claims and maker/checker review. This increment connects those signals into a more useful, explainable manager draft.

- **Coverage priority:** propose staffing for hard-to-fill requirements first, avoiding a flexible role consuming the only qualified worker for a scarce role.
- **Balanced hours:** prefer eligible people with fewer currently planned hours in the selected coverage window, with stable deterministic ties. This is a fairness *heuristic*, not an entitlement/legality decision.
- **Overnight conflict awareness:** use Philippine local work dates and wall-clock shift intervals to detect same-worker assignments overlapping across calendar boundaries.
- **Review and constraints:** high workload-risk candidates are excluded unless a manager opts in; invalid shift evidence is not guessed; max 50 staged proposals match the API limit.
- **Explainable preview:** managers see proposed employee, workload estimate, conflicts avoided, projected coverage and explicit human review.
- **No autopublish:** the preview is pure and read-only. The existing `stage_recovery_plan` creates *pending* open-shift claims only. Independent authorized approval must recheck role, qualification, site, leave, workload guardrails and live coverage before a shift override becomes effective.

## Hardened server boundary

The server never trusts suggestions from the browser. Before opening a transaction for new pending claims it:

1. Requires authenticated authorized workforce management, same-origin mutation and sensitive-action MFA under the existing coverage route.
2. Loads requirement, employee and shift IDs scoped to the requesting organization.
3. Rejects invalid or duplicated employee-day assignments, proposed overnight overlaps and total proposals exceeding the requirement's recorded headcount.
4. Checks the worker's actual published schedule across the previous/current/following Philippine calendar dates. If current work conflicts, **HTTP 409** is returned.
5. Leaves existing live approval, scheduled coverage, leave, skill/certification, worksite and pay isolation checks in force. Nothing writes payroll or moves money.

This does not eliminate concurrent-staging races. Pending claims, manager decisions and policy authorization must remain independently reviewed at approval time.

## Read-only manager operations queue

The WFM coverage page now also prioritizes existing **scoped** coverage gaps, pending open-shift claims, configured schedule guardrail blockers, attendance exceptions and incomplete role/qualification/absence/site evidence. Managers see a stable priority list and links to the appropriate existing review UI. Urgency uses **Asia/Manila business dates**, not the browser's local timezone. Past coverage gaps direct managers to reconcile historical evidence, not create silent backdated shifts. It has no write endpoint, no webhook, no autonomous scheduler, and no payroll permissions escalation. It currently uses the existing coverage API snapshot, not new live-push or predictive ML.

## Synthetic test cases and operator acceptance

- Scarce qualified employee preserved instead of consumed by a flexible requirement.
- Coverage vs balanced-hours draft changes candidate choice without overriding eligibility.
- Two different work dates with overlapping overnight intervals never assign the same person to both.
- Identical work date cannot produce multiple claims for the same employee, even when clock times do not overlap.
- High workload risk excluded unless explicitly selected; 50-claim cap enforced.
- Invalid Gregorian date, impossible shift time, and unsupported equal start/end refused.
- Stage API protection against client-modified double bookings, excessive headcount and conflicts with an already published adjacent-day overnight shift.
- **Staging UI acceptance still required:** real payroll/HR manager reviews coverage, stage, decline, approve, remove/correct and workforce-to-payroll trace in an isolated employer tenant using fictional employees.
- Existing company-configured rest/rolling-hour policies and Philippine premium/holiday obligations continue to be decided by existing separate safeguards. This heuristic is not a legal-compliance certificate.

## Sequence toward Rippling-class WFM (future work, not claimed complete)

1. **Manager operations cockpit:** prioritized live late/missing clock-ins, uncovered shifts, leave conflicts, pending timecard approvals, clock correction SLAs and one-click governed next actions.
2. **Event-driven WFM automations:** deduplicated, tenant-scoped reminders/escalations for shifts approaching uncovered start time, late punches, leave-approved coverage gaps and overdue timesheet approvals; default-off until verified.
3. **Scheduling depth:** save/reuse templates, per-worker availability preferences, shift bids, fair distribution and company policy-aware constrained optimization; simulate cost without disclosing salary to workforce-only managers.
4. **Employee communications/mobile:** shift release and change notifications, manager messaging, availability collection, offline time clock QA and verified device integrations.
5. **Real operational proof:** multi-site employer staging, actual attendance-device certification, independent payroll reconciliation to the centavo, app UX acceptance, security/privacy and controlled rollout.

Unlike Rippling's marketed AI-generated schedules, this phase intentionally uses **auditable deterministic suggestions** from the already governed PayrollPH rule base. Do not describe it as AI-driven, live-deployed or production-certified.
The manager's initial coverage date now uses the Philippine business date (Asia/Manila), avoiding off-by-one-day default roster windows for authorized managers in other timezones. Queue cards use valid block-level markup for stable React hydration.
