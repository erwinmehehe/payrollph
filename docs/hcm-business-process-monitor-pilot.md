# Linaw HCM Business Process Monitor: read-only pilot contract

**Status: DRAFT.** This is monitoring code, not a production rollout, external HR approval, signed audit report, or payroll control certification. Tracks issue #712.

## Purpose

Company-wide People owners/admins/HR operators may inspect recorded business-process instance states, reviewer assignments and per-step due timestamps in a read-only source-backed view. Actual Change Job decisions, approval/delegation, send-back and final applications remain owned by the existing transaction surfaces. Never use this monitor to bypass maker-checker, apply pending changes, authorize money movement or infer a source action completed.

## Features and switches

- Server flag: HCM_BP_MONITOR_ENABLED=true gates page and both GET APIs; absent/mismatched value is a 404.
- Entry route: /hcm/business-process-monitor?organizationId=ID
- List GET: /api/hcm/business-process-monitor?organizationId=ID&status=all|in_progress|approved|declined|cancelled|applied|failed&cursor=OPAQUE
- Detail GET: /api/hcm/business-process-monitor/INSTANCE_ID?organizationId=ID
- No POST, PUT, PATCH, DELETE or SQL migrations.
- No navbar link or production flag activated by this draft; a separate navigation change may follow after access review. Disable the server switch and redeploy for immediate code-level denial of new routes.

## Source-of-truth and privacy

- Source: hcm_business_process_instances and hcm_business_process_instance_steps, never a parallel mutable HR ledger.
- Every source query includes the explicit employer ID, and detail queries require an instance ID from that employer. Active membership, session policy and deny-only custom people.admin permission are enforced. Company-wide owner/admin/HR only; no manager, bookkeeper, payroll-only, checker, employee or unit-scoped expansion.
- List is a deterministic descending keyset by initiated_at and id, maximum 20 visible + 1 overflow; next cursor is a validated ISO timestamp and source ID. Status is validated against an allowlist. No claims about unseen process totals.
- Step detail is bounded to 100 visible + 1 overflow, ordered by step index and ID. The API projects only minimal process/step source fields. NO definitionSnapshot JSON, sourceKey, pay/bank/Gov IDs, decision notes, audit metadata or source free-text reasons are returned.
- Named assignee string remains visible to company-wide authorized HR only, because reviewer accountability is the point of this panel. Reviewer display does NOT authorize executing their decision.
- Effective date is a Philippine date-only business scheduling field. It is NOT an SLA. A pending step lacking dueAt reports 'untracked'; only a pending step with an actual dueAt earlier than now reports 'overdue'. Completed/waiting steps do not receive a false overdue/incomplete label.
- Unknown source status is displayed as unknown, never silently assumed approved or complete. Source error = unavailable, not all-clear.
- Client aborts superseded requests and requires matching tenant, filter and selected instance identifiers before showing fetched data.

## Synthetic acceptance scenarios

| Scenario | Expected |
| --- | --- |
| Logged-out, flag off | Denied; no source queries or data |
| Company-wide owner/admin/HR with People custom permission | Requested employer's sources only |
| Bookkeeper, manager, payroll, checker, employee, unit-scoped HR | 403/hidden |
| Deny-only custom People permission or inactive membership | Denied |
| User authorized for A but requests B | No data from B |
| User authorized for A and B with overlapping numeric source IDs | Data is only from the explicit requested employer |
| Forge detail ID from another employer | 404, no assignee, process or worker details |
| 21+ instances, identical initiated_at collisions | Deterministic next page, no missed or duplicated ID in keyset |
| Invalid cursor, negative/unsafe organization or instance ID | 400 |
| 101+ steps | First 100 only; partial evidence marker visible |
| Pending step dueAt null, future, past | untracked, due_later, overdue respectively |
| Date-only effective_date with dueAt null | Never classified as overdue |
| Source outage during employer switch | Unavailable with stale response discarded; no false empty |
| Keyboard, mobile, zoom and screen reader | Reachable labelled filter/buttons, headings, loading/error statuses |
| Source approvals/Change Job/payroll before and after | Identical authoritative action behavior, no mutations introduced |

## Mandatory gates before any production activation

1. Exact-head typecheck, unit suite, lint/build, SQL/financial history, security smoke, CodeQL, payroll isolation checks pass.
2. Independent HCM/workflow, HR operator, privacy/security and database reviewer sign off on data minimization, tenant joins, due-date semantics, indexes and performance. Static tests alone are not authorization proof.
3. Two synthetic employers in a protected staging environment, selected-employer switch, cursor pagination, 101+ step fixtures, missing/overdue dueAt, focus order and keyboard accessibility.
4. Confirm delegated actors cannot use this monitor as an approval shortcut. Use the governed inbox to decide.
5. Release-owner flags, rollback rehearsal and employer UAT documented separately. Merge does not imply permission to enable HCM_BP_MONITOR_ENABLED in production.

## Follow-on

A separate guarded Workday-style action center can incorporate monitored process links, send-back/correction/rescind support and conditional routing only after independently reviewed transaction ownership and maker-checker tests. Historical SLA analytics would require versioned process and source evidence, not invented aggregates.
