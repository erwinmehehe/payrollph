# Enterprise administration: atomic audit and tenant proof

## Problem and behavior

Enterprise POST could commit privileged state before recording its audit event.
An audit insertion failure could leave a security policy, permission assignment,
SCIM credential, identity provider or automation rule changed despite a failed
HTTP request. Provider disabling could revoke sessions without its audit receipt.

Each of the fifteen mutation paths now commits its state and `recordAuditEvent`
through the same PostgreSQL transaction. Discovery, certificate validation and
DNS verification stay before the write transaction. Existing employer, role,
company-wide access, MFA, origin, anti-lockout and SAML-runtime checks remain.

| Action family | Transaction includes |
|---|---|
| Security policy | Policy insert/update and audit |
| OIDC / SAML configuration | Provider, verification domain and audit |
| Domain verification | Verified state and audit |
| Provider enable/disable | Provider state, session revocation and audit |
| SCIM | Token creation or revocation and audit |
| Permission sets | Create/update and audit |
| Worker identity | Membership link/unlink and audit |
| Permission assignment | Set, dynamic-group binding or clear and audit |
| Automation | Create/update, enable/disable and audit |

## Executed fictional regression

SOLO_VERIFIED_DEV_RECOVERY. The production-mode Next server and real PostgreSQL
16 run use two authenticated fictional attacker employers and a separate,
higher-ID victim. A sequence increment proves each injected audit failure
actually reached the PostgreSQL audit trigger; a validation error cannot pass
as an audit rollback. Snapshots compare business rows, sessions, audit events
and audit-chain heads without printing credential material.

The unmodified main implementation fails the first policy audit-veto snapshot:
the policy remains changed. The fixed implementation passed 42 own writes,
42 injected audit-failure rollbacks, 42 real foreign-employer denials and 22
forged-resource denials. Both owners also pass the existing nonempty GET
validator, which rejects the real victim's response as a discriminator.

Cases include optional/required SSO policy transitions, last-provider lockout,
provider-bound session revocation, hashed-only SCIM storage, permission-set
updates, dynamic-group assignment, worker unlinking and automation toggles.
Unverified-MFA sessions are rejected/revoked, non-admins and cross-site requests
are refused. SAML authentication remains blocked by its existing runtime gate.

DNS TXT and OIDC discovery use an exact-host, test-process-only transport. It
refuses unlisted hosts and external fetch destinations. No external identity,
email, carrier, bank or payroll provider is contacted. The checked-in X.509
certificate is a fictional public certificate; no private signing key is added.

## Source-current GitHub Actions re-proof (2026-11-08)
The audit-error classification and reserved OIDC response validation changed the
application route and fictional proof harness after the first 199-input local
receipt was sealed. That earlier receipt was no longer valid and is not used
for the current provisional POST method.

[Fresh GitHub Actions PG16 HTTP job](https://github.com/erwinmehehe/payrollph/actions/runs/42489689534/job/128759143344) passed against actual
pull-request merge source `79bc9cd062e76af102c63fe0263a7b75ffad9e65` (parent branch head
`5d5d93b7ebb925d01ec93d73727c89fb9a3ba631`). The emitted executed counters are 42 own persisted transitions,
42 reached audit-veto rollbacks, 42 foreign employer denials, 22 forged
denials and two independent GET positives; the new audit failures return
generic HTTP 500 rather than a misleading 409. The renewed receipt pins
the exact execution, unchanged 199-file dependency set and the new route
and proof blob identities. Its review status stays PENDING. This is still
fictional development proof, not independent security review.

## Reproduce

Use a separate worktree, `npm ci`, and a dedicated local PG16 cluster listening
on 127.0.0.1:5432. Commit the proof inputs first: the harness refuses dirty or
untracked execution inputs and reports its exact source head.

1. `node scripts/qa/tenant-enterprise-admin-local.mjs db`
2. `node scripts/qa/tenant-enterprise-admin-local.mjs build`
3. `node scripts/qa/tenant-enterprise-admin-local.mjs start`
4. In another terminal: `node scripts/qa/tenant-enterprise-admin-local.mjs proof`

The DB helper parks an existing local app_db; it does not operate on Neon or any
remote database. Use a dedicated cluster so other local work is not interrupted.
All fixture keys and raw server logs stay in untracked outputs. The CI artifact
contains only the sanitized source-head/count receipt.

## Acceptance boundaries

The historical enterprise GET receipt is retained. Its function is byte-identical,
and the full reviewed POST-only source rewrite is separately pinned. POST now has
one provisional Owner-method credit backed by the fresh source-bound local PG16
receipt: 42 persisted-state and 42 wrong-employer discriminator checks, in addition
to the audit-veto and foreign/forged controls. The receipt binds 199 proof/runtime
inputs and is verified before accepting the credit. Current-head CI remains
mandatory. This is one API method, not twelve method credits.

Actual SSO login/token exchange, SCIM provisioning, automation execution, external
DNS ownership and production operations are not certified. All money/provider
flags, workers, calculation history and CSP remain OFF. No schema migration,
production SQL, live credentials, Neon operation or release is authorized.
