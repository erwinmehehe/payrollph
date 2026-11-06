# Year-end API: tenant-boundary recovery candidate

**DRAFT: GET and POST remain GAP, with zero new API method credits.**

## Scope
- GET /api/year-end: JSON, annual source preflight, Form 2316 draft, Form 2316 print preview and Alphalist source.
- POST /api/year-end: unbound annualization and binding to a freshly calculated December payroll run.
- Originally credited at #1730; #1744 changed the source and invalidated the earlier receipt. The new proof cannot borrow that old receipt.

## Tenant-isolation change
The year_end_adjustments table stores separate foreign keys for organization and employee, without a composite same-employer constraint. An inconsistent import could associate one employer's adjustment with a worker from a different employer. The GET handler now checks **both** the adjustment employer and the joined employee employer.

A fictional PostgreSQL 16 test inserts exactly that inconsistent relationship into two attacker employers' annual tax data, pointing to a real higher-ID victim employee. The actual own-employee report must still return just one owned employee and no victim identifiers. The test also checks two real foreign 403 denials and unchanged tenant SQL snapshots.

## Comprehensive HTTP candidate
The existing dedicated year-end write-row test exercises:
- Positive nonempty POST annualization with persisted adjustments.
- A separately successful POST binding to the owned December final payroll run, plus queue and audit effects.
- Foreign POST and forged victim-run ID denials, with victim database unchanged.
- Positive GET JSON and preflight responses, with populated source evidence.
- Successful 2316, 2316-print, and Alphalist source outputs, their response headers, and required own-employer audits.
- Real foreign employer GET denial for each format, plus forged worker-ID refusal.
- Two independent attacker sessions and a persisted higher-ID victim.

Source, payroll queue, annualization and proof helpers are hash-pinned in the accompanying unit contract. Any source change invalidates the pending proof.

## Approval and release hold
1. Run exact-PR-head source contracts, standalone JSON fixture, and dedicated full-method POST/GET tests under disposable PG16 and production-mode Next on localhost. All applicable CI/security checks must pass.
2. Obtain independent payroll, security and privacy review of employee matching, annual tax report handling, run binding, and source proofs. Verify actual workflow IDs and source hashes.
3. In a **separate reviewed ledger change**, consider promoting GET and POST individually only with complete successful real-HTTP evidence and owner acceptance. A successful JSON GET alone never proves 2316/Alphalist, and a denied POST alone never proves annualization or binding.
4. Until then retain GAP, testedBy:null, zero credits, production NO-GO, no payroll money or filing activity, and no changes to real employer data.

This PR does not deploy, enable a provider, send a payout, submit a statutory filing, activate a feature flag, or authorize financial processing.

## November 6 four-method revalidation request

This documentation update deliberately triggers the dedicated year-end full-method candidate workflow on the exact head of the separate four-method billing/year-end proof PR. Existing `GET /api/year-end` and `POST /api/year-end` remain **GAP**, `testedBy:null`, and **zero credits**, regardless of CI execution, until exact-head real HTTP evidence and independent review are accepted. The billing start/cancel fictional-provider proof is documented in `docs/qa/tenant-billing-subscription-methods.md` and does not change year-end code, SQL, flags, provider settings or acceptance status. Reuse neither old #1730 receipts after #1744 source changes nor any previous-head green check to certify this head.

**Source pin review (November 6):** The earlier year-end contract pinned `src/lib/payroll-engine.ts` at `961cfb55`. At the current main-derived branch the blob is `dc5719a2`; direct old-vs-new blob comparison identifies one added `workDate` property passed to attendance `calculateClockHours(...)`, with no other changed bytes. The current contract now pins `dc5719a2` and still **requires fresh exact-head PG16 HTTP**, including source exports, annualization and December binding. This narrow diff review is not a substitute for independent payroll/security acceptance; no method status or credit changes.
