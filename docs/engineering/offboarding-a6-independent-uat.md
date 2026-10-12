# A-6 offboarding: independent HR / IT / Finance acceptance

**Status: not yet independently signed.** Offboarding source is gated OFF. All tests must use a disposable synthetic employer and have payroll payout flags disabled. The test run does not authorize final-pay bank release.

## Role-assigned UAT (human witnessed, with exact commit SHA)

| Test | Authorized actor | Expected evidence | Result |
| --- | --- | --- | --- |
| Create separation intent with last working date | HR preparer | dated source event and worker scope | NOT_RUN |
| Submit Finance/Admin/HR/IT clearance | distinct department operators | each completed field and audit | NOT_RUN |
| Attempt self-approved waiver | separation preparer | rejected 403, zero waiver inserts | NOT_RUN |
| Approve supported waiver after MFA | independent company-wide owner/admin | reason >=20 chars, evidence reference, durable audit and distinct preparer | NOT_RUN |
| Revoke waiver before release and retry | independent reviewer | old waiver retained, revoked_at immutable, stale release refused | NOT_RUN |
| IT external grants exist and remain active | IT operator | fail closed, even if IT equipment waiver exists | NOT_RUN |
| Zero external grants without inventory evidence | IT operator | fail closed until independent inventory attestation | NOT_RUN |
| Employee ESS/linked worker memberships after effective last day | IT + HR | only separated employer access revoked in same transaction, other employer membership remains | NOT_RUN |
| Simulated final-pay audit insert failure | Finance/DBA | employee status, ESS logins, sessions and final-pay release all roll back | NOT_RUN |
| Different-tenant access revocation attempt | Security/QA | denied, zero cross-tenant audit changes | NOT_RUN |
| COE delivery proof, physical assets & external IdP/SSO/MDM revocation | HR + IT | actual independent provider evidence, no false audit attestation | NOT_RUN |
| Three distinct final-pay maker / checker / releaser actors | HR + Finance | correct segregation; **no real payout**, bank evidence independently checked | NOT_RUN |
| Phone UAT 375px, status clarity, failed requests | independent QA | reviewer-screen screenshots with synthetic data and browser/OS details | NOT_RUN |

## Automated evidence that is NOT human signoff

- Existing behavioral PostgreSQL tests validate duplicate waiver unique index, historical revocation, audit rollback and membership isolation.
- New exact-head cross-employer denial regression and rollback-only unnumbered proposal rehearsal must pass CI.
- Existing final-pay gates remain separate, including FINAL_PAY_MANUAL_RELEASE_ENABLED; keep OFF.
- Payout/bank provider execution, government filing and live revocation of external SSO/MDM are out of scope and must remain disabled.

## Required separate release approvals

Independent HR and IT attestations, Finance/payment reviewer, DBA approval of *new uniquely numbered* schema and restore evidence, DPO privacy/legal-hold review, security/tenant isolation sign-off. Store named operator, timestamp, SHA, accepted/failed outcome, and hashed supporting evidence privately. No placeholders above count as approvals.

No production Neon DDL, real employee action, bank transfer or live account deprovisioning is authorized by this document.
