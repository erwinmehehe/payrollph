# Proof-only hold: POST /api/earned-wage

**STATUS: GAP / ZERO COVERAGE CREDIT / NOT ACCEPTED**

- Baseline: origin/main at 11b6d544cf6bd30c84fc524a088f90627dec09e6 (re-fetched 2026-11-02).
- Exact source route Git blob SHA on baseline: `e030259bb14719a806acbdad77c35135f63e1520`.
- Source fix: merged source hardening already reflected in main.
- Existing fictional PG16 candidate to **reuse rather than rewrite**: `scripts/qa/tenant-earned-wage-post-http.mjs`.
- Manifest reason: Employee lock, eligibility and transactional audit hardening is source-only; no complete exact-head PG16 HTTP approval.
- Coverage manifest `scripts/qa/tenant-isolation-coverage-manifest.json` remains untouched, `status:GAP`, `testedBy:null`.

## Required real HTTP / disposable PG16 acceptance

1. Legitimate success: two independently signed-in fictional employer actors, genuine same-method own-object success and persisted own evidence, not 401/429/501 or an empty response.
2. Real victim denial: seed/read back a different employer's real victim rows and selectors with IDs greater than both actor comparators; assert exact refusal and no leak.
3. Unchanged victim DB: take and compare PostgreSQL before/after snapshots of every connected victim table, including relevant payroll, policy, audit or outbox tables.
4. Forged selectors: send victim organizationId, employeeId, object ID, legalEntityId and other accepted selectors; assert explicit rejection or demonstrable ignore with own-only data.

### Method-specific checks

Prove own eligible EWA request committed with audit, higher-ID victim employee denial, unchanged victim EWA/payroll/audit rows, forged employee/employer selectors and eligibility/audit-fault rollback.

## Evidence and safety gate

**NOT RUN on this branch.** Sandbox creation was refused (403) and local environment has no PostgreSQL 16 server or GitHub network clone. Historic passing candidate CI is not an exact-final-head receipt. An authorized CI runner must run the existing script against this PR's final head (commit SHA recorded afterward) using disposable fictional two-employer PG16 and real localhost HTTP, then link job URL, four assertion lines, and immutable before/after SQL snapshots. Do not certify before independent security review.

No source guard, test assertion, production SQL, Neon, secrets, real data, or deployment flag is changed. Money/payout/provider/CSP flags remain OFF. If a real isolation defect is discovered, fix source in a **separate, clearly labelled commit**, never by weakening a guard or test.
