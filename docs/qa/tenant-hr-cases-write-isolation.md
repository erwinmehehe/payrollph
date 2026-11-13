# HR Cases POST/PATCH tenant write isolation — separate fictional PG16 proof

**Draft proof / zero new API or page credits / NOT independently security- or HR-privacy-accepted.**

## Why another HR Cases PR

The merged HR Cases SSR guard (#1959) and existing source-pinned, read-only
HR Cases page/GET proof cover a different surface. They do **not** execute
`POST /api/hr-cases` or all four `PATCH /api/hr-cases` branches. This
separate proposed proof targets actual stored case writes and protected audit
rows, without changing the live handlers, source authorization policy,
coverage inventory, existing proof receipts or employer-data schema.

Review against the open post-merge acceptance queue #1966 and parent #1740.
Report Builder's related isolation fix has been merged via #1970; this PR separately tests HR Cases writes.

## What this PR adds

- `scripts/qa/tenant-hr-cases-write-contract.mjs`: exact Git source-blob
  pins for the existing HR Cases SSR/GET/auth/scope contract and additional
  security-request, feature flag, schema, DB and isolated baseline sources.
  Fail-closed checks require the POST and PATCH authorization gates.
- `scripts/qa/tenant-hr-cases-write-http.mjs`: real localhost Next production
  build against **empty, disposable PostgreSQL 16**, seeded with entirely
  fictional employers and employees.
- `tests/tenant-hr-cases-write-contract.test.mjs`: negative controls that
  reject forged own successes, private-data denials, changed audit snapshots,
  missing source guards, unsafe target URLs, forbidden feature flags and
  missing workflow execution constraints.
- `.github/workflows/tenant-hr-cases-write-qa.yml`: exact PR-head checkout,
  immutable source verification, PostgreSQL 16 service, disposable baseline,
  ephemeral encryption keys, local-only HTTP, strictly OFF document vault,
  multi-entity, providers, financial workers and payment integrations.
  Watches shared auth, request security, data layer and dependency files.
- This runbook. No application code or existing coverage/evidence ledger
  is edited.

## Required genuine requests and observations

1. Seed seven separate filler employers, two independently authenticated
   attacker employers A/B, and a populated **higher-ID victim** with its own
   HR, payroll and COE cases. Require the victim organization, user, legal
   entity, unit, worker and case IDs to exceed the attacker IDs.
2. Each A/B owner independently sends a real successful PATCH reply and a
   status transition. Verify the exact employer's PostgreSQL case, private
   message visibility, audit event and persisted state; no empty fake 200.
3. A/B each attempts **reply, internal note, status update, COE approval**
   against the other attacker and victim's actual case IDs. Each must return
   404. Snapshot ten employer-owned tables (including case messages and
   audit) immediately before/after each refusal, for **A, B and the victim**
   regardless of the requested target. Cross-origin refusals use the same
   three-employer immutable comparison.
4. A/B linked employee accounts create genuine cases via HTTP POST. Include
   forged foreign `organizationId` and `employeeId` body values, and
   verify the persisted case and audit are bound to the *authenticated*
   employee's own employer, worker and user ID instead.
5. Employees can PATCH a reply to their own persisted case but cannot write
   another employee/employer's case, an internal note, a status change or
   COE approval. Staff owner POST is refused because staff are not
   automatically linked employee self-service accounts.
6. Verify anonymous and malformed-case-ID refusals, cross-site origin
   denial, and that the own COE approval returns 503 while the document
   vault is disabled. **No COE object is created or uploaded.**
7. Revoke the fictional A employee's employer membership while retaining the
   account login. Subsequent POST and PATCH must be refused and protected
   case/audit SQL must remain byte-equivalent around each refusal.
8. The runner asserts **8 actual successful writes**, **20 cross-employer
   404 denials** and at least **31 other/total negative writes**, printing
   a bounded sanitized summary only upon full success.

## What this does NOT establish

- No browser hydration, A→B→A stale-response proof, or every employee/staff
  page route. The existing read-only SSR/GET suite remains separate.
- No multi-legal-employer activation: `MULTI_ENTITY_ENABLED=false` is a
  mandatory test guard. Same-parent legal-employer split and historical
  worker attribution remain unaccepted.
- No COE issuance, real document-vault provider, stored-object recovery,
  PDF/download authorization, identity-provider integration, real HR data,
  approved billing, payroll run, remittance, or money movement.
- No proof of all permission overlays, TOCTOU revocation races, every POST
  rate-limit branch, every PATCH body coercion variant, or every role
  transition. The real-source and negative controls are deliberately bounded.
- No tenant method/page credit and no independent privacy/security or
  production readiness certification. The existing 16 page/action GAPs and
  other method GAPs are NOT silently promoted.

## Maintainer review gates (all mandatory before merge)

- [ ] Review the exact diff for five intended test/workflow/document files,
      no production code and no prior-ledger or original-receipt changes.
- [ ] Inspect the **exact final reviewed PR head** source pins and verify
      the new unit/negative-control job genuinely passed.
- [ ] Inspect the disposable PG16 HTTP run logs: real own success rows,
      victim higher-ID construction, all expected foreign/employee/revoked
      denials, no protected SQL/audit mutation, no skipped proof.
- [ ] Check required general CI, CodeQL, Security HTTP Smoke, and source
      inventory status on the same final head, including existing failures.
- [ ] Document remaining HR privacy and same-parent legal-employer
      acceptance decisions in #1966. Solo maintained engineering QA may be
      recorded as `SOLO_VERIFIED_DEV_RECOVERY`; it is never independent
      acceptance.
- [ ] Make an explicit maintainer merge decision only after review. No
      automatic merge, release activation, staging/production DB query,
      external provider access or deployment is authorized.

This is a focused QA proposal, not a tenant-wide claim.
