# HCM Business Process v2 and Unified Action Center — pre-client slice

This is a **source-connected first slice**, not Workday parity or a second mutable HR source of truth.

## Implemented

- `/hcm/action-center?organizationId=...` consolidates existing assigned HCM decisions, People Ops follow-ups and owned HR cases. The existing source Inbox decides the actual approval or review.
- Strict, explicit employer selection; company-wide People-admin role, custom deny, People workspace entitlement and existing **default-off** People Home pilot allowlist. Bookkeeper, manager, employee, payroll-only and scoped HR are not granted access to the new page.
- HCM Inbox reads capped at 120 candidates and 25 history items per tab, with truncation flags; employee joins additionally enforce legal employer and decision assignment previews batch delegation checks.
- Minimal history projections never return frozen source snapshots, process source keys or review notes.
- Review-step declines require a 10–500 character reason recorded in the existing authoritative step; a decline terminates the review, it does not send the item back.
- Previous-employer HCM Inbox loads cannot overwrite current-employer state. Partial source evidence must not render as an all-clear.

## Acceptance

Existing fictional-employer PostgreSQL browser QA, negative RBAC and keyboard checks, focused unit contracts, TypeScript, full CI, CodeQL, security and payroll-isolation are required at exact branch head. No remote staging database or production credentials.

## Future BP v2 phases — not implemented here

True send-back, correction, resubmission and rescind require source-specific state machines, append-only revision evidence, approval invalidation, source fingerprints, concurrency locking and maker/checker reauthorization. Do not disguise those operations as an existing `declined` status. Keep payroll release, paid wage correction, SQL migrations and money movement on their own governed paths.
