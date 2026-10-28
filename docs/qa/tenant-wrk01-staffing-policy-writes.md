# WRK-01 staffing policy write isolation (fictional PG16 HTTP candidate)

**Status:** DRAFT / NOT ACCEPTED / ZERO NEW METHOD CREDITS / NO PRODUCTION CHANGES.

## Exactly scoped methods

- POST /api/workforce/demand-staffing/policies (WRK-01 GAP)
- PATCH /api/workforce/demand-staffing/policies (WRK-01 GAP)

The already provisionally covered GET is used only as a separate read-back control.
This does **not** close WRK-01, which contains other GAP methods, or certify the
entire POST/PATCH handler without reviewed exact-head acceptance. There is no
application route change, payroll calculation change, provider integration,
schema migration, production feature switch, deployment, data import or money
movement.

## Actual isolated evidence required

The source runner is scripts/qa/tenant-wrk01-staffing-writes-http.mjs.
The focused workflow is .github/workflows/tenant-wrk01-staffing-writes-http.yml.

- Start a brand-new PostgreSQL 16 app_db and production-mode Next.js, both bound
  to 127.0.0.1 only. The workflow exports the existing allowlisted-reads
  fictional test profile and temporarily enables the staffing pilot for exactly
  three **real, just-inserted** employer IDs before launching the app.
- Use the established 0600 session fixture containing two independently
  authenticated owners in fictional employers ATTA and ATTB, a real higher-ID
  victim employer, and a deliberately non-allowlisted excluded employer.
  Each relevant employer also has a distinct active site, job profile and
  separately authenticated company admin with fresh fictional MFA evidence.
- Make real own POST 201 calls for both attacker owners **and** the victim owner,
  with two independently persisted planning-only proposals per employer.
  Verify exact returned policy IDs, own organization IDs, worksite/job profile,
  content hashes, policy events and actor-identified audit rows against real SQL.
  Test same idempotency keys across independent employers and genuine replay
  200 without a second event or audit.
- For both attackers, attempt real victim-owned organization, worksite, profile
  and policy IDs. Demand exact unauthorized or scoped-not-found status, no
  foreign data in headers or body, and bytewise stable business snapshots for
  the victim, both attackers and excluded employer. Test unexpected extra
  client-selected employee/user ID keys as explicit 400.
- Exercise all PATCH actions, not just one: author submits own draft; the same
  author cannot approve it; an independent same-company admin approves it and
  is bound to the policy/event/audit approval receipt. Create a second draft
  and independently reject it. Read back a genuine hash-verified approved
  policy without exposing another employer's rationale or IDs.
- Verify anonymous 401, foreign-admin 403, stolen real higher-ID policy 409
  (with attacker organization), and active Alpha membership revocation 403
  against **the same original session**, even while Beta remains an active
  second membership. No denial may alter protected victim or payroll data.
- Every synthetic positive write is permitted to add/change only
  workforce-demand staffing policy rows, their policy events and corresponding
  audit rows. Employee identities, compensation, attendance, schedules,
  workforce issues and payroll/entry state must remain unchanged. No roster or
  pay decision is made by a planning policy draft or approval.

## Fail-closed behavior and review boundary

The test-only contract refuses any target other than GitHub Actions + CI +
production-mode localhost Next + disposable PostgreSQL 16 app_db, with provider
tokens/payouts, billing, background workers and scheduler disabled. Source guards
are evaluated before database/application imports in the runner. Pure unit tests
must reject false-positive HTTP statuses, foreign hashes, cached responses,
insufficient SQL snapshots and disabled-pilot/passive 404s. No broad manifest
promotion is made, regardless of any local test result.

Before considering the work accepted, a human security/privacy reviewer must
check exact-PR-head:
1. The focused real HTTP/PG16 workflow ran and passed both methods and all
   create, submit, approve and reject paths against genuine SQL fixtures.
2. The standard CI/check, CodeQL Security, Security HTTP Smoke and Payout Payroll
   Isolation workflows passed on the same exact head. The repository's security
   alert state must be checked separately when relevant.
3. The reviewer inspects actual action-level authorization, test denial statuses,
   unchanged victim snapshots and accepted source/CI receipt pins. Any partial
   status stays GAP; final WRK-01 reconciliation requires the whole batch.

Do not infer that tests run simply from workflow creation. Do not run this
fixture against Neon/production, real payroll workers, bank accounts, service
providers, or real money. Keep the PR draft and the method manifest untouched.
