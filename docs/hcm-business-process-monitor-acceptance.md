# HCM Business Process Monitor — synthetic acceptance / release contract

Status: development candidate, default OFF. Reference ticket #712. This is read-only engineering code, not a claim of operational acceptance.

## Workday-inspired monitoring, without a second approval engine

- Explicit legal employer ID; company-wide active owner/admin/HR membership with a successful People-admin role and custom deny-only permission-set check. Scoped HR, manager, employee, bookkeeper, payroll and checker cannot access.
- Server flag HCM_PROCESS_MONITOR_ENABLED=true AND HCM_PROCESS_MONITOR_ORG_IDS containing a canonical positive employer ID are required for API and page. Optional inbox link requires NEXT_PUBLIC_HCM_PROCESS_MONITOR_ENABLED=true and matching NEXT_PUBLIC_HCM_PROCESS_MONITOR_ORG_IDS.
- No implicit first company fallback, no organization switching within a retained client state: links trigger fresh server authorization.
- SQL processes 20+1 newest-first IDs using a stable keyset cursor, with explicit process-status filter. Step timeline is 12+1 oldest-first recorded steps. More evidence is disclosed by hasMore / stepsPartial. A page is never called full workforce total.
- Source projections contain controlled process type and status labels, process/step numeric source IDs, step type and status, PH effective date and actual recorded timestamps. They exclude worker name/ID, initiator or reviewer names, assignee free text, source key, source snapshots, decision notes, salary, personal identifiers and bank data.
- True overdue means only status=pending with a recorded timed deadline earlier than observedAt. A date-only effectiveDate is NOT an SLA. Missing/invalid dueAt is unknown, never 'on time'.
- A selected process with no matching tenant-qualified source returns not_found, not another employer's record. No source decision occurs within monitor code. Use People > HCM Inbox / authoritative approval endpoints to decide.
- A source query failure returns a no-store HTTP 503 and a user-visible 'temporarily unavailable', never a fabricated zero.
- No POST/PATCH/PUT/DELETE, schema migration, outbound email/provider call, payroll calculation or production flag enablement.

## Synthetic QA matrix

1. Two synthetic employers with matching worker labels/source keys but distinct org IDs. HR on employer A sees A only; cross-employer processId is not_found. All instance and step queries must be tenant-qualified.
2. 23 source processes in employer A → page 1 has 20 and hasMore=true; keyset page 2 has 3; no repeated IDs, full list order newest first. Status filter returns only intended state.
3. A process with 13 recorded steps → 12 returned and stepsPartial=true; status and dueAt projected, step label, raw assignee and decisionNote omitted. No claim of comprehensive history.
4. Due deadline before the captured UTC instant on pending step → overdue; future due -> not overdue; waiting/completed steps never claim overdue; null/invalid deadline means missing/unverified, never no breach.
5. Invalid IDs, invalid statuses and flags OFF → 400/404; no-stores on all API responses. No employer default.
6. HR role + company-wide + custom allow passes; custom deny, unit-scoped HR, manager, employee, payroll, checker, bookkeeper and cross-employer requests fail.
7. Keyboard-only filter/selected process links, 375px mobile cards, screen reader headings/status, back/forward employer switch, source outage and full server kill switch. Must be independently reviewed before activation.

## Separate release gates

- Exact-head TypeScript/full test/PostgreSQL/CodeQL/security and payroll isolation checks.
- Protected synthetic two-employer browser acceptance, DBA query review and independent HR/security review.
- Vercel staging isolation, verified source SHA, operational rollback and production readiness tracked by #112/#695/#744.
- Money-moving/payroll processing cannot be authorized by this read-only monitor. Flag activation is a separate owner decision.
