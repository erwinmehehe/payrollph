# Tenant-isolation CI scope

## Why the PR matrix became noisy

The shared `scripts/qa/tenant-isolation-coverage-manifest.json` is edited by
multiple independent API method proofs. Historically, its name appeared as a
`pull_request.paths` trigger in many module-specific PostgreSQL 16 acceptance
workflows. An update to one method therefore launched unrelated HR, Web Bundy,
remittance, journal and broad DL-01/DL-02 runners, each creating a disposable
database and often rebuilding Next.js.

## Required security gates stay unchanged

- The `CI / check` ruleset context remains required and fails closed on
  regression, PostgreSQL role/audit, lint, TypeScript, schema or build failures.
- `Security HTTP Smoke / security-http-smoke` remains required and executes
  the tenant-isolation coverage manifest and second-pass real HTTP checks.
- `Payout Payroll Isolation / payout-payroll-isolation` remains required.
- `CodeQL Security / Analyze JavaScript and TypeScript` remains required.
- `Tenant six-method exact-head GAP review` continues to trigger on manifest
  changes, as does the source-only tenant GAP factory. The dedicated payout
  profile PATCH workflow retains its manifest trigger.

## Specialized proof scope

Fourteen feature-specific workflows no longer use the shared manifest file as
a **standalone PR trigger**. Their route, own proof runner, workflow, and other
previously listed shared dependencies remain unchanged. If a PR changes an
affected API handler, proof fixture or shared authorization/schema dependency
listed by its workflow, the same real PostgreSQL/HTTP proof still runs.

A manifest-only edit must never be mistaken for new coverage credit. The
central coverage/inventory guards must still pass. Before approving a new API
method credit, update and execute that method's specific real HTTP suite on the
exact PR head, verify independent evidence and source pins, and obtain review.
Where a dedicated workflow is not invoked by the PR diff, deliberately modify
its own test/workflow or use an available manual dispatch; do not green-light
the manifest on a source-only check alone.

The legacy PR #1302 workflow is manual-only because #1302 merged on
2026-10-21. Historical proof remains available for explicit inspection, not
as a skipped job on every current PR.

## Regression guard

`tests/ci-tenant-workflow-paths.test.mjs` runs in the required CI validation
job. It blocks reintroduction of the global manifest trigger into unrelated
feature suites and checks that centralized required statuses and targeted
ledger watchers remain in place.
