# Targeted tenant-isolation CI path scope

## Safety-first revision

This PR reduces **manifest-only** CI fan-out in the following two workflows,
where no previously accepted source-pinned proof receipt is changed:

- `.github/workflows/remittance-action-tenant-isolation.yml`
- `.github/workflows/tenant-discipline-case-boundary.yml`

Their own workflow, route, related fixture and source/test paths still trigger
their jobs. The remittance workflow keeps its PostgreSQL 16 real-HTTP matrix.
The discipline source-only workflow is **not** an independently accepted real
HTTP method proof.

## Why the broader optimization was withdrawn

The initial draft modified 14 module workflows and moved the historical #1302
workflow to manual-only. Exact-source guards correctly rejected several
changed workflow blobs. A successfully executed PG16 receipt belongs to the
**workflow source that ran**, not merely to the route or test runner. Replacing
a stored blob SHA without renewed execution and review would break that chain.
The #1302 source contract also requires its PR trigger to remain.

The 12 potentially source-pinned workflows and the #1302 workflow have now
been restored byte-for-byte from `main`. No acceptance guard, provisional
tenant coverage credit, release flag or provider behavior was changed.

## Unchanged required checks

- Core CI `check` still validates source inventory and regression tests.
- Security HTTP Smoke `security-http-smoke` still blocks unreviewed method drift.
- Payout Payroll Isolation and CodeQL remain in their existing required lanes.
- Dedicated six-method and GAP source-only manifest watchers remain intact.

## Test and limitations

`tests/ci-tenant-workflow-paths.test.mjs` is included in the core CI lane.
It verifies the two narrow path filters, the twelve unchanged source-pinned
workflows' manifest and self-triggers, and the required security lanes.

This is a small, safe reduction in CI fan-out, **not** the original projected
25-to-10 workflow reduction. Any broader optimization must independently
re-execute and review the affected exact-source PG16 proofs and reconcile the
existing receipt chain before altering the protected workflows.

**Draft only: no production activation, no credit promotion and no merge
approval until exact-head CI and independent review pass.**
