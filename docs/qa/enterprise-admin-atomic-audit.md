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
and the full reviewed POST-only source rewrite is separately pinned. POST remains
GAP with zero new method credits in this security-fix PR; final-head CI and method
credit review are separate acceptance steps. No metrics are rounded up.

Actual SSO login/token exchange, SCIM provisioning, automation execution, external
DNS ownership and production operations are not certified. All money/provider
flags, workers, calculation history and CSP remain OFF. No schema migration,
production SQL, live credentials, Neon operation or release is authorized.
