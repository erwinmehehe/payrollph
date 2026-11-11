# SAML metadata privacy recovery: exact-source, zero-credit proof

**PR #1934: disabled providers are concealed. GAP / testedBy:null remains unchanged.**

## Runtime contract

`GET /api/auth/saml/metadata/[providerId]` selects the path ID, SAML protocol
and `enabled=true` in the same database predicate. Disabled, wrong-protocol
and missing providers return the same generic JSON 404 with `Cache-Control:
no-store`. Enabled SAML providers return canonical public SP XML with no-store.
Malformed IDs retain the existing 400 behavior. Query parameters and headers
cannot substitute a different provider or disclose private tenant/provider fields.

The repaired handler blob is `4f8d12b9867de0c18aea8e447208e8470773350b`.
The owner's privacy-first decision supersedes the old pre-activation disclosure
question. It does not activate SAML login or accept this method as COVERED.
An authenticated employer-scoped metadata preview, if required for onboarding,
is a separate change. No preview or new login flow is introduced here.

## Historical evidence is not proof of the repair

PR #1771 and run 42181922549, on head
`fc901d453ea525df309d3d93ebf56a86e5469499`, demonstrated the OLD route blob
`589fb64376d807f03245a12c6aca1de7c3bfa08f`, including anonymous 200 responses
for disabled providers. That result documents the original exposure only.
It must never be cited as a passing receipt for the repaired behavior.

## Current executable proof

The dedicated read-only workflow checks out the exact pull-request head, verifies
source identities and runs the actual production-mode Next server on localhost
against a fresh disposable PostgreSQL 16 database. Only fictional identities,
provider records and ephemeral test credentials are permitted.

The runner seeds two attacker employers and one populated higher-ID victim,
with three real owner sessions. Each employer has one enabled SAML positive
control and one disabled SAML negative control. An enabled OIDC provider and
nonexistent IDs are additional negative controls. It checks:

- Canonical XML 200 for each enabled provider, anonymously and with all three
  sessions, despite forged organization, tenant, employee, legal-entity and
  provider selectors in query parameters and headers.
- Identical generic no-store 404 for disabled, OIDC and missing providers,
  including forged requests that name a different enabled provider.
- The SAME production process conceals a previously visible provider after one
  explicit fixture-only disable update; an unrelated enabled provider still works.
- Complete provider, organization, user, membership, session, employee, payroll-run
  and audit snapshots are unchanged by every HTTP request. The fixture toggle is
  explicitly accounted for separately and is not mislabeled as an HTTP write.
- No private marker or XML appears in error bodies; malformed IDs return 400.
- Workers, scheduler, payouts and protected payroll/CSP flags stay disabled.

The handler unit tests execute the actual TypeScript handler with dependency
doubles. They are not PostgreSQL/HTTP receipts. The contract tests include
negative controls against wrong status codes, cacheable responses, altered
bodies, wrong provider IDs and missing privacy checks.

## Source reconciliation and remaining acceptance gates

The manifest retains GAP / testedBy:null and zero method credits. The inventory
uses its existing exact-source uncredited-review pattern for this one GET only.
A dedicated verifier pins the handler, proof, contract, tests and workflow,
reconstructs the historical handler byte-for-byte, and rejects changed source,
removed holds or attempted coverage promotion. All other inventory rules remain.

The presence of this proof code or a passing source guard is NOT an execution
receipt. Consult PR #1934 for the exact-head workflow/job result and unresolved
failures. No passing current PG16 execution is asserted by this document.
Independent security acceptance and production certification remain unclaimed.

Keep SAML start/ACS deferred. Do not activate real providers, query production,
run migrations against a remote database, deploy, enable protected flags or
merge this draft without the applicable checks and review. Rollback is a source
revert; no production data repair is needed.
