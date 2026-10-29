# HMO POST tenant-isolation proof reconciliation (provisional)

Base: main `572740807`. Independent of #1355 expenses/de-minimis, #1370 identifier reviews, #1371 selector consistency, #1372 merged benefits/worksite receipt reconciliation and #1373 payroll variance. HMO is `/api/benefits/hmo`; ordinary enrolments in `/api/benefits` are a separate route.

## Required real HTTP controls

`scripts/qa/tenant-hmo-http.mjs` is unconditionally awaited by the existing guarded second-pass runner. All fixtures are fictional; execution requires CI, production-mode localhost HTTP, disposable loopback PostgreSQL 16 app_db, payout flags disabled and no payment-provider credentials.

Two independent employers have populated owned plan, enrolment, dependent and event records before seven victim sets are seeded. The actual persisted victim IDs must exceed both attackers and six. GET must return actual owned nested members/dependents/events; forged foreign worker, enrolment, dependent and organization-header selectors remain contained. A genuine victim employer must return 403.

All four exported POST action branches require owned HTTP success and persisted effects: create_plan (201), add_dependent (201), update_dependent (200), update_enrollment (200). Owned enrolments also transition active and ended, with expected audit and enrolment events. Forged body employee/plan/enrolment references cannot substitute for the loaded owned object. Foreign-employer actions return 403; foreign enrolment/dependent IDs under an owned employer return 404.

Scoped HR in an empty unit receives a verified empty employee/enrolment/event read and cannot mutate out-of-unit records; ordinary employees cannot use admin HMO methods. A previously authorized owner's same session remains signed in with another active employer membership after target-employer revocation, but GET and every POST action must return 403. Anonymous GET and every action return 401. Every denial compares both victim and owned plans, enrolments, dependents, events, employees, payroll and audit snapshots, and the complete victim snapshot is checked at the end.

## Acceptance and limits

**One POST-only provisional credit proposed; global acceptance remains NO-GO.** The HMO **GET** already had a separate source-pinned tenant-table PG16 proof and is unchanged. The full **POST** four-action suite successfully executed on the fictional PostgreSQL 16/localhost Security HTTP Smoke run [40675730756, job 122773670031](https://github.com/erwinmehehe/payrollph/actions/runs/40675730756/job/122773670031), exact source head `b85715c76be9bf2c9f0ab0f08741853c8983d7d9`. The runner emitted `HMO_GET_POST_HTTP_CANDIDATE` with two independent attackers, four action branches, no provider traffic and zero credits at execution time. Route, runner and suite Git blobs on the reconciliation base are unchanged from that passing head. A later ledger review may now link precisely this **POST** method to the passed proof, without re-crediting GET or another benefits route.

The proposed inventory moves **one HMO POST from GAP to source-pinned provisional COVERED**: **341 COVERED / 10 PUBLIC-BY-DESIGN / 147 GAP** across 498 API methods; 17 page/action gaps remain. Source-contract tests pin the HTTP proof line references, action names, persisted own mutations, victim-only denials, exact victim DB snapshots, and the prior CI job/source SHA. New exact-PR-head CI and independent security/privacy/owner review are still required before acceptance. No release, policy, provider integration or wider tenant certification is implied.

No runtime routes, tenant/audit guards, payroll arithmetic, feature flags, production SQL, Neon operations or provider integrations change. Provider statuses and coverage transitions are fictional local records, not proof of carrier acceptance or an external enrolment. No live carrier/email/bank traffic, real identity records or actual payroll. Rollback reverts only this POST manifest credit, its source-pin tests and this documentation. The original test suite and separate GET credit remain intact.
