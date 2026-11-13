# Form 2316 selected worker: same-parent legal-employer isolation

## Identified boundary

On `/workspace/2316`, an authenticated payroll operator with a legal-employer grant could supply the ID of a worker belonging to a different legal employer under the **same** organization. When `separationId` was absent, the original employee query checked only organization ID and worker ID, then returned an HTTP 200 guidance screen for any existing worker. An unknown worker got 404. This could reveal that a real foreign-employer worker existed even though no private Form 2316 was mounted.

This is a source-identified **existence-oracle risk**, not confirmed live exploitation or data disclosure of payroll amounts.

## Fix

- Read the worker's current `legalEntityId` with its organization and ID.
- If no released separation is selected, enforce `assertEntityResource` on the worker's actual legal employer **before** any guidance/UI output.
- Preserve the existing historical exception: when a separation ID is selected, the **released frozen final-pay employer** must authorize the page. A worker's current employer may legitimately differ after transfer; never substitute it for the historical tax employer.
- Keep active payroll role, company-wide membership, session and source-object requirements.

## Isolated regression proof

The feature-enabled prior-worker PostgreSQL 16 workflow now also probes `/workspace/2316` with signed-in fictional owners:

- Valid own worker without separation: 200 guidance.
- Valid own worker with released frozen separation: 200 Form 2316 review.
- Same-parent, foreign legal-employer worker without separation: 404.
- Same-parent, foreign legal-employer worker with separation: 404.
- Cross-organization worker and revoked membership: 404.
- All GETs read-only against fictional organization, employee, separation, payroll and audit snapshots.

The dedicated source contract verifies the new guard runs before guidance or the Form 2316 client. No live DB, payroll, filing, tax certificate issuance, payment or deployment is used.

## Acceptance

The Form 2316 page remains **GAP, zero new page credits** pending passing exact-final-head synthetic HTTP tests and independent payroll, tax/privacy and security review. This fix does not certify all tenant-isolation methods or pages.
