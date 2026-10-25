# HMO GET/POST tenant-isolation batch

Base: main `572740807`. Independent of #1355 expenses/de-minimis, #1370 identifier reviews, #1371 selector consistency, #1372 merged benefits/worksite receipt reconciliation and #1373 payroll variance. HMO is `/api/benefits/hmo`; ordinary enrolments in `/api/benefits` are a separate route.

## Required real HTTP controls

`scripts/qa/tenant-hmo-http.mjs` is unconditionally awaited by the existing guarded second-pass runner. All fixtures are fictional; execution requires CI, production-mode localhost HTTP, disposable loopback PostgreSQL 16 app_db, payout flags disabled and no payment-provider credentials.

Two independent employers have populated owned plan, enrolment, dependent and event records before seven victim sets are seeded. The actual persisted victim IDs must exceed both attackers and six. GET must return actual owned nested members/dependents/events; forged foreign worker, enrolment, dependent and organization-header selectors remain contained. A genuine victim employer must return 403.

All four exported POST action branches require owned HTTP success and persisted effects: create_plan (201), add_dependent (201), update_dependent (200), update_enrollment (200). Owned enrolments also transition active and ended, with expected audit and enrolment events. Forged body employee/plan/enrolment references cannot substitute for the loaded owned object. Foreign-employer actions return 403; foreign enrolment/dependent IDs under an owned employer return 404.

Scoped HR in an empty unit receives a verified empty employee/enrolment/event read and cannot mutate out-of-unit records; ordinary employees cannot use admin HMO methods. A previously authorized owner's same session remains signed in with another active employer membership after target-employer revocation, but GET and every POST action must return 403. Anonymous GET and every action return 401. Every denial compares both victim and owned plans, enrolments, dependents, events, employees, payroll and audit snapshots, and the complete victim snapshot is checked at the end.

## Acceptance and limits

**Prepared only, exact-head HTTP CI pending.** These are two method candidates; both remain GAP until actual HTTP/PG16 execution succeeds and its precise source/receipt links are reviewed. No count changes or sibling-method credit borrowing. Local syntax/source checks are not HTTP acceptance. `tests/tenant-hmo-source.test.mjs` checks the action inventory against the route so a future new action cannot silently be omitted.

No runtime routes, tenant/audit guards, payroll arithmetic, feature flags, production SQL, Neon operations or provider integrations change. Provider statuses and coverage transitions are fictional local records, not proof of carrier acceptance or an external enrolment. No live carrier/email/bank traffic, real identity records or actual payroll. Rollback removes the additive QA suite, runner call and documentation.
