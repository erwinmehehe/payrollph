# Worksite authorization + precise absence timing for WFM

**Status:** Approved design. Core worksite eligibility implemented by merged PR #477; residual worksite hardening and precise absence timing remain.
**Date:** 2026-10-06
**Scope:** WFM-supporting HCM, after merged PRs #472–#474
**Order:** Worksite core #477 (merged) → residual worksite hardening → precise per-day partial/hourly leave

## Problem and intent

PayrollPH already tracks effective-dated worksite assignments, position/job-profile history, skills/credentials, approved leave and WFM coverage. Current worksite assignment answers the *default* worksite, not whether an employee is permitted to work at an assigned shift's actual site. Leave stores a start/end date with aggregate days, not exact half-day or hourly timing. Therefore coverage can be overstated or too conservatively withheld, and a rostered employee may not be truly available at that location/time.

Outcome: an authorized manager can answer **Can employee E perform job J at worksite S for shift T, considering work-arrangement authorization, role/skills/credentials, approved leave, and existing WFM guards?** The answer includes separately auditable blockers and warnings, without retroactively erasing attendance or legally earned wages.

## Existing authoritative data

- Worksites and effective-dated default assignments: `worksites`, `employee_worksite_assignments`; `src/lib/workforce-worksite.ts`.
- Effective-dated worker/position history: merged #472.
- Job skill/document-backed credential eligibility: merged #473; `src/lib/hcm-workforce-eligibility*.ts`.
- Approval-backed leave `leave_requests` and coverage/open-shift conflict guard: merged #474; `src/lib/workforce-absence.ts`, `src/app/api/workforce/coverage/route.ts`.
- Approval mutation and timesheet invalidation: `src/app/api/approvals/[id]/route.ts`, `src/lib/workforce-timesheet-server.ts`.
- Existing scheduling, overnight/split-shift segment resolution, attendance and payroll remain source of truth and must not be rewritten by eligibility assessments.

## Architectural choices

**A. Authorization is not assignment.** Preserve the current default worksite assignment. Add dated work-arrangement terms and dated worksite authorizations. Do not overload `employee_worksite_assignments` with permission semantics.

**B. Worksite checks are at the target shift's worksite/date/time.** An employee's default site does not implicitly authorize an arbitrary different site. Requirements may specify site and allowed modalities. Company/role restrictions intersect with employee authorization; a more permissive row cannot bypass an explicit restriction.

**C. Leave uses exact dated intervals.** A single aggregate "0.5 day" is not sufficient evidence of which hours are absent. New leave must carry dated interval(s) when not full-day, and comparisons use scheduled work segments. Historical ambiguous entries remain legible and conservative.

**D. Shared evaluation, multiple enforcement points.** Coverage reporting, open-shift claiming, manager approval and shift reassignment all use the same eligibility service. Separate "scheduled" from "eligible/available" and from "actual work/payable minutes". Recheck eligibility at the commit/approval boundary, not only when viewing the roster.

## Current-state reconciliation

After this spec was written, PR #477 merged the core worksite tranche: effective-dated onsite/hybrid/remote/field arrangements, secondary-site grants, qualified-coverage exclusion, open-shift claim/approval rechecks, explicit schedule mutation checks, legacy warnings, timesheet staleness, and WFM UI. Do not rebuild those parts.

Residual worksite items from this approved design are: explicit dated site restrictions/deny precedence, structured finding codes/evidence instead of only strings, and connected-worker profile visibility. These are a hardening PR, not a replacement for #477.

## PR A: Effective-dated work arrangement and worksite eligibility

### Data

1. `hcm_employee_work_arrangements`: `organization_id`, `employee_id`, `mode` (`onsite|hybrid|remote|field`), `effective_from`, optional `effective_until`, `primary_worksite_id` (optional), origin actor, approval metadata, audit timestamps, reason. Enforce no conflicting active ranges for the same employee; validate all referenced sites belong to the organization.
2. `hcm_worksite_authorizations`: `organization_id`, `employee_id`, `worksite_id`, `effective_from`, optional `effective_until`, `decision` (`allow|deny`), reason, maker/approver evidence, timestamps. Reject contradictory overlapping effective ranges for identical worker/worksite or explicitly resolve `deny` precedence.
3. Optional org/job-profile worksite restrictions only when backed by explicit real requirements. Avoid duplicating site catalog or job profiles.
4. Add indexes covering tenant, employee, worksite and effective dates, and schema migration + baseline parity. Do **not** assign a fixed migration number until checking the current latest migration when code starts.

