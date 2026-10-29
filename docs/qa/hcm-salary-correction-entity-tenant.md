# Salary-correction preview legal-employer isolation

**Status:** proposed source-identified authorization fix. PG16 exact-head HTTP and independent security review are not yet confirmed passing.

## Defect and scope

The default-OFF salary-correction preview POST route checked organization roles,
MFA and that the stored employee legal-employer ID matched the caller-selected ID.
It did not check the caller's active legal-employer grant when multi-entity mode
was on. A company-wide People administrator with access to employer A could
supply another legal employer B in the same tenant and reach individual salary
revision and payroll-period metadata. This is a source-level gap, not a
confirmed live exploit.

## Proposed fix

- Keep feature-OFF, same-origin, authenticated employer, company-wide role,
  MFA, rate limits and the read-only projected response.
- Reconcile raw body legalEntityId with the header and any URL selectors via
  resolveMultiEntityContext before any employee or salary SQL.
- Explicitly require the requested employer to be within the user's grants and
  recheck the actual stored employee employer with assertEntityResource.
- Refuse individual salary preview for group-wide identities. Preserve
  unmatched employee 404 behavior and no-cache responses.
- With multi-entity OFF, do not query optional legal-employer grants; preserve
  existing single-employer behavior.

## Proof and release boundary

A new disposable PostgreSQL 16 real-HTTP candidate uses two independent
authenticated owner attackers. Each owns one legal-employer grant and a real,
nonempty salary-revision-backed employee. Their organization also includes an
ungranted sibling legal employer with a real worker and pay revision.
The higher-ID third tenant is a genuine persisted victim. It tests two
independent owned 200 responses, sibling employer and object denials,
real cross-tenant denial, conflicting body/header/query, noncanonical IDs,
same-session grant revocation, and exact unchanged employee, pay, payroll and
audit source snapshots.

No remote services, financial writes or live records are involved.
The candidate is not independent approval.

**Tenant POST stays GAP, testedBy null, zero new coverage credits.**
The API ledger remains 341 COVERED / 10 PUBLIC-BY-DESIGN / 147 GAP
across 498 methods. This route must not merge or activate until exact-head
CI and independent security/release-owner review. No database migration,
production feature activation, payout, salary write or payroll posting is in
this proposal.
