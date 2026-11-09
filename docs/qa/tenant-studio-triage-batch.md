# Automation Studio operational-case triage: isolated tenant evidence batch

**Status: independent review candidate. Zero page, API method or tenant-isolation credits. Not production certified.**

This is an independent family for one action of `POST /api/automation-studio`:
`triage-operational-case` with transition `acknowledge` on a persisted employer-owned
attendance-resolution operational case. It neither modifies the existing API route nor
claims to prove its other operations (workflow publication, draft saving, execution
replay, retry, resolution, reopening or external integrations).

## Disjoint file scope

This PR adds only five uniquely named files: this runbook, one contract module,
one negative-control unit test, one real-HTTP PG16 proof runner and one dedicated
GitHub Actions workflow. It does **not** edit any shared tenant-isolation manifest,
source pin inventory, credit verifier, baseline, CI workflow, existing API handler,
plugin/provider integration, automation runtime or production configuration.

The route is instead **read-only source-pinned** to Git blob
`3bfc6666644ca11b480cf2735e9563d46139ebf4`. A change to that route
invalidates the evidence and requires a new source review and proof run.

## What the localhost-only test proves

The job checks out the exact PR head, refuses non-CI and remote database
settings before any app or database module is imported, starts a fresh disposable
PostgreSQL 16 `app_db`, and builds a local production-mode Next.js instance with
all providers, payroll operations and workers disabled. It refuses external API
credentials and never connects to a real employer or external provider.

A fixture seeds two independent authenticated employer owners and a separate,
higher-ID victim employer. Each employer has a real source attendance-exception
row and a source-linked operational case containing unique private marker text.
The runner requires both owners to successfully **acknowledge only their own case**
through the real HTTP POST route, with the exact case ID, organization ID, status,
actor ID and one new audit row. All linked attendance evidence, payroll state,
automation execution state, worker rows and the other employers' records must
remain byte-equivalent in structured SQL snapshots.

It checks direct foreign-employer selector substitution (HTTP 403), real victim
and other-actor case ID substitution (HTTP 404), duplicate acknowledgment,
malformed case IDs, inadequate evidence notes, unit-only bookkeeper, company
HR, missing recent MFA, anonymous and cross-site callers, and a still-authenticated
owner after the real employer membership is revoked. It requires exact denial
statuses and no private employer markers in the response body. All denied
requests must preserve every tracked protected SQL row and audit entry.

## Review / acceptance boundaries

- [ ] Dedicated exact-head PG16 HTTP job passes with own and negative-control counts.
- [ ] Broader PR checks pass, including existing fail-closed inventory/ledger tests.
- [ ] Independent security reviewer validates session, role, MFA, cross-tenant,
      audit and source protection without treating this as full POST coverage.
- [ ] Maintain `POST /api/automation-studio` at **GAP** until every other
      supported action has its own independently reviewed own/victim proof.

No external actor, real database, money-bearing workflow, release flag,
production system, schema migration, live deployment, manifest promotion or
API-method coverage count is changed. Revert this standalone test PR to remove
the evidence batch without changing application code or financial state.
