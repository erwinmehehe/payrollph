# Benefit enrolment tenant-isolation HTTP candidate

Base: main `387db1a4b` (includes #1350 and #1364). This batch targets three currently GAP methods: GET, POST and DELETE `/api/benefits`. It is separate from #1355 expenses/de-minimis, #1353 BIR certificates, #1361 payroll close and #1365 statutory actions.

The existing Security HTTP Smoke second-pass runner unconditionally awaits `scripts/qa/tenant-benefit-enrollments-http.mjs`. It uses its genuine authenticated sessions and disposable PG16 fixture, with two independent attacker employers and a third victim. Both attacker plans and enrolments are persisted before seven victim records, so real victim IDs exceed both attackers and six.

Controls require populated own GET results, persisted own POST 201, owned DELETE 200 with ended state and audit event, victim-employer 403, foreign worker/plan 404, forged selector containment, and same-session membership revocation denials. Anonymous requests must return 401. Victim benefit plans/enrolments, employee rows, payroll rows and audit events are compared exactly after every denied request and at completion. Revoked deletion must also preserve the formerly owned enrolment exactly.

No production SQL, Neon operations, provider requests, money flags, payroll calculation, payment or real employer data. No runtime authorization or audit guard is changed. Catalogue seeding PUT, HMO workflows, scoped-role acceptance and full benefit lifecycle remain outside this batch.

## Acceptance status

**Prepared evidence only; NOT ACCEPTED.** The HTTP suite has not run locally. Syntax and source-contract tests do not substitute for the actual production-mode localhost HTTP/disposable-PG16 job. All three methods stay GAP in the shared manifest: **zero new method credits**, current main baseline **149 COVERED / 10 PUBLIC-BY-DESIGN / 335 GAP** among 494 methods, plus 19 page/action gaps. After exact-head CI passes, method-specific proof links and an explicit reviewed ledger reconciliation are required before any reclassification. No whole-system isolation or production approval is implied.

Source contract: `tests/tenant-benefit-enrollments-source.test.mjs`. Rollback is removal of the additive QA suite, runner call and documentation; application behavior is unchanged.

## First CI execution and fixture correction

Initial head `4e7849441` reached the new real HTTP POST in Security HTTP Smoke, DL-02 and salary-correction-case CI. Each returned 500 because the positive POST reused the seeded enrolment's unique `(employee_id, plan_id, started_on)` key. The fixture now uses October 1 for the populated read row and October 16 for the new enrolment, asserts their keys differ before POST, and checks the persisted date. The schema constraint and required HTTP 201 remain unchanged. Fresh exact-head CI must pass; the initial failed executions grant no coverage credit.


## Evidence reconciliation after passing merged-head CI

Three method credits (GET/POST/DELETE) are now linked to passing merged-head receipt [a112b8dd7](https://github.com/erwinmehehe/payrollph/actions/runs/40084883554/job/120845670288). Catalogue PUT and HMO stay GAP. Current reconciled inventory is 156 COVERED / 10 PUBLIC-BY-DESIGN / 328 GAP, with 18 page/action gaps. Prior preparation counts and inventoryCreditsAdded=0 log fields are historical; the manifest and bounded receipt verifier now define the reviewed credits. No global or production acceptance.
