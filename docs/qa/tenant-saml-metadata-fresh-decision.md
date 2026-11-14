# SAML metadata: fresh public-boundary evidence

Target: `GET /api/auth/saml/metadata/[providerId]` only. This is a public
service-provider XML contract proposal, not tenant-private whole-method credit.
Anonymous OIDC `POST auth/sso/resolve` stays GAP under the owner's decision.

## Public fields proposed for approval

- The configured canonical HTTPS application origin.
- The numeric ID of an **enabled SAML** provider, embedded in the service-provider
  entity ID and assertion-consumer callback URL.
- Static SAML protocol/binding identifiers, signature-request policy and XML
  metadata attributes. No assertion, signing secret or private identity record.

Enabled SAML provider existence is deliberately observable. Other provider IDs,
including disabled SAML, enabled OIDC and unknown IDs, return identical uncacheable
404 JSON. This is not a claim to conceal enabled-provider existence. There is no
timing-equivalence or general authentication/privacy certification claim.

Provider names, organization/employee identifiers and names, email addresses,
client IDs/secrets, IdP entity IDs, certificates, membership/session details,
bank/payroll information and audit records are excluded from public responses.

## Real execution required

The new workflow uses production Next and disposable PostgreSQL 16. Seven filler
employers/providers push all three actual employers and their provider IDs above
six. Two real signed-in attacker sessions, the higher-ID victim and anonymous
requests exercise the same public contract: 48 HTTP requests with own enabled
XML, forged employer/provider selectors, disabled/OIDC/missing/invalid refusals,
and an enabled-to-disabled transition in the same server process.

Every request compares all eight identity/core snapshots and **every public
organization-owned table**, globally. The only permitted DB mutation is one
explicit fictional provider-disable fixture update, separately snapshotted.
All actual HTTP reads must leave SQL unchanged. Disabling the victim's provider
must immediately hide it; an unrelated enabled provider must still work.

The sanitized artifact records the exact Git head/run, import and explicit
schema/subprocess inputs, complete numbered SQL baseline inventory and actual
result. The existing historical proof files and privacy-hold pins are untouched.
Source/unit tests are not execution evidence. Failed setup means NOT_RUN.

## Execution status

Fresh HTTP/PG16 execution: **NOT_RUN** at initial PR creation. Replace this
section with inspected successful run/job evidence and actual counts only after
the new workflow completes.

## Accounting and decision boundary

Main at this batch's base: 461 COVERED / 2 GAP / 23 PUBLIC-BY-DESIGN /
12 TOKEN-ONLY, 498 API methods. This PR changes no manifest labels or counts.
Metadata remains GAP until the owner approves the exact public contract above
and its executed evidence is reconciled by the normal reviewed classification
writer. A public classification would reduce GAP by one and add **zero COVERED**
methods. Resolve remains held regardless of this decision.

SOLO_VERIFIED_DEV_RECOVERY only. Independent identity/security/privacy and
production acceptance remain pending. No SAML login activation, deployment,
production SQL, migration, Neon access, real credentials or provider calls.
Money/provider/history/CSP flags, workers and scheduler remain OFF.