### Policy and compatibility

- `onsite`: only explicitly permitted physical worksite(s).
- `hybrid`: eligible for onsite authorized sites and separately authorized remote shifts.
- `remote`: eligible for a remote-classified shift/worksite, not automatically authorized at physical facilities.
- `field`: requires relevant field assignment/site authorization, no blanket unrestricted access.
- No active work-arrangement record on an existing tenant: **legacy/unconfigured** with visible warning, not a silent company-wide block. The org turns on strict enforcement only after HR reviews and resolves existing mappings; new explicitly governed records are enforced immediately. Migration must not auto-create guessed permissions or change historical coverage.
- Target worksite must exist, belong to same organization, and be active on work date. Absent or ambiguous worksite is warning/blocker based on whether role-specific physical site is required.
- Enforcement returns: `eligible`, `warning`, or `ineligible` plus individual `code/message/evidence` for unapproved site, explicit denial, mode mismatch, unconfigured policy, dates and source record IDs.
- Only authorized HR/People administrators can edit entitlement data; manager may view eligibility within org-unit scope. Mutations must use existing same-origin controls, RBAC, maker-checker where applicable, audit and tenancy checks. Prevent retroactive changes that silently invalidate finalized pay periods; retrospective correction must create review and immutable evidence.
- Changes to approved permissions or work arrangement stale impacted submitted/approved WFM timesheets or create an explicit review exception; do not delete punches.

### WFM integration

- Reuse existing `resolveDailySchedule` and effective-date job-profile resolution. Determine actual `worksiteId` on each shift segment, using existing schedule override/location data, not simply employee default.
- One shared `evaluateWorksiteEligibility(employee, date, worksite, shift, arrangement, authorizations)` returns structured findings. Combine it with existing skill/credential and rest/availability/leave checks.
- WFM response retains `scheduledHeadcount` and adds `worksiteIneligibleHeadcount`, `qualifiedAvailableHeadcount`, meaningful quality findings; any overlapping blockers exclude an employee only once from the available count.
- Open-shift claim and manager approval verify authorization anew, and the manual schedule mutation endpoint also checks it. Do not block immutable evidence capture or payroll solely because a worker worked at an unauthorized site.

### UI

- Connected worker profile: *Work arrangement* and *Allowed worksites* with effective periods, approval/provenance, warnings.
- Worksite coverage screen: distinct exclusions `unavailable`, `unqualified`, `on leave`, `worksite not authorized`; visible remedy/action for HR.
- Keep compact, mobile-safe People and WFM surfaces; avoid a separate generic HCM dashboard.

### PR A acceptance

- Exact worksite authorization on shift date is respected; other site is blocked; explicit deny overrides allow.
- Mid-range effective-date changes and historical dates behave correctly; no cross-tenant site permission.
- Hybrid vs remote vs onsite vs field classification is enforced without assuming home-based clock events prove remote authorization.
- Existing tenants with no configured rules show migration warning rather than losing all coverage.
- Concurrent changes and approval-time rechecks are tested.
- Payroll and already recorded attendance remain unchanged; eligibility is planning/approval guidance.

## PR B: Explicit full-day, half-day and hourly approved absence

### Data and migration

- Preserve existing `leave_requests` header, aggregate `days`, leave-policy pay treatment and approval linkage.
- Add normalized `leave_request_intervals` keyed by leave ID + date with `kind` (`full_day|first_half|second_half|timed`), `start_local_time/end_local_time` for timed entries, `timezone` (default org/worksite, Asia/Manila where configured), timezone/date/overnight markers, source, actor and approval-state provenance.
- Permit multiple nonoverlapping intervals per date for split shifts; reject malformed times, invalid date span, duplicate intervals, ambiguous non-working-day entries and overlapping approved leave without a resolution workflow.
- Old aggregate-only requests are labelled `legacy_ambiguous` unless demonstrably full-day according to existing safe interpretation. Do not invent 4h for 0.5 day, or distribute a weekday total over weekends.

