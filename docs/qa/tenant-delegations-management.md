# Delegation-management tenant boundary — independent batch

**Status: DRAFT / SOURCE HARDENING / ZERO COVERAGE CREDITS.**

This narrowly scoped change covers GET, POST and PATCH at `/api/delegations`.
It is separate from open PRs #1612 (onboarding), #1631 (billing setup),
and #1632 (worksites proof). The app route, helper, tests and
method-specific table assertion remain disjoint. The central tenant manifest
is necessarily re-pinned to the changed delegation route SHA. That metadata
file is also touched by #1612 and #1632, so a maintainer must reconcile it
from fresh main at merge time. No status, method credit or inventory count
is changed by this batch.

## Implemented controls

- **GET:** non-admin delegation visibility by display name now requires a
  uniquely identified active member within the chosen organization. A name
  collision fails closed instead of displaying another member's delegations.
  Company-wide approval administrators retain their management view.
- **POST:** source and delegate must each resolve to one active approval-capable
  member of that organization and, for unit-scoped callers, the same permitted
  unit. Both membership and the underlying user account must be active. Stale/inactive memberships and ambiguous names cannot be selected.
- **PATCH:** delegation ID lookup joins the persisted delegation organization
  to the authenticated actor's active membership *before* role checks. An
  existing foreign ID and a nonexistent ID both receive generic 404.
- **PATCH activation:** a non-admin must be the uniquely resolved active source
  account. Enabling a saved delegation also requires both current participants
  to be active, in scope and approval-capable. Administrators can still revoke
  a delegation when a participant has left. The active field must be boolean.
- Existing session, same-origin, MFA, public demo, role, unit and audit guards
  remain. Update SQL still matches both delegation ID and organization ID.

## Focused regression and limitations

The test file `tests/tenant-delegation-management.test.ts` exercises three
independent fictional employer membership lists, names shared across
employers, within-employer collisions, unit scoping, and static route checks
for the active membership and foreign-ID SQL guard.

The table-driven PG16 HTTP fixture now expects 404 rather than 403 for
existing foreign delegation IDs. The existing full write-table runner retains
its own-row success, two independent attackers and untouched victim checks.

Run: `npx tsx --test tests/tenant-delegation-management.test.ts`

**These are source/unit contracts, not live HTTP proof.** The method coverage
manifest stays unchanged. Real synthetic two-attacker POST/PATCH/GET against
production-mode localhost Next.js and disposable PG16, with populated own
resources, higher-ID victim IDs, unchanged victim/audit snapshots and forged
selector checks, is still required to claim method COVERED. Do not use
development, staging or production payroll data for that proof.

Not included: retroactive invalidation of already-active delegation chains
after account revocation, concurrent membership changes during mutations,
cross-legal-entity delegation modeling, approval-decision authorization,
payroll release, payment providers or money movement. No release flags, SQL
migrations, deployment or real-money permissions are changed.

Source rollback: revert the isolated delegation-management route and helper
changes. Any activation/production action must go through separate gates.
