# SAML metadata public-surface gap: exact-source proof candidate

**DRAFT / NOT ACCEPTED / ZERO COVERAGE CREDITS**

Target: GET /api/auth/saml/metadata/[providerId] only. The application
handler remains unchanged at Git blob
589fb64376d807f03245a12c6aca1de7c3bfa08f.

## Scope and security question

Public service-provider SAML metadata is needed to configure an enterprise
identity-provider trust relationship. The handler selects only provider ID and
protocol. It emits fixed-origin SP metadata XML. It does not load employer
payroll rows, IdP signing certificates, client secrets, or account data.

This does disclose that an ID is configured as a SAML provider, even when
the provider is disabled. An independent identity/security reviewer must
decide whether that visibility is acceptable before the method can be
classified PUBLIC-BY-DESIGN. Do not assume the metadata is tenant-private.

The SAML login runtime remains disabled. This proof does not enable SSO,
configure any provider, or authorize a payroll action.

## Required execution

The dedicated CI workflow uses a fresh disposable PostgreSQL 16 app_db
and production-mode Next on 127.0.0.1 with fictional identities only.
It must verify all of these properties:

- Real owner sessions for two fictional attacker employers and one
  populated, higher-ID victim employer.
- Three distinct persisted SAML providers, plus an unrelated OIDC provider.
- Anonymous and signed-in requests receive actual 200 XML for each
  SAML provider, with identical bytes under forged organization, employee,
  legal-employer and provider selector parameters/headers.
- The response contains the canonical configured HTTPS origin, only the
  intended provider ID, and never seeded provider/tenant private markers.
- OIDC, nonexistent and invalid provider IDs return no SP metadata.
- Provider, user, membership, session, employee, payroll and audit SQL
  remain unchanged after all requests.
- Environment guard refuses remote database/server, real secrets and
  provider/payout/worker activation. No real provider interaction.

## Acceptance gates

1. Exact-PR-head source-only contract, standalone PG16 HTTP, and all
   applicable broader CI/security checks pass.
2. Identity/security owner reviews public disclosure of disabled SAML
   provider existence and the XML contract.
3. A **separate reviewed ledger update** may then consider switching this
   one method from GAP to PUBLIC-BY-DESIGN (not COVERED).
4. Until those gates complete, the method stays GAP, testedBy:null.
   There is no change to current 498-method counts, remaining page/action
   gaps, production release status, or independent tenant acceptance.

No production data, live banking, statutory filing, payroll money,
deployment, or SAML sign-in activation is allowed by this test.
