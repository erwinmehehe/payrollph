# WRK-01 greedy-roster GET tenant isolation: disposable source-bound receipt

**DRAFT / GAP / zero credits / NOT ACCEPTED.** This is a new test-only
acceptance candidate for exactly one uncovered API method:

GET /api/workforce/greedy-roster

It is independent of the staffing-policy POST/PATCH write PR and does not
claim to close WRK-01. The current live tenant manifest must remain untouched.

## Why this GET needs direct proof

The greedy roster preview reads real workforce staffing requirements and
personnel availability/eligibility sources. A cross-employer response could
expose worker identities or scheduling demand even though the endpoint never
publishes a roster. A disabled-feature 404, empty successful response, invented
victim ID, or a general source review 409 is not a legitimate own-employer
positive for this coverage method.

## Executable scope

The dedicated GitHub Actions workflow:
.github/workflows/tenant-wrk01-greedy-roster-http.yml

The executable real-HTTP runner:
scripts/qa/tenant-wrk01-greedy-roster-http.mjs

The fail-closed guard and mutation-tested proof contracts:
scripts/qa/tenant-wrk01-greedy-roster-contract.mjs
tests/tenant-wrk01-greedy-roster-contract.test.mjs

The workflow boots a new ephemeral PostgreSQL 16 app_db on 127.0.0.1,
applies only the existing reviewed isolated baseline, builds production-mode
Next.js locally and executes authenticated GET requests over
http://127.0.0.1:3000. Only the test process enables the two roster preview
feature flags. Workers, scheduler, provider disbursements and billing remain
OFF. No provider requests, hosted database, money, real worker data,
deployment, migration source changes or payroll writes are permitted.

## Exactly what must pass

- Seed two independent employer owners ATTA and ATTB and their worker rows,
  plus a third real higher-ID VICTIM with persisted own worksite, private shift,
  dated staffing requirement and explicit worker-site denial.
- Each signed-in owner (including the victim's independent positive control)
  must obtain a real HTTP 200 containing exactly its persisted requirement ID,
  employer/site, source date and employee ID, headcount and explicit
  "site_ineligible" evidence. Neither a default/empty list nor a hardcoded
  foreign ID can pass. The response must be non-cacheable, advisory-only and
  contain no other-employer marker in body or headers.
- Test attacker A and B independently against the victim's real organization
  and real higher-ID worksite. A foreign organization must return 403, while
  a stolen victim worksite under an attacker's legitimate employer must return
  409 without disclosing victim information. A forged selection of employee,
  requirement, shift, legal entity, user or payroll run must not re-scope
  the legitimate own response.
- Test a real member of the employee role (403) and a genuine scoped manager
  (own worksite 200 but own-employer other-department worksite 409). The
  company owner may still read that separate employer-owned site.
- After revoking A's owner membership while preserving the **same** session
  and adding legitimate active Beta membership, the original session must
  return 403 for A yet continue returning Beta's genuine source-specific 200.
- After every positive, forged and denied HTTP call, compare actual persisted
  organization, legal entity, unit, user membership, worker, pay profile,
  site/deny, staffing requirements, roster policies, schedule, leave/OT,
  audit, payroll runs and payroll entries across all three employers.
  Reading/suggesting a plan must never create or change any of them.

Any failed assertion is a blocker and must not be bypassed with 404, 409,
empty 200, weaker identity checks or fabricated mock evidence.

## Review and no-credit policy

Keep GET workforce/greedy-roster GAP with testedBy null. There are no
application handler, schema, manifest, payroll, feature registry or
production configuration changes in this PR.

Require a successful exact-PR-head fictional PG16 real-HTTP run, same-head
standard CI/check, CodeQL, Security HTTP Smoke, Payout Payroll Isolation,
and independent security/privacy review before proposing any separate
whole-batch manifest reconciliation. A green source test alone does not
approve tenant isolation or production release. Do not auto-merge.
