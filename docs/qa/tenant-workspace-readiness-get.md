# Tenant workspace-readiness GET: provisional employer-only recovery

**Status: DRAFT / GAP / zero API-method coverage credits / NOT PRODUCTION-ACCEPTED.**
Owner: the repository maintainer. This change does not establish independent security, privacy, payroll or launch approval.

## Narrow objective

Recover an informative, authenticated `GET /api/readiness/workspace?organizationId=...` for a company-wide owner, administrator or bookkeeper, without exposing the deployment-wide diagnostic payload from `GET /api/readiness`.

The authorized response is deliberately **not** a production-readiness attestation. It contains only real, organization-filtered counts of employee rows, payroll-run rows and employees whose rest day is missing. Launch and pilot acceptance always remain blocked. No unscoped joins, payroll details, bank data, individual employee information, invoice records, provider credentials, token configuration or cross-employer operational totals are returned.

## Enforcement and response

- The session must be valid, and the membership must be active in the selected organization.
- `assertOrganizationRole` with `ORG_ADMIN_ROLES` and `getAccess(...).companyWide` must succeed before any employer data is queried. Unit-scoped admins and revoked users fail closed.
- Only queries explicitly scoped by `organizationId` may supply the response. The platform-wide `buildReadinessPayload()` remains available only behind its separate operational-token gate.
- Authorized owned GET: HTTP **200**, private **no-store** response with `organizationId` binding and `status: not-launch-ready`.
- Authenticated foreign GET: **403**; anonymous: **401**; malformed selector: **400**.
- Database/schema errors return **503** without SQL details, counts or false launch status.
- The UI's `readVerifiedLaunchReadiness` validates the employer selector and gate/blocker consistency before displaying the result.

## Evidence files

- Route: `src/app/api/readiness/workspace/route.ts`
- Employer-filtered loader and fail-closed response: `src/lib/workspace-readiness-boundary.ts`
- Full independent real HTTP proof: `scripts/qa/tenant-workspace-readiness-http.mjs`
- Disposable environment and exact source-pinning: `scripts/qa/tenant-workspace-readiness-contract.mjs`
- Negative-control unit tests: `tests/tenant-workspace-readiness-contract.test.mjs`
- Dedicated CI: `.github/workflows/tenant-workspace-readiness-http.yml`
- Historical three-employer second-pass integration: `scripts/qa/workspace-readiness-http.mjs`
- Source drift and uncredited status: `tests/tenant-isolation-coverage-inventory.test.mjs` and `scripts/qa/tenant-isolation-coverage-manifest.json`

The dedicated CI uses an empty, disposable **PostgreSQL 16** database, `npm run build`, real localhost Next.js HTTP, independently authenticated attacker employers A and B and a genuine **higher-ID** victim employer. Seven additional real fictional filler employers make the persisted victim organization, entity, unit, employee, owner, membership and pay-profile IDs strictly greater than both attackers' IDs **and six** (not just a higher organization selector). The HTTP proof requires populated own reads, exact tenant-filtered SQL counts, foreign/forged denials, immutable organization, entity, unit, payroll, invoice, outbox and audit snapshots, revocation and unit-scope refusal, and absence of secrets or other-employer markers. Revoked-session requests must leave SQL unchanged even before the membership fixture is restored.

The proof refuses deployment environments, real provider credentials, enabled workers or schedulers, and all money/payout pathways. It never calls a real payroll provider. Synthetic payroll-run rows are **Draft** only. No external service, real employee data, production/Neon database or money action may be used as a substitute.

## Why this follow-up is needed

The original merged #1886 PG16 HTTP job passed on its reviewed head, but the
proof established the strict >6 floor only for organization IDs. The updated
recovery proof enforces the same persisted-ID floor for dependent employer
business objects, broadens the protected SQL snapshot, and checks revocation
immutability before restoring the fixture. This is deliberately **proof-only**:
no app route, tenant manifest, ledger counts, release flag or runtime behavior
is changed. A fresh exact-head PG16 HTTP run is required for this changed proof.

## Verification and promotion gate

1. Confirm all exact-source hashes and the original source-drift protections against the current final PR head.
2. Require the new dedicated GitHub Actions PostgreSQL 16 real-HTTP job to pass on **that exact final head**, as well as applicable repository type, unit, inventory and security checks.
3. Review response privacy, role gates, source filtering, stale selector/caching behavior and potential ownership changes independently of the author when possible.
4. Keep **`GET /api/readiness/workspace` as `GAP`, `testedBy: null`, with **zero new API-method credits**, until the full evidence and ledger promotion policy is satisfied. A green preliminary job alone grants no credit.
5. Require separate operational and launch approvals before deployment or any change to payroll, pilot, financial or provider configuration.

## Rollback

Revert this PR to the historical fail-closed HTTP 503 workspace readiness response. The protected platform readiness endpoint and its operational-token authorization are unaffected.

Related backlog: [tenant isolation closure queue #1740](https://github.com/erwinmehehe/payrollph/issues/1740).
