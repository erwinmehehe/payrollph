# Document metadata lists — same-parent legal-employer boundary (draft)

**SECURITY NOT ACCEPTED. Source-only candidate, synthetic disposable PG16 acceptance required. No production release, schema migration, identity provider, money or external storage calls.**

## Source changes

`GET /api/documents`: preserves employee self-document listing, normal parent-membership/People role and vault checks. With `MULTI_ENTITY_ENABLED=true`, resolves the user’s live legal-employer grants, refuses group/unresolved employer scope, and filters staff by the selected legal employer in PostgreSQL before forming the response. Parent-company `access.companyWide` does NOT bypass legal-entity filtering. Documents without an attributed employee are excluded under multi-entity mode. Response is private/no-store. When the flag is OFF, existing parent/org-unit behavior is preserved.

`GET /api/hcm/documents`: currently aggregates organization-wide policy bodies and target rules, requirement definitions, employee/compliance details, expiry notices and private document metadata. Filtering the employees array alone would still expose cross-legal-employer policy content and references. **Until policies/requirements have approved legal-employer attribution, the entire GET fails closed with 503 and no parent data** under `MULTI_ENTITY_ENABLED=true`, after checking role and session/entity selection. Feature-OFF behavior is unchanged. Availability impact for multi-entity-on HR administrators is an explicit residual and requires product/security owner review.

**Both `POST` handlers now explicitly fail closed with a private/no-store 503 whenever multi-entity mode is enabled.** File uploads lack immutable issuer legal-employer attribution, and HCM document-policy mutations can affect parent-wide rules/compliance for other employers. The refusal occurs after authentication and same-origin validation but before multipart/JSON body parsing or writes. This intentionally blocks multi-entity-on upload and HCM policy mutation until a fully attributed workflow is approved; feature-OFF POST behavior stays unchanged. All four changed GET/POST methods are conservatively `GAP/testedBy:null`, with their original receipts historical only. Branch ledger: **457 covered / 4 GAP / 25 public / 12 privileged of 498**, not independently approved.

## Source-current disposable test

`scripts/qa/tenant-document-metadata-entity-http.mjs` with `.github/workflows/tenant-document-metadata-entity-http.yml`:

- Exact-head PR checkout and source SHA pins
- Empty, disposable PostgreSQL 16, localhost production-mode Next server, three independent synthetic employer sessions, higher-ID real victim document
- Own source document lists populated; A-only grant omits B’s document and unattributed parent rows in same parent organization
- Forged header, query, duplicate legal-employer selectors, parent-tenant cross-read and revoked-grant request refuse without changing protected DB rows
- HCM policy GET 503 contains no private employee/document/policy data and is no-store
- Both documents and HCM document-policy POST return 503 without processing mutations or altering employer documents/audit records
- No production database credentials, external providers, live money, or method-credit promotion

## Remaining acceptance

- [ ] Exact PR-head real HTTP/PG16 workflow green, and all source/manifest regression guards reconciled without weakening or altering immutable old proofs
- [ ] Verify feature-OFF compatibility separately with own/foreign metadata positives
- [ ] Independent HR/product owner approves 503 unavailability until policy/requirement attribution is designed
- [ ] Clarify policy documents historically issued by previous legal employer and employee transfer edge cases
- [ ] Independent privacy/security review, with recorded source SHA and residual risks, separate production decision
- [ ] Reprove the changed GET **and POST** methods before any future source-current credit; no assumed inherited coverage

Coordinate with [#1966](https://github.com/erwinmehehe/payrollph/issues/1966), [security acceptance #2012](https://github.com/erwinmehehe/payrollph/issues/2012) and the separate private document-download [draft #2016](https://github.com/erwinmehehe/payrollph/pull/2016). **Do not merge, deploy, activate or promote ledgers based on this draft alone.**
