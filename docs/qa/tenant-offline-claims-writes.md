# Offline Attendance Claim write isolation — provisional, no credits

**Scope:** `POST /api/attendance/offline-claims` (employee submits unverified evidence) and
`PATCH /api/attendance/offline-claims` (independent owner reviews it). These are both
**GAP** in the authoritative tenant-isolation method inventory. Existing
`GET /api/attendance/offline-claims` is already provisionally COVERED and is not
credited a second time.

## Execution surface

The standalone `tenant-table-proof` GitHub Actions job runs the added module after
existing read-row assertions, **only** under profile `flagged-reads`. Its actual
localhost Next production build uses disposable PostgreSQL **16**, and the shared
profile enables `FACE_OFFLINE_PUNCH_UI_ENABLED=true` for this job only.
The module refuses execution without exact CI/isolated profile flags, local
127.0.0.1 HTTP and `app_db` database, and disabled payout providers.
These are synthetic actor accounts and timestamps, not customer attendance,
statutory filings, payroll release, provider authorization or bank transactions.

No application route, feature activation, deployment or database migration is
changed by this branch.

## Required acceptance assertions

1. Seed two independently authenticated fictional attacker employers and their
   employee and owner roles, plus an already populated, **higher-ID victim**
   employer. The shared GET row must first prove a real persisted victim claim.
2. Perform real POST via each employee session, **including the victim's own
   positive control**. Each must return 201, one persisted employer+employee+
   actor-bound `pending_review` claim, one matching audit, and `verified=false`.
   A claim submitted with an employee account is never an authoritative punch.
3. Each employee GET must include its genuine persisted own claim; it must not
   include the other attacker or victim claim IDs. Exact source proof for
   attacker A must fail when evaluated as attacker B. GET is private/no-store.
4. From both attackers, attempt foreign employer POST, a forged victim employee
   ID under an owned employer, foreign employee and owner GET, foreign PATCH
   using both victim employer and owned employer selectors, and PATCH using
   the other attacker's claim ID. Require precise 403 / 422 / 404 denials,
   no victim marker or record disclosure, and no changed persisted rows/audit.
5. Exact same actor/event replay returns 200 `replayed=true` and does not
   change PostgreSQL; reusing that event ID with a different action returns
   409 and does not create another claim or audit.
6. Independent attacker employer owners genuinely review their own pending
   claims: one **flag**, one **dismiss**, each 200 with exact persisted status,
   reviewer ID, note, timestamp, one action audit and `verified=false`.
   Re-review must be 409 with no additional mutation or audit.
7. The full victim employer's employee, claim and audit snapshot remains
   unchanged after all cross-employer requests and own reviews.
   Compare the entire fixture's authoritative `time_punches`,
   `attendance_correction_requests`, `payroll_runs` and `payroll_entries`
   before/after: these actions **must not** create actual punches, alter
   attendance corrections or change payroll.
8. Fail-closed pure contract tests reject empty or wrong-tenant 200s,
   unexpected foreign IDs, excessive employee metadata, cacheable responses,
   leaking denial bodies and returned victim claim IDs.

## Review and release gates

- [ ] Exact PR-head `node --check` and all focused negative-control tests pass.
- [ ] Exact PR-head `Tenant table proof` flagged-reads PostgreSQL 16
      and actual authenticated HTTP profile pass.
- [ ] Unrelated default/multi-entity/allowlisted rows and existing credits
      remain unaffected; repository CI and security jobs reviewed.
- [ ] Independent security review validates the executed source, SQL audit
      invariants, employer/employee binding and immutable payroll evidence.
- [ ] Only after that, independently reconcile each method into the
      authoritative manifest. No credit is made here.

**NOT ACCEPTED / DRAFT ONLY / ZERO NEW CREDITS / NO DEPLOYMENT OR MONEY RELEASE.**
