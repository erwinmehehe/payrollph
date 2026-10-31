# WFM demand GET permission-overlay tenant boundary (unaccepted)

**Release lane:** SEC / Workforce Demand read authorization. **State:** DRAFT / NO-GO.
**Base:** `main@a0cd5b9d81966d55cbca1124209ffaa3205d22a9`.
**Dependencies on open PRs:** none. The application handlers, family proof runner, contract and workflow do not overlap with the open onboarding (#1612), delegation (#1633), or assets (#1634) PRs. The repository's shared coverage manifest and inventory guard necessarily receive independent entries and may require mechanical reconciliation if another draft lands first.

## Why these reads

The feature-ON GET endpoints for issued demand forecasts and staffing policies used active organization membership and role checks, but did not call the deny-only custom workforce permission-set gate before reading the employer's configured pilot state. The change applies the established `assertOrganizationRole(..., WORKFORCE_MANAGER_ROLES)` session/overlay gate before feature lookup, worksite inspection and evidence read.

The routes remain:
- `GET /api/workforce/demand-observations/issued`
- `GET /api/workforce/demand-staffing/policies`

The latter still limits `mode=manage` to company-wide People admin roles; unit managers retain only approved mode within their own unit. The underlying source services still restrict every read to the selected `organizationId` and `worksiteId`.

**Out of scope:** both POST handlers and the staffing-policy PATCH handler, feature flag registration, external POS providers, approvals, worker schedules, payroll, payouts, billing and migrations. The source-hash inventory contract reconstructs the exact original files from **only** the reviewed GET edits and refuses any unrelated changes.

## Isolated evidence and review checklist

The exact PR head builds a production-mode Next server connected exclusively to disposable `127.0.0.1:5432/app_db` PostgreSQL 16. The CI-only workload uses the repository's existing dynamically allowlisted fictional employers, two separate session cookies, one genuine higher-ID victim, and a fourth non-allowlisted employer. It seeds genuine hash-bound source rows and proves own populated 200 GET, foreign tenant 403, stolen worksite 403, anonymous 401, denied custom permission overlay on a still-active owner, unit-manager manage denial, still-signed-in revoked membership denial, and unchanged victim source/employee/payroll/audit SQL.

The proof refuses non-local databases and provider credentials **before importing any application/database module**. The sandbox enables read-only workforce pilot flags, not external provider, scheduling, or payroll operations. A passing synthetic run is **not** production certification or a substitute for independent privacy/security review.

- [ ] Exact-head source and regression CI pass.
- [ ] Exact-head isolated PostgreSQL 16 own/foreign/overlay/revoked HTTP job passes.
- [ ] Independent security reviewer validates status, private body, and SQL snapshots.
- [ ] Merge queue and shared manifest changes reconciled if open PRs merge first.
- [ ] Remain **DRAFT / NO-GO** until accepted; no production deploy.

**Coverage:** Existing 498 API methods, 371 COVERED, 10 PUBLIC-BY-DESIGN, 117 GAP remain unchanged. The staffing-policy GET remains GAP, as does issued-demand POST. This batch issues **zero method credits** and does not change the 21 page/action entries.