### Interpretation and shift-time logic

- Define **first/second half** as first/second 50% of the *scheduled paid work minutes* on that leave date, excluding unpaid breaks; for split shifts, partition ordered paid segments. If there is no schedule, present an evidence blocker rather than assuming 08:00–12:00.
- `timed` intervals match timezone-aware wall clock times to scheduled segments, including overnight shifts and date boundaries. If there are timezone/DST ambiguities or a schedule change after approval, require review rather than silently changing approved leave.
- Compute `unavailableMinutes`, `availableScheduledMinutes`, and `partiallyAvailable` per shift segment and role/site, not by turning any partial leave into a full-day absence.
- `full_day` should cover the relevant scheduled workday; approved leave entitlement can be paid or unpaid according to existing policies, separately from WFM coverage.
- A full open-shift claim requires **zero** overlapping approved leave; for a partial-shift/split-shift claim, only permitted non-overlapping segments are eligible. Manager approval rechecks on current authoritative leave evidence.

### Approval, timesheets, payroll

- Leave submission validates precise intervals but preserves current maker-checker approval and leave entitlement.
- Leave approval/revision/withdrawal stales all overlapping submitted/approved timesheets, adds auditable change evidence and makes downstream checks recalculate; make update + invalidation atomic where possible.
- Store immutable original and amended interval history. Do not delete time punches, adjust gross wages by coverage logic, suppress approved statutory OT/holiday/NDP, or change pay treatment without independent payroll rules.
- Payroll continues using approved leave and the existing policy engine, with exact-day/hour evidence available for calculations only after specific tests prove consistency. If exact leave interval conflicts with recorded work, flag a payable-time review, not automatic non-payment.

### UI

- Submit/edit leave: date(s), Full day / First half / Second half / Custom hours, scheduled paid time preview and actual worksite timezone; show exactly what will be unavailable.
- Manager review: clear requested time windows, schedule/coverage impact, conflicting approved leave and any missing schedule information; approval must not manufacture hours.
- WFM: show qualified headcount and available planned labor-hours separately, plus partial absence detail and recovery options.

### PR B acceptance

- Hourly and half-day leave overlap a single, overnight, and split shift correctly; unpaid breaks not double-counted; period boundaries tested.
- Approved partial leave only reduces its intersecting scheduled minutes. Non-overlapping open-shift segments remain eligible; complete conflicts block claim/approval.
- Legacy `0.5 day` remains ambiguous; no guessed 4-hour window.
- Concurrent approval/edit and timesheet staleness are deterministic; separate payable time evidence survives.
- Payroll trial validates compensated leave, statutory premiums, rounding and historical exports remain stable.

## Cross-cutting tests and release gates

For each PR: schema migration/baseline verification; tenant isolation and RBAC/MFA where applicable; effective-date and concurrency tests; positive/negative/legacy scenarios; scheduling and overnight/split-shift coverage; time punch vs approved leave reconciliation; all statutory payroll calculation tests; TypeScript; full unit/regression; production build; CodeQL; security HTTP smoke; fresh-tenant payroll pilot; real browser QA on People, leave, and WFM views at desktop and narrow viewport.

Do not merge until all required checks pass. Deploy/production claims require separate verification. No new Automation Studio feature development as part of these PRs. Hardware attendance device certification remains outside this scope.

## Sequencing and implementation boundaries

- **First PR:** work-arrangement/authorization schema, governed API and profile UI, shared evaluator, coverage/claim/approval/manual roster integration, tests.
- **Second PR:** interval schema and validation, leave request/approval UI, precise overlap evaluator, qualified planned-hour coverage, claim/approval integration, timesheet invalidation, tests.
- Do not overlap code changes across two active PR branches until first is merged or second explicitly rebased on a fixed commit.
- Use fresh PR numbers; #475/#476 are tentative sequencing labels, not reserved identifiers.

## Non-goals

No new LMS, ATS, engagement, generic HCM, salary advances, automation triggers, hardware certification, biometric identity changes, geofencing/employee surveillance, or automatic wage suppression.
