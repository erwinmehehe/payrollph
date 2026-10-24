# Benefit enrolment tenant-isolation HTTP candidate

Base: main `387db1a4b` (includes #1350 and #1364). This batch targets three currently GAP methods: GET, POST and DELETE `/api/benefits`. It is separate from #1355 expenses/de-minimis, #1353 BIR certificates, #1361 payroll close and #1365 statutory actions.

The existing Security HTTP Smoke second-pass runner unconditionally awaits `scripts/qa/tenant-benefit-enrollments-http.mjs`. It uses its genuine authenticated sessions and disposable PG16 fixture, with two independent attacker employers and a third victim. Both attacker plans and enrolments are persisted before seven victim records, so real victim IDs exceed both attackers and six.

Controls require populated own GET results, persisted own POST 201, owned DELETE 200 with ended state and audit event, victim-employer 403, foreign worker/plan 404, forged selector containment, and same-session membership revocation denials. Anonymous requests must return 401. Victim benefit plans/enrolments, employee rows, payroll rows and audit events are compared exactly after every denied request and at completion. Revoked deletion must also preserve the formerly owned enrolment exactly.

No production SQL, Neon operations, provider requests, money flags, payroll calculation, payment or real employer data. No runtime authorization or audit guard is changed. Catalogue seeding PUT, HMO workflows, scoped-role acceptance and full benefit lifecycle remain outside this batch.

## Acceptance status

**Prepared evidence only; NOT ACCEPTED.** The HTTP suite has not run locally. Syntax and source-contract tests do not substitute for the actual production-mode localhost HTTP/disposable-PG16 job. All three methods stay GAP in the shared manifest: **zero new method credits**, current main baseline **149 COVERED / 10 PUBLIC-BY-DESIGN / 335 GAP** among 494 methods, plus 19 page/action gaps. After exact-head CI passes, method-specific proof links and an explicit reviewed ledger reconciliation are required before any reclassification. No whole-system isolation or production approval is implied.

Source contract: `tests/tenant-benefit-enrollments-source.test.mjs`. Rollback is removal of the additive QA suite, runner call and documentation; application behavior is unchanged.
