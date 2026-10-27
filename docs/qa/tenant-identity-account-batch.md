# Session identity/account tenant isolation — independent two-method batch

**DRAFT / NOT ACCEPTED / ZERO NEW TENANT-ISOLATION CREDITS.**

Exact method identities, verified GAP in the authoritative method manifest on
main@8c2b1c5216eeb46fa652455c0ddbb50fe5b6cc70:

- GET /api/auth/me
- GET /api/account

These are session-principal reads, NOT organizationId-scoped table reads.
They are separate from current legal-entity context PATCH #1471, governed
roster batches #1473, demand governance #1474, and the previously merged
Year-End, Recruitment, Asset Custody, Leave and ESS Availability families.
No other method or existing source family is claimed by this branch.

## Real localhost HTTP and persisted PostgreSQL proof

A fresh, empty disposable PostgreSQL 16 on 127.0.0.1:5432/app_db and a
production-mode Next server on 127.0.0.1:3000 authenticate two separate
fictional employer owners, a third real HIGHER-ID victim owner and an
independent second user within the first employer.

- Every legitimate session must receive nonempty OWN identity details and
  safe own-account/session data, including its real persisted current ID.
- Anonymous/invalid sessions: auth/me deliberately returns 200 with
  user:null; account must return 401. No 200-null false-positive proof.
- The attacker supplies genuine foreign employer/user/session IDs and
  same-employer peer IDs in both query strings. The server's response must
  remain scoped to the COOKIE user; the endpoints intentionally ignore
  browser-selected principal IDs, so a fictitious 403 is NOT claimed.
- Every returned session must have the authenticated userId. No cross-user
  account views, password hash, session bearer/hash or MFA secrets may leak.
- Employer A's real success must fail employer B's exact own-data assertion.
- The victim and peer user, persisted token-hash, session metadata,
  memberships, and employer audit rows must be identical before and after
  both attacker sessions' forged requests.
- Actual authenticated HTTP responses must carry non-cacheable no-store
  directives (normalization-safe check).
- Pre-DB fail-closed guards reject hosted/ambiguous targets, developer DBs,
  demo mode and payment/provider-capable environments. All data is synthetic.

## New exclusive paths

- scripts/qa/tenant-identity-account-proof.mjs
- scripts/qa/tenant-identity-account-http.mjs
- tests/tenant-identity-account-contract.test.mjs
- .github/workflows/tenant-identity-account-http.yml
- docs/qa/tenant-identity-account-batch.md

Six source/negative-control regression cases are included, but cannot
substitute for actual disposable PG16/production-mode localhost execution.
The dedicated workflow must run at the exact final PR head alongside broader
CI/security checks. Independent review of the real HTTP evidence is needed
before any coverage reconciliation.

No runtime authentication policy, API behavior, database schema,
migration, global tenant-table runner, reservation ledger, coverage manifest
or proof-credit writer was modified. No production environment, payroll,
money movement, provider or employee record is accessed. This PR does NOT
mark the methods COVERED, does not certify the entire authentication system
and is NOT a payroll release or customer UAT acceptance.
