# Document GET legal-employer isolation — source-review candidate

**STATUS: DRAFT / ZERO NEW CREDIT / NOT SECURITY ACCEPTED.** No deployment, storage migration, production database, payroll or provider changes.

## Scope
`GET /api/documents/[id]` is already restricted to an active parent-organization membership and People role, employee identity and org-unit scope. Those checks are not enough to distinguish two separate legal employers inside **one** parent organization while `multiEntity` is enabled.

The source change:
- Retains the parent-tenant path-ID prefilter; anonymous and foreign-parent IDs remain excluded.
- For staff downloads linked to a worker, resolves the request's selected legal-employer context from current persisted grants and session policy, then compares the actual employee `legalEntityId` using `assertEntityResource`. Missing/grant-revoked/foreign legal employer produces the same opaque 404 as an unknown document, before signed URLs, document bytes or audit writes.
- When the multi-entity flag is ON, staff GET also returns opaque 404 if a worker has an `applied` legal-employer transfer request or a historical assignment to a different legal employer. This blocks using the worker's current employer to read an ambiguously issued legacy document before attribution.
- When the multi-entity flag is ON, returns 404 for documents with no employee attribution because `documents` has no legal-employer column. These require a separate approved attribution/migration plan; do not infer parent-company access authorizes every legal employer.
- When the flag is OFF, retains existing employer membership, role/unit, employee ownership, scanner/integrity, content security and audit behavior.
- Does not grant `group_hr` access through legacy document endpoints.

## Evidence and honesty
The source contract `tests/tenant-private-document-id-boundary.test.mjs` checks the new guard's order and opaque denial. **It is NOT execution proof.** This branch deliberately demotes `GET documents/[id]` from historical COVERED to a **zero-credit GAP**, recording the old receipt without carrying its proof into the changed source. After reconciling the latest `main`, the manifest records **385 COVERED / 25 PUBLIC / 12 TOKEN-ONLY / 76 GAP of 498**: 75 separately invalidated payroll-source proof credits from `main`, plus this one document method. None were restored or re-credited. Overall status remains NOT ACCEPTED.

Before promotion/merge, security must run a new exact-head real HTTP/disposable PostgreSQL 16 suite:
1. Two separately authenticated members with A-only legal-employer grants and one real higher-ID B employee/document in the SAME parent organization. The own A clean document GET succeeds with nonempty verified legacy bytes, or a synthetic short-lived object URL; both actors' B document IDs and forged query/header legal-entity selectors are denied and indistinguishable from unknown IDs, with zero body/URL/PII exposure.
2. Same session after explicit legal-employer grant revocation still 404s; verify exact employee `legalEntityId` and selected context. Test A-to-B-to-A, duplicate/conflicting selectors, staff org-unit restrictions, company-wide roles, and employee self-document access.
3. Unattributed parent-company document returns 404 under the ON flag. OFF flag preserves historical routes; no real customer bytes or production keys used.
4. Victim documents, employee linkage, stored objects and audit rows remain unchanged after denied calls, and no signed URL is created for any denial. A successful own access records the required audit event.
5. Reconcile source pins and source-current method inventory and **only then** consider a new method credit after human privacy/security review. Do not replace old immutable evidence with an invented success label.

Also inspect metadata list routes `/api/documents` and `/api/hcm/documents` for same-parent cross-legal-employer exposure; this draft does not certify or fix those other methods. Track overall acceptance in #2012 and HR/COE in #1966.

## Recorded transfer-history negative tests
The source-current [disposable PG16 HTTP runner](../../scripts/qa/tenant-document-legal-employer-http.mjs) additionally seeds a *real conflicting historical employer assignment* for an otherwise authorized employee and an *applied former-to-current legal-employer transfer* for a second authorized employee. Both previously readable documents must become opaque 404 while session and current employer grant remain active. Protected documents, employees, audit, assignments and transfer rows must remain unchanged by each denied request. This is a deliberately conservative read-only hold, not a claim to infer issuance-time employer from current worker attribution.

**Residual limitation:** The legacy `documents` schema has no immutable legal-employer-at-issuance field. Unrecorded or incorrectly migrated transfer history, employee self-document behavior, object signing and metadata list routes remain separate review requirements. Keep the `GET /api/documents/[id]` method at **GAP / zero credit** pending exact current-head reproof, transfer migration reconciliation and independent HR/security review. Do not edit old sealed receipts or enable production multi-entity access from this draft.

## Synthetic signed-URL proof extension (no real S3)

The dedicated disposable PG16 HTTP proof now also persists synthetic private-object document rows (no S3 upload or object server), configures an **HTTPS loopback-only, test-key signer**, and calls the real document GET handler. It requires a granted own-employer request to return a 302 signed URL bound to the exact document object key with a 60-second expiry, no inline content, no-store headers and a persisted access audit **before** the redirect. An actual same-parent other-employer private-object document, including a forged selector, must remain indistinguishable from an absent document and must not receive a signed URL or mutate protected SQL. Same-session revocation now uses a **separate worker without any historical transfer/assignment** so the denial cannot be falsely attributed to an already-active transfer-history hold; the private-object URL path is checked again after the revocation.

This **does not** test remote S3 object retrieval/readback, production credentials, malware/object integrity end to end, the feature-OFF HTTP path, or immutable legal-employer-at-issuance attribution. It confers **zero new credits**. The document handler and its original source pins remain unchanged by the added tests; the reconciled manifest preserves every source-withdrawal GAP. No re-pin, review approval, merge into `main`, or production enablement is implied.

## Latest-main integration (zero-credit reconciliation)

Merged main through `6c349677c481d11aeba9f2ed4c50fa1376306713` into this draft branch at `bfd830bc0198f6d9adab8da7b3cb78b9794e3225` (GitHub PR now has no merge conflict). All 75 main payroll-source withdrawal records remain exact, separate from this document GET hold. The source-count regression guard recognizes only the explicitly pinned document downgrade on top of those 75 holds. The resulting 498-method live ledger has 76 GAPs and zero new proof credits. The historical fixed-gap verifier failures still need independently sealed current-source proof and are not solved by this reconciliation; this is **not** a passing security gate or permission to merge/release.
