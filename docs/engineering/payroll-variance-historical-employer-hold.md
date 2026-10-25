# Historical legal-employer attribution hold — payroll variance

**Status:** draft security hardening, not an accepted payroll/statutory certification.

## Context

A payroll run records a legal employer. Its employee's current legal-employer ID is **not effective-dated historical payroll proof**. The source-driven variance view compares current and earlier payroll-run entries and can include pay revisions, audit event categories, gross/net amounts and worker names. Organization-scoped joins alone do not establish that all those entries belong to the run's frozen employer.

## Containment behavior

With the multi-entity release flag enabled, the report authorizes the signed-in actor's organization, org unit and explicit legal-employer grant **before** loading payroll entries. Next it compares the union of current/comparison employee IDs against the roster. Every ID must resolve to a unique worker whose current organization and legal employer match the run's frozen legal employer. Null, missing, foreign, transferred, mismatched or duplicate attribution is a hard error: HTTP **409 PAYROLL_VARIANCE_ENTITY_RECONCILIATION_REQUIRED**, private no-store. The response does **not** produce a partial report or sensitive salary/revision/audit output. The flag-OFF route retains the original behavior. No migration or live data transformation is introduced.

## Reconciliation required before removing the hold

A verified historical payroll/employer ledger, original pay-run source snapshots, actual transfer dates and approvals must independently establish the correct origin legal employer for affected periods and employees. An authorized payroll/security owner should review each discrepancy and introduce an effective-dated immutable source of truth in a distinct design and reviewed migration, with dedicated same-tenant and cross-tenant access controls. **Never** auto-backfill from current employee affiliation, set the employer to the operator's selection or silently drop discrepancies. Historical bank changes/approval and payout paths must be handled separately.

## QA and acceptance

The added [pure policy regression](../../tests/payroll-variance-entity-boundary.test.ts) and [authenticated HTTPS PG16 test](../../scripts/qa/payroll-variance-entity-http.mjs) execute in [Multi-Entity Browser and HTTP Acceptance](../../.github/workflows/multi-entity-browser-qa.yml) using only fictional tenants and dummy data. The latter proves legitimate own 200 controls, real foreign run 403, same-tenant selection forgery denied, transfers/wrong employer/malformed cross-tenant payroll-entry FK held with 409, flag-OFF compatibility and unchanged victim DB snapshots. The original GET proof remains credited once; overall inventory must not be inflated. Exact-head green CI plus independent security-owner review are required before any merge or enabled production use. **No money, bank provider, filing, real payroll or production DB is touched.**
