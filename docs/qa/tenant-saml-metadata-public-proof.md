# SAML metadata public-surface gap: exact-source proof candidate

**PROOF-ONLY SOURCE CHANGE / POLICY DECISION PENDING / ZERO COVERAGE CREDITS**

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

## Security decision record (unresolved, no implicit approval)

The HTTP fixture deliberately seeds three SAML providers with **enabled=false**
and verifies that an unauthenticated caller can fetch each provider's metadata
by its sequential numeric ID. An enabled OIDC record and unknown IDs return
no SAML metadata. The XML includes public SP URLs, not employer secrets, but
the 200-versus-404 distinction reveals that a disabled SAML record exists.
The proof now reports this exposure explicitly as
`PENDING_IDENTITY_SECURITY_OWNER_DECISION`; it does not endorse it.

**Privacy-first option:** Return an indistinguishable 404 for disabled SAML
providers on the public endpoint; permit public metadata only for enabled
providers. If identity-provider setup requires metadata before enablement,
provide an authenticated, employer-scoped preview as a separately reviewed
change. This changes runtime behavior and requires new exact-source proof.

**Pre-activation setup option:** Keep disabled SAML metadata public to allow
external IdP registration before activation. An identity/security owner must
explicitly accept the existence-disclosure tradeoff and document why a public
pre-activation URL is required. No reviewer decision is recorded in this PR.

**Recommended decision rule:** Prefer the privacy-first option unless the
onboarding requirement for anonymous pre-activation metadata is demonstrated.
Do not change application policy within this zero-credit proof PR by assumption.
In either case, keep SAML authentication disabled, do not promote this method
from GAP, and do not interpret passing CI as independent acceptance.

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

## Executed evidence

The production Next/disposable PG16 proof passed on
`fc901d453ea525df309d3d93ebf56a86e5469499` in
[run 42181922549](https://github.com/erwinmehehe/payrollph/actions/runs/42181922549/job/127773260581).
Its receipt records two attackers, three authenticated sessions, a populated
higher-ID victim, anonymous XML 200, identical forged-selector responses,
unchanged SQL and no private provider/tenant markers. It explicitly reports
disabled-provider existence disclosure, pending owner decision, GAP, zero
credits, no independent acceptance and no production certification.

This is evidence of existing behavior, including its unresolved exposure. It
is not an endorsement of public access for disabled providers. Main sync and
documentation edits create a new head; applicable checks must pass again.

## Source merge gate

This PR adds a guarded regression proof and decision record, with no runtime,
ledger classification, provider configuration, SSO activation or default-flag
change. Under `docs/engineering/change-risk-policy.md`, a maintainer may merge
that proof-only source change after reviewing the incremental diff and passing
all applicable exact-head CI/security/PG16 HTTP checks. No independent human
review is claimed or fabricated. Rollback is a source revert; no migration or
live provider operation is involved.

Merging this proof does **not** resolve the decision record above, accept the
existence disclosure, remove a feature gate, or promote the method. Keeping a
regression test for the current behavior must not be interpreted as a permanent
product requirement: the privacy-first follow-up would deliberately change the
handler pin and expectations after its policy is chosen.

## Classification and activation gates (still unresolved)

1. Exact-source standalone PG16 HTTP and applicable CI remain necessary evidence.
2. Identity/security owner reviews public disclosure of disabled SAML
   provider existence and the XML contract.
3. A **separate reviewed ledger update** may then consider switching this
   one method from GAP to PUBLIC-BY-DESIGN (not COVERED).
4. Until those gates complete, the method stays GAP, testedBy:null.
   There is no change to current 498-method counts, remaining page/action
   gaps, production release status, or independent tenant acceptance.

No production data, live banking, statutory filing, payroll money,
deployment, or SAML sign-in activation is allowed by this test.
