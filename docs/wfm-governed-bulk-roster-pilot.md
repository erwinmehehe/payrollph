# Governed bulk roster staging and independent publication — PILOT DESIGN

**Status:** unmerged draft. Server write functionality is **OFF** unless an explicitly reviewed staging operator sets `WFM_BULK_ROSTER_PUBLISH_ENABLED=true`. UI staging and checker queue are **hidden** unless `NEXT_PUBLIC_WFM_BULK_PUBLISH_UI_ENABLED=true`. Neither flag authorizes production use by itself.

## Built flow

1. A **company-wide People administrator** chooses up to 20 active workers on a single authorized team-roster page, one future date and one active shift. A minimum 12-character reason and explicit acknowledgement are required.
2. `POST /api/workforce/roster-batches` with `action=stage` requires session, same-origin, tenant role, recent privileged MFA, rate limit and an idempotency key. The server **ignores client preview assurances** and independently reloads the entire source roster.
3. The transaction refuses changes when there is any existing schedule override, unassigned/rest/multi-segment day, unverified worker or worksite, separation conflict, approved leave, captured punch, overtime request, timesheet, payroll period, attendance/cutoff lock, or schedule guardrail issue (advisory or blocking) in the checked ±7-day window. Ambiguity fails closed.
4. A bounded proposal is stored as **pending** with a source evidence hash. **Nothing is published** on stage.
5. A **different company-wide People administrator** reviews the batch with an explicit note and acknowledgement. The backend blocks self-approval and locks the batch row.
6. Approval repeats the source checks in a serializable PostgreSQL transaction, compares the full source evidence hash and only then inserts all schedule overrides, updates the batch to approved and writes an audit receipt **inside the same transaction**. A uniqueness violation or other write failure rolls back every insertion. A stale or ineligible proposal becomes **stale** and publishes no shifts.
7. Rejection writes a decision and audit receipt without publishing shifts.

## Non-goals and boundaries

- The flow does not calculate, release, correct or transfer pay.
- No bank, government, employee pay rate or payroll API is accessed.
- It does not infer missed attendance, unpaid work or statutory OT from a roster draft.
- No silent rest-day changes, retroactive edits, missing worksite selection or silently backdated overrides.
- It is intentionally stricter than the existing one-worker override workflow and excludes even preexisting draft payroll periods.
- Government labor or payroll compliance is **not certified** by these code checks.

## Required before enabling on any real employer

- Independent DBA review and deterministic migration checksum receipt for `0107_governed_wfm_roster_batches.sql`, with backup/restore rehearsal; migration must not be auto-applied to production without approval.
- Two-tenant positive/negative tests, reused employee IDs, old browser response races and unauthorized role access.
- Maker cannot approve/reject own batch; checker cannot approve without source, step-up MFA, explicit note and user action.
- Concurrent submissions: same idempotency key replay, different request collision, two checkers, conflicting same-day override from legacy writer, and concurrent adjacent-date schedule edits.
- **Cross-route concurrency blocker:** existing one-person `create_override` and `assign_schedule` writers do not yet share the batch's organization advisory lock. The current unique override key and serializable batch transaction protect same employee/date duplicate inserts, but adjacent-date rest/overnight conflicts need shared writer-lock conventions before live rollout.
- Philippine policy review: government holiday, overtime, paid break, night differential, rest-day rules, approved partial leave, future separation, workload/rest guardrail configuration and employer pay-period behavior with signed sample results.
- Accessibility, source-payload privacy, period-boundary, 20-worker limit, rollback, and interrupted-response idempotency QA.
- Full exact-head CI, manually witnessed synthetic WFM-to-payroll tests, independent payroll reconciliation and authorized release decision.

## Proposed API contracts

- `GET /api/workforce/roster-batches?organizationId=...`: 50 most recent scoped batches for company-wide People administrators; display fields only.
- `POST /api/workforce/roster-batches` with `action=stage`: `{organizationId, workDate, shiftDefinitionId, employeeIds, reason, idempotencyKey, acknowledged:true}`.
- `POST /api/workforce/roster-batches` with `action=approve|reject`: `{organizationId, batchId, decisionNote, acknowledged:true}`.

All endpoints are unavailable unless the **server** flag is on. The browser UI flag cannot override server authorization. Staging suggestions from `Bulk draft` remain advisory; the server may legitimately reject them.

## Audit vocabulary

- `WFM bulk roster batch staged` (requester identity, employee IDs, evidence hash)
- `WFM bulk roster batch rejected` (independent checker and decision)
- `WFM bulk roster batch marked stale` (no overrides)
- `WFM governed bulk roster published` (maker, checker, override IDs, hash and exact work date)

**No deployment, real-money payroll, production acceptance or certification is implied by a successful synthetic CI run.**
