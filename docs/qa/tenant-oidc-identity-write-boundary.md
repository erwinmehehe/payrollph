# OIDC callback identity-write boundary

Evidence label: **SOLO_VERIFIED_DEV_RECOVERY**. No method credit or production authentication acceptance.

## Defect and repair

The callback previously refreshed an existing external identity before checking its current employer membership. It also inserted or refreshed an identity before checking inherited MFA requirements. A denied login could therefore change account-link state. The existing provider/subject lookup did not independently reject a link whose stored employer contradicted its provider's employer.

The callback now rejects that inconsistent link and defers all identity persistence until verified email/domain, active membership and inherited MFA checks have passed. The persistence helper rechecks and share-locks the enabled OIDC provider, active account and active employer membership in one PostgreSQL transaction. An existing link update must match **identity ID, employer, provider, account and subject** together. A lost target or failed transaction cannot fall through to session creation.

The initiating-browser cookie, one-use state, code exchange, signature/nonce/issuer/audience validation, MFA policy, session and audit controls remain required. Consuming a valid one-use login state on a failed attempt is intentional; identity/session writes are a separate boundary.

## Executed local evidence

Base: `3aae6506560087f0e8696abe5d155f75d934a5d0`. Fictional data only.

- Actual callback TypeScript executed with explicit dependency doubles: old source **1 passed /8 failed**; revised source **9 passed /0 failed**. These are handler regressions, not a real IdP or HTTP login receipt.
- A fresh PostgreSQL **16.14** instance was created on private loopback port **55442**, using only the dedicated `tenant_oidc_membership_test` database. No existing application database was reset or queried.
- The production persistence helper made **4 legitimate writes** across two fictional employers; **14 forged/disabled/revoked writes** were refused with unchanged snapshots of five fixture tables. A populated higher-ID victim's original identity stayed unchanged.
- A real concurrent membership-revocation transaction held the row while the helper waited on its share lock. After revocation committed, the helper refused without updating the identity.
- Removing only the employer predicate from the existing-link update made the PostgreSQL test fail on the deliberately inconsistent employer row. Restoring the exact helper source returned the test to green.
- The PostgreSQL fixture uses a minimal real schema for the helper's exact columns and constraints, not an application migration or a complete production-schema acceptance run.

## Reproduction and CI

The dedicated read-only workflow `tenant-oidc-identity-binding-qa.yml` uses a fresh disposable PG16 service, exact PR-head checkout, callback regressions and the real PostgreSQL transaction fixture. It does not start an IdP, call a provider, or grant coverage credits. The existing initiating-browser HTTP workflow is retained with renewed source pins; its refusal tests do not certify successful token exchange.

Run the handler and fixture-guard tests with:

```text
node --test tests/tenant-oidc-callback-identity-writes.test.mjs tests/tenant-oidc-identity-binding-contract.test.mjs
```

The PG16 fixture is opt-in and refuses an existing public schema, remote databases, ordinary app_db, unknown ports, provider credentials, workers and protected flags. It requires `OIDC_IDENTITY_BINDING_PROOF=fictional-pg16-only`; local port 55442 or a dedicated GitHub Actions PG16 service is mandatory. Do not point it at an existing database.

## Remaining acceptance

The callback remains **GAP**, `testedBy:null`; inventory totals stay **456 COVERED /23 PUBLIC /12 TOKEN-ONLY /7 GAP** of 498. The new tests do not prove a complete signed IdP-over-HTTP login, production provider behavior, atomic session/audit creation, or concurrent changes to every global security policy. Fresh exact-head CI/HTTP and independent identity/security acceptance remain pending. No real credentials, providers, payroll, schema migrations or production operations were used. Rollback is a source revert with no data repair.
