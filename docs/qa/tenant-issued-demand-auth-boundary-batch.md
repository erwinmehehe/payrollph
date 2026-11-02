# Issued-demand family: authorization before pilot-status disclosure

**Status: DRAFT. No tenant-isolation coverage credit, production acceptance, deployment, or provider authorization.**

This focused two-method Workforce demand-governance batch addresses one shared authorization-order defect without changing business outcomes for authorized employers. It is deliberately smaller than the general 10-25-method batch target because both endpoints share the same pilot gate and an existing dedicated real-HTTP/disposable-PG16 runner. Other Workforce methods remain separate GAP work.

## In scope

- `POST /api/workforce/demand-observations/issued`
- `POST /api/workforce/demand-observations/issued/score`

Both handlers previously evaluated `issuedDemandPilotAllowed(input.organizationId)` **before** verifying active employer access and company-wide People-admin authorization. A signed-in nonmember sending a valid fictional employer ID could distinguish disabled-pilot HTTP 404 from enabled-pilot authorization HTTP 403. This is a source-identified tenant configuration disclosure risk, **not an assertion that any live tenant configuration was exposed**.

The change moves the existing `getAccess` and `PEOPLE_ADMIN_ROLES` 403 guard ahead of the existing 404 pilot gate. There is no role expansion, feature flag default change, SQL migration, schema mutation, provider call, payroll calculation, schedule write, or payout action.

## Expected HTTP boundary

| Authenticated actor and target | Expected result |
| --- | --- |
| Own employer, authorized company-wide People admin, pilot enabled | Existing legitimate create (201) or idempotent replay (200) path |
| Own employer, authorized company-wide People admin, pilot disabled | Existing pilot-disabled 404 |
| Nonmember targeting a real allowlisted employer | Authorization 403, without pilot-status disclosure |
| Nonmember targeting a real non-allowlisted employer | Same authorization 403, without pilot-status disclosure |
| Anonymous request | Authentication 401 |
| Own employer without required MFA | Existing MFA 403 |

## Method-specific synthetic verification

The existing `scripts/qa/tenant-issued-demand-http.mjs` already uses two independent signed-in attacker employers, a genuine higher-ID victim employer, and a separate signed-in pilot-disabled employer, with disposable PostgreSQL 16 and localhost production-mode Next. The updated runner adds foreign targeting of the pilot-disabled employer for **both** POST methods. Each denial checks for exact HTTP 403, lack of foreign markers, and unchanged employer/workforce/payroll/audit database snapshots. The pre-existing own-success and own-disabled tests remain.

`tests/tenant-issued-demand-contract.test.mjs` additionally pins authorization-before-flag ordering in both source routes and requires both exact nonmember-disabled HTTP test cases to be present. Source assertions are regression guards, not proof that real requests passed.

## Acceptance and rollout

- [ ] Exact PR-head source tests, TypeScript, build, relevant security/CodeQL and focused domain regression checks pass.
- [ ] The dedicated `tenant-issued-demand-http.yml` job passes on the final PR head with real fictional own/foreign 201/200/403/404 paths and unchanged foreign SQL.
- [ ] Maintainer reviews the diff, current main overlap and behavior change; no other open PR currently edits these two handlers.
- [ ] Separate production activation review, if ever applicable. Existing pilot and provider flags remain unchanged and disabled outside their approved environments.
- [ ] Keep both method entries `GAP` until a separate reviewed source-pinned coverage-credit reconciliation accepts full method evidence. No global tenant-isolation certification.

Rollback: revert this PR. Production routes are not modified until a separate authorized merge/deploy.
