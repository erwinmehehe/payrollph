# HCM work-item ownership and SLA tracking

This enhancement extends existing `automation_operational_cases` rather than copying cases to a second queue.

## Release steps
1. Apply `migrations/20261009_hcm_work_item_sla.sql` to the workspace database.
2. Deploy the feature branch after tests and permission review.
3. Set a strong random `HCM_SLA_CRON_SECRET` and configure a scheduler to call `POST /api/hcm/work-items/escalate` with `Authorization: Bearer <secret>` every 5-15 minutes. No secret means the endpoint returns 503 and does no work.
4. Update your HCM case management UI to display and edit `ownerTeam`, `ownerUserId`, `dueAt`, `escalateAt`, and `overdue` via the API. API work does not automatically ship UI.
5. Monitor escalation events in `hcm_work_item_events`. Escalation is durable and queryable, but escalation emails are queued to active company-wide owner/admin/HR recipients using the existing outbox. Actual sending requires a configured email provider and worker; in-app notification delivery is not included.

## Endpoints
- `GET /api/hcm/work-items?organizationId=123&status=overdue`: list 200 most urgent cases, with optional `open`, `acknowledged`, `resolved`, `overdue` filter.
- `PATCH /api/hcm/work-items` body: `{ "organizationId": 123, "id": 456, "ownerTeam": "HR Operations", "ownerUserId": 21, "dueAt": "2026-10-15T09:00:00+08:00", "escalateAt": "2026-10-15T10:00:00+08:00" }`.
- `POST /api/hcm/work-items/escalate`: scheduled sweep, at most 100 cases each invocation, with `remainingMayExist` hint.

Only existing, open/acknowledged cases are eligible for ownership updates. Owners must be active in the same organization and have an HR-authorized role. Deadlines accept ISO 8601 timestamp values; pass Manila offsets explicitly. Escalations run only once per SLA schedule; rescheduling resets escalation state and generates an audit event. Closing cases remains governed by the existing case workflow.

## Follow-ups before rollout
- The work queue dashboard is available at `/hcm/work-items`; add navigation from the existing workspace shell and surface event history in the UI.
- Outbox escalation notifications are queued for People-admin leadership; verify provider delivery separately (queued is not sent).
- Company-wide HR access is required. Scoped HR accounts receive 403 until unit-safe case scopes are implemented.
- Add automated API/database tests for cross-tenant access, owner membership validation, overdue boundary, reassignments, idempotency, race conditions and closing a case.
- Configure expected SLA targets by case type/priority; current implementation requires HR to enter explicit deadlines.
