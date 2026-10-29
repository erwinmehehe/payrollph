# Invitation administration: employer and unit isolation

**Status:** source hardening proposal only; tenant coverage ledger unchanged.
**No production deployment, customer invitation or delivery call was made.**

## Source-identified authorization gap

Before this change, a unit-scoped employer administrator could POST an invitation
without `orgUnitId`. The endpoint inserted an invitation with `orgUnitId = null`,
and accepting the token created an active company-wide user membership.
The same caller could choose privileged roles such as administrator or
bookkeeper. The GET endpoint also returned unfiltered email/name/role lists
for the entire employer to a unit-scoped administrator.

This is a source-level privilege escalation / unit-boundary defect, **not**
evidence that a live account was exploited.

## Proposed containment

- Preserve the active employer, role, session-policy, same-origin, MFA, paid-plan,
  rate-limit and disabled-delivery checks.
- A company-wide administrator retains normal member/invitation visibility and
  existing non-owner invitation roles. Only a company-wide **owner** can
  issue another owner invitation.
- A unit-scoped administrator can see only member and invitation records whose
  `org_unit_id` exactly matches their current grant, and can issue **employee**
  invitations only for that same unit.
- Missing, cross-unit or noncanonical unit selectors fail closed **before**
  looking up prospective user emails, creating a token or queueing email.
- The target unit is looked up by both `organization_id` and `org_unit_id`;
  callers cannot substitute another employer's unit ID.
- Both SQL lists and the returned JSON response remain employer-bound; private
  GET results are never cached.

## Additional disposable HTTP proof candidate

The existing `tenant-invitations-post-boundary.mjs` now also constructs a
real unit-scoped administrator, a sibling-unit invitation and membership,
and a higher-ID victim employer. It exercises a populated unit-filtered GET,
eight denied same-employer escalation attempts, both real cross-employer
denials, an authorized same-unit employee POST delivered only to a local SMTP
sink, persisted invitation/audit/outbox evidence, and revoked-grant denial
using the same session. Every denied request checks SQL snapshots for all
three employers. This is **synthetic candidate evidence**, not independent
security sign-off or live customer validation. Preserve zero method credits.

## Review and acceptance

- Unit tests cover canonical unit IDs, same-unit employee success, foreign/global
  unit denial, privileged-role denial, owner gating and source ordering.
- Previously credited GET employer-level PG16 proof remains separately retained.
- **POST invitations stays GAP with `testedBy:null`, 0 new coverage credits.**
  An exact-head disposable PostgreSQL 16 real-HTTP positive invitation,
  second-attacker/victim denial, unit-sibling denial, persisted invitation +
  audit unchanged on denials and independently reviewed privilege acceptance
  are required before promoting any POST tenant coverage.
- The broader tenant ledger remains 341 COVERED / 10 PUBLIC-BY-DESIGN /
  147 GAP among 498 methods. Normal CI, security review and protected-main
  checks still apply.

The existing accept-invitation route is unchanged. No SQL migration,
feature activation, billable invite, external provider, production email,
customer data, payout or payroll action is in scope.
