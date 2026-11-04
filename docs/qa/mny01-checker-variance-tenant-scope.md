# MNY-01: Checker variance read bound to the selected legal employer

**Status: DRAFT / review-only / NOT ACCEPTED. No new tenant-isolation method credit.**

## Scope and boundary

The checker variance view calls the existing authenticated
`GET /api/payroll-runs/[id]/variance` handler. That handler already resolves
`resolveMultiEntityContext` and checks `assertEntityResource` against the
persisted payroll run's legal employer. Previously the client omitted the
`legalEntityId` query selector, leaving the server to resolve the user's
saved employer preference instead of explicitly naming the payroll run being
reviewed.

This change binds every read for a run with a positive legal-employer ID to
`?legalEntityId=<selected-run-employer>`. Invalid positive-ID candidates are
rejected before HTTP, and a returned mismatched legal-employer payload remains
unverified. A null/unspecified legal employer preserves the prior flag-OFF
or legacy request path, without claiming multi-entity authorization.

The checker evidence cache key now also rejects malformed run employer and
org-unit IDs rather than retaining a verified observation for an invalid
scope. Server authorization and the independent maker/checker approval and
release controls remain the source of truth; the client checks do not replace
them.

## Verification

- `npx tsx --test tests/payroll-checker-variance-read.test.ts`
- `npm run typecheck`
- Exact draft-PR-head CI and independent security review before acceptance
- Test cases include selected own employer, changed selected employer with
  unchanged but wrong-employer response, invalid/unsafe selectors with no
  outgoing HTTP request, null-employer legacy compatibility, and malformed
  cached run scope

## Deliberate exclusions

This is a standalone MNY checker-read client boundary, not a new API proof
family or a shared ledger reconciliation. It changes no API handler, database
schema, migrations, payment provider, payroll approval, payout, feature flag,
shared tenant coverage manifest, or production data. **Zero new COVERED
methods.** Existing main proof pins are unchanged.

**Separate server follow-up required:** The resource-addressed
`GET /api/payroll-runs/[id]/explain/[employeeId]` handler currently checks
the run's organization and org-unit access but does not yet call
`resolveMultiEntityContext` or `assertEntityResource`. This draft does not
fix or certify that endpoint. Its independent route-level correction needs
its own current-source, multi-legal-employer fictional PostgreSQL 16 HTTP
positive, forbidden-selector and unchanged-victim proof, followed by shared
manifest reconciliation and independent privacy/security approval.
