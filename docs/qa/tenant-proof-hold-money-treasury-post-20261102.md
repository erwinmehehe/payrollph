# Proof-only hold: POST /api/treasury-controls

**STATUS: GAP / ZERO COVERAGE CREDIT / NOT ACCEPTED**

- Baseline: origin/main at 11b6d544cf6bd30c84fc524a088f90627dec09e6 (re-fetched 2026-11-02).
- Exact source route Git blob SHA on baseline: `56583ab43e7dc39101bb17122b4e9bdcbbaad81a`.
- Source fix: merged #1683.
- Existing fictional PG16 candidate to **reuse rather than rewrite**: `scripts/qa/tenant-mny02-treasury-http.mjs`.
- Manifest reason: Atomic policy/audit source fix and PG16 candidate exist, but exact-final-head four-part proof and independent review are not accepted.
- Coverage manifest `scripts/qa/tenant-isolation-coverage-manifest.json` remains untouched, `status:GAP`, `testedBy:null`.

## Required real HTTP / disposable PG16 acceptance

1. Legitimate success: two independently signed-in fictional employer actors, genuine same-method own-object success and persisted own evidence, not 401/429/501 or an empty response.
2. Real victim denial: seed/read back a different employer's real victim rows and selectors with IDs greater than both actor comparators; assert exact refusal and no leak.
3. Unchanged victim DB: take and compare PostgreSQL before/after snapshots of every connected victim table, including relevant payroll, policy, audit or outbox tables.
4. Forged selectors: send victim organizationId, employeeId, object ID, legalEntityId and other accepted selectors; assert explicit rejection or demonstrable ignore with own-only data.

### Method-specific checks

Prove real own policy/operator create and audit, higher-ID victim denial, identical policy/operator/audit victim snapshots, forged employer/operator selectors, forced audit-write rollback.

## Evidence and safety gate

**NOT RUN on this branch.** Sandbox creation was refused (403) and local environment has no PostgreSQL 16 server or GitHub network clone. Historic passing candidate CI is not an exact-final-head receipt. An authorized CI runner must run the existing script against this PR's final head (commit SHA recorded afterward) using disposable fictional two-employer PG16 and real localhost HTTP, then link job URL, four assertion lines, and immutable before/after SQL snapshots. Do not certify before independent security review.

No source guard, test assertion, production SQL, Neon, secrets, real data, or deployment flag is changed. Money/payout/provider/CSP flags remain OFF. If a real isolation defect is discovered, fix source in a **separate, clearly labelled commit**, never by weakening a guard or test.
