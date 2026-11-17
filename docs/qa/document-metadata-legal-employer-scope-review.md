# Document metadata lists — same-parent legal-employer boundary (draft)

**SECURITY NOT ACCEPTED. Source-only candidate, synthetic disposable PG16 acceptance required. No production release, schema migration, identity provider, money or external storage calls.**

## Source changes

`GET /api/documents`: preserves employee self-document listing, normal parent-membership/People role and vault checks. With `MULTI_ENTITY_ENABLED=true`, resolves the user’s live legal-employer grants, refuses group/unresolved employer scope, and filters staff by the selected legal employer in PostgreSQL before forming the response. Parent-company `access.companyWide` does NOT bypass legal-entity filtering. Documents without an attributed employee are excluded under multi-entity mode. Response is private/no-store. When the flag is OFF, existing parent/org-unit behavior is preserved.

`GET /api/hcm/documents`: currently aggregates organization-wide policy bodies and target rules, requirement definitions, employee/compliance details, expiry notices and private document metadata. Filtering employees alone would still expose cross-legal-employer policy content. **The existing `src/proxy.ts` HCM-wide embargo returns 403 / `ENTITY_HCM_DEFERRED` before this route executes** when multi-entity is enabled. The new route-level 503 / `HCM_DOCUMENT_LEGAL_EMPLOYER_SCOPE_PENDING` is defense in depth should the separate embargo ever be lifted after approval; it is NOT currently reachable in the multi-entity HTTP workflow. Both responses refuse without loading parent data. Feature-OFF behavior is unchanged. Availability impact requires product/security owner review.

**Both `POST` mutations fail closed under multi-entity mode.** `/api/documents` returns a route-level private/no-store 503 after authentication and same-origin checks, before upload parsing or SQL. `/api/hcm/documents` is blocked earlier by the existing HCM proxy embargo with private/no-store 403 / `ENTITY_HCM_DEFERRED`; the route-level 503 remains defense in depth and cannot be treated as an executed HTTP proof. No multipart/JSON body or SQL mutation runs. All four changed GET/POST methods remain `GAP/testedBy:null` and zero-credit, with historical receipts not promoted. Branch ledger: **457 covered / 4 GAP / 25 public / 12 privileged of 498**, not independently approved.

## Source-current disposable test

`scripts/qa/tenant-document-metadata-entity-http.mjs` with `.github/workflows/tenant-document-metadata-entity-http.yml`:

- Exact-head PR checkout and source SHA pins
- Empty, disposable PostgreSQL 16, localhost production-mode Next server, three independent synthetic employer sessions, higher-ID real victim document
- Own source document lists populated; A-only grant omits B’s document and unattributed parent rows in same parent organization
- Forged header, query, duplicate legal-employer selectors, parent-tenant cross-read and revoked-grant request refuse without changing protected DB rows
- HCM policy GET 403 / `ENTITY_HCM_DEFERRED` is enforced by the pre-route proxy, contains no private employee/document/policy data, and is no-store
- Documents POST returns 503; HCM document-policy POST returns proxy-level 403; neither processes mutations or alters employer documents/audit records
- No production database credentials, external providers, live money, or method-credit promotion

## Remaining acceptance

- [ ] Exact PR-head real HTTP/PG16 workflow green, and all source/manifest regression guards reconciled without weakening or altering immutable old proofs
- [ ] Verify feature-OFF compatibility separately with own/foreign metadata positives
- [ ] Independent HR/product owner approves continued HCM proxy-level 403 unavailability; do not loosen the umbrella embargo to satisfy route-level 503 expectations
- [ ] Clarify policy documents historically issued by previous legal employer and employee transfer edge cases
- [ ] Independent privacy/security review, with recorded source SHA and residual risks, separate production decision
- [ ] Reprove the changed GET **and POST** methods before any future source-current credit; no assumed inherited coverage

Coordinate with [#1966](https://github.com/erwinmehehe/payrollph/issues/1966), [security acceptance #2012](https://github.com/erwinmehehe/payrollph/issues/2012) and the separate private document-download [draft #2016](https://github.com/erwinmehehe/payrollph/pull/2016). **Do not merge, deploy, activate or promote ledgers based on this draft alone.**
