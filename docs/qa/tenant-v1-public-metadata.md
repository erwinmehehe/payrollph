# Tenant-isolation boundary: public API v1 metadata GET

**Candidate:** GET /api/v1, presently a GAP on main. This is an explicit PUBLIC-BY-DESIGN exception, **not a tenant-scoped COVERED method** and not global acceptance.

The current handler takes no request argument. It returns static API documentation, public operation paths, a placeholder key-format example, documented retry constants and a deployment-wide default-off extension flag. It does not import a DB/session helper, look up an employer, read tenant data, accept an object ID, or mutate SQL. Treating it as a tenant-owned API would be a false claim: no employer-selected resource exists on this route.

## Evidence and fail-closed boundaries

- `tests/tenant-v1-public-catalog.test.mjs` checks Git source SHA, explicit PUBLIC-BY-DESIGN-only status, nonempty concrete rationale, no DB/identity/tenant-selector source access, default-off extension flag, and adversarial contract mutation cases.
- `scripts/qa/tenant-v1-public-http.mjs` refuses any real/non-local DB, non-CI execution, provider credentials, enabled payout/billing/worker settings **before** importing the application or database. It requires an initially empty fictional PostgreSQL 16 database, seeds three independent employers and real owner sessions, then calls the production Next route anonymously, as each employer, and with forged victim organization/worker/entity/run/query/header selectors.
- The HTTP checks demand nonempty 200 public documentation; byte-identical JSON for every caller (no existence oracle or employer response), no employee/email/employer marker anywhere in the response and byte-identical snapshots for organizations, users, grants, employees, payroll, sessions and audit rows.
- The workflow is confined to 127.0.0.1:3000 and a disposable PostgreSQL 16 service on 127.0.0.1:5432, with provider and worker flags OFF. It does not access Neon, customer data, payroll releases, payment providers or production services.

## Release and review gate

- [ ] Exact-PR-head source and negative-control tests green.
- [ ] Exact-PR-head dedicated PostgreSQL 16 production Next real-HTTP job green.
- [ ] All required general CI, security smoke and CodeQL checks green.
- [ ] Repository owner and an independent security reviewer accept the static public-data rationale.
- [ ] Reconcile this one PUBLIC classification with any newer main/other tenant recovery PR. Never overwrite another GAP method's proof or credit.

The proposed tally is **498 = 405 COVERED + 11 PUBLIC-BY-DESIGN + 82 GAP**. All **17 page/action GAPs** persist, and zero additional tenant-scoped methods become COVERED. Do not merge, deploy or represent tenant isolation as accepted before gates complete.
