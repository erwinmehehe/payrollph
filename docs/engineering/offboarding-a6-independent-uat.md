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
| Independent last-day **local** access cutoff before final-pay release | company-wide HR/admin other than preparer, MFA | cutoff evidence ref, employee still Separating, final-pay still draft/approved, original sessions revoked, other employer preserved | NOT_RUN |
| Premature and self-approved local cutoff denial | HR/security reviewer | 409 before PH last day, maker denial, no access or payroll changes | NOT_RUN |
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

## Cross-employer identity security reconciliation (synthetic)

The offboarding transaction revokes only the separated employer's memberships,
invalidates all existing sessions, and preserves a still-active account for a
different employer. An account with no surviving employer is disabled. Legacy
membership rows without workerEmployeeId are included in the revocation.
The attached disposable PostgreSQL test checks both employee membership scopes.
The global employeeId is cleared in the same transaction for a surviving
cross-employer login, preventing self-service routes from dereferencing the
separated employee after a fresh sign-in. Linking the surviving employer's
employee record requires separate HR/identity review. No external IdP/SSO/MDM access is claimed revoked.

## Default-off local application cutoff path (source candidate)

`OFFBOARDING_CLEARANCE_ENABLED` must stay OFF until independent acceptance.
When enabled on a disposable synthetic test environment, company-wide
owner/admin/HR reviewers other than the recorded final-pay preparer can use
the Separation page's **Revoke local access for this employer** control,
with current MFA and an 8-200 character evidence reference. The endpoint is
`PATCH /api/separation` with `{"id":<separationId>,"action":"revoke_local_access","localAccessEvidenceReference":"<private-evidence-id>"}`.
Only an eligible `draft` or `approved` separation at or after its Philippine
last-day calendar cutoff may proceed. The DB locks the separation and worker,
revokes the departed employer's local memberships and existing sessions,
preserves surviving other-employer identities, and records an audited scope
of **local application access only**. Neither the worker's payroll status nor
the final-pay package's approval/release state is advanced; no payout occurs.

This is **an explicit human-initiated control, not a scheduled cutoff**.
A missed HR/IT action still leaves an exposure after the effective last day;
the operational owner must demonstrate an independently monitored due-date
procedure, and independent QA must test original-session denial plus a fresh
login attempt using real assigned test roles. Automated eligibility and
disposable PostgreSQL tests do not prove timely real-world deprovisioning.
If unattended effective-date enforcement is required, design and accept
a separate independently reviewed worker/identity scheduler; do not tie the
access cutoff to payout or enable `FINAL_PAY_MANUAL_RELEASE_ENABLED` to solve it.

Neither a successful local cutoff, zero local membership counts, a cleared IT
checkbox, nor locally tracked `it_access_grants.state=revoked` proves that
SSO, IdP, MDM or external application sessions and grants are gone.
Obtain independently witnessed provider-side evidence and confirm no access
via those providers before live activation. The API response explicitly says
`externalProviderCallsMade=false`, `externalAccessVerified=false`, and
`finalPayReleased=false`. No production account may be used for this rehearsal.
