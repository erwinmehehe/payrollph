# Linaw HCM Manager Decision Inbox — read-only source acceptance

**Status:** draft source integration, feature flags OFF, not live, not a new approval engine. Reintegrated from closed-unmerged PR #730 on the current main with stricter activation scope and React request isolation.

## Purpose

This original Manager Decision Inbox uses three authoritative sources:

1. Pending HCM business-process steps, joined to their exact in-progress instance (and a linked pending approval task for approval-type steps).
2. Pending leave requests linked by approvalTaskId to a current approval_tasks record.
3. Pending overtime requests linked by approvalTaskId to a current approval_tasks record.

All pending requests in a department are NOT automatically assigned to a manager. A source task must match a candidate approver string and pass the existing canDecide policy recheck for the authenticated user. Each source has its own cursor; final approvals must use the owning source workflow, not this monitor.

Payroll approval tasks, compensation-change HCM processes and termination processes are excluded. No approval mutation endpoints are added.

## Security and release flags

- Server-only `HCM_MANAGER_DECISION_INBOX_ENABLED=true` **and** an exact employer ID in `HCM_MANAGER_DECISION_INBOX_ORG_IDS` must both be set before the API or page can read data. No wildcard or implicit first-employer choice.
- Public `NEXT_PUBLIC_HCM_MANAGER_DECISION_INBOX_ENABLED=true` plus `NEXT_PUBLIC_HCM_MANAGER_DECISION_INBOX_ORG_IDS` only show the Approvals workspace link to a matching employer; public variables never grant server permission.
- All flags remain unset for production. Rollback is the server flag disable/redeployment; hiding navigation alone is insufficient.
- Requires authenticated membership, valid organization session, deny-only workforce.manage permission, and a manager scoped to one concrete active org unit, or owner/admin/hr within authorized company-wide/exact-unit scope.
- Company-wide managers, unitless managers, bookkeepers, checkers, payroll processors and employees do not gain this HR preview.
- Every join to source requests, approval tasks, HCM process instances and employee identity uses the explicitly requested employer ID in SQL. Scoped managers see verified workers in their exact unit, not inferred descendants or employer-wide position-only processes.
- Delegation source reads are capped at 150, with an error on overflow. The existing canDecide function rechecks each distinct approver including role targets and active delegation chains.
- Two active company members with the same name do not establish unique named/delegated assignment evidence. Role-target visibility is still governed by role-specific canDecide.
- HCM process steps must be current, pending and linked to an in-progress source. Approval-type HCM steps must also reference an active pending approval task, and initiators cannot be shown their own HCM approval/review step as an eligible decision.
- No raw leave reasons, overtime reasons, approval task titles/details, delegation reasons, free-text notes, compensation, bank, payroll, statutory IDs, confidential documents or process snapshots are returned.
- API responses use private, no-store headers; no writes.

## Performance and display semantics

- Explicit positive organizationId in the URL; never silently select first membership.
- GET /api/hcm/manager-decision-inbox?organizationId=POSITIVE_ID&source=hcm|leave|overtime&beforeId=OPTIONAL_POSITIVE_ID.
- SQL filters tenant, status, unit and candidate assignment label before a 20+1 source limit, then revalidates identity/assignment. A candidate page can display fewer than 20, or no eligible records while an older page still exists; do not claim the whole queue is clear.
- Page counts describe only the current candidate page, not the entire employer.
- An overdue SLA requires an actual HCM step dueAt timestamp. Do not use leave start/end dates or overtime work dates as a contractual deadline.
- Stale browser requests are aborted; response envelope must match employer/source/cursor and the authorized manager scope independently derived on the server-rendered page; switching employers remounts the client to reset its state.
- Pagination cursors refer to the last scanned **source candidate**, not necessarily the last visible, authorized row. An empty display can validly have `hasMore=true`; response validation checks descending visible IDs and strictly progressing candidate cursors without exposing hidden candidate identities.
- The UI is read-only; decision controls and any per-task deep links remain with source applications.

## Pre-client source integration

- [ ] Exact-head CI, TypeScript, synthetic PostgreSQL two-employer tests, production build, CodeQL, security HTTP, payroll isolation and DR checks pass.
- [ ] Maintainer source diff review confirms no writes, employer predicates, maker/checker exclusions, source status checks, fixed ceilings and privacy-minimized response.
- [ ] Synthetic-source role, cross-tenant, duplicate named approver, expired delegation and stale browser request tests pass.

## Separate real-employer activation checks — not source merge prerequisites

- [ ] HR reviewer validates assignment labels and that compensation, termination and payroll approval sources remain excluded.
- [ ] Security/privacy reviewer checks current role/permission deny, delegation expiry, maker exclusion, unit/supervisory scope and client switching.
- [ ] Data reviewer reviews bounded 20+1 SQL query plans, delegation cap and response-time evidence.
- [ ] Authorized QA operator tests actual workflow status changes, incomplete candidate pages, rapid employer/role switch, keyboard/mobile/screen reader and no-store behavior in an appropriate test environment.
- [ ] Release owner records exact deployment SHA, server/public employer allowlists, rollback, and explicit feature activation authorization.

**Pre-client source merge does not require a separate staging project; it also does not enable a live employer workflow.** No feature flags or production data are changed by this PR.

## Later work

Actual approval/rejection actions, per-record drill-through, delegated decision controls and cross-unit supervisory reporting require independent source governance and approval, and are NOT part of this read-only pilot.
