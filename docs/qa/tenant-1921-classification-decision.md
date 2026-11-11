# #1921 classification decision — proposal, not approval

Status: **OWNER DECISION PENDING**. Prepared from the route sources on main
`3cf1581f6988445b92c25eee9c3697014a852f2f`, integrated into #1921.
No route or feature flag is changed by this proposal.

The decision is whether these nine methods belong in the proposed inventory
categories. It grants **zero tenant-private COVERED credits** and does not
approve deployment, working SAML, public signup activation, scheduled execution,
email delivery, provider calls or production security.

## What the labels mean

For the eight proposed PUBLIC-BY-DESIGN entries, “public” describes the
pre-login interface. It does **not** mean callers may read stored employer data
or bypass a setup secret, email token, origin check or rate limit. In particular,
setup POST is a privileged first-run bootstrap and signup/verify is a
possession-of-token operation, despite neither requiring an existing employer
session.

HCM escalation is different: it is deliberately a cross-employer operation
authorized by a dedicated global scheduler credential. It is never public and
never earns a tenant-session method credit.

## Exact owner decisions

All nine decisions below remain unchecked.

| Decision | Method and proposed category | Disclosed fields / private writes | Boundary and explicit limits |
|---|---|---|---|
| C01 | GET setup → PUBLIC-BY-DESIGN | Returns only `needsSetup` and `setupProtected`; global user-count query. | Owner accepts disclosure of whether first-run setup is available. No employer ID, user list or private record is returned. |
| C02 | POST setup → PUBLIC-BY-DESIGN (pre-login bootstrap) | Accepts company/legal name, owner name/email/password and setup credential. Creates a new organization, hashed-password owner, owner membership, session and audit; returns new organization ID and the created user's ID/email/name/role, a next-step message and session cookie. | Production requires private `SETUP_TOKEN`. The zero-user condition is rechecked under a transaction advisory lock. Header-authenticated bootstrap can omit Origin only after that secret passes; browser/body-token requests retain the origin check. Completed instances refuse a second setup. No existing employer is selectable. This label must not be read as unauthenticated bootstrap permission. |
| C03 | POST intake-challenge → PUBLIC-BY-DESIGN | Accepts an email. Enabled response contains `enabled`, signed `token`, `difficulty` and `expires`; disabled response contains `enabled:false`. Rate-limit security state is persisted. | Same-origin and distributed IP/email-hash limits; fails unavailable when distributed limiting is absent. Token contains an email digest, expiry and random salt, not an employer record. Registration separately verifies/consumes the proof. Accept the bounded challenge interface, not public access to its rate-limit state. |
| C04 | POST signup → PUBLIC-BY-DESIGN | Accepts registration identity/company, password, terms and configured plan/seats/proof/invite inputs. Creates only the new employer's organization, owner, membership, subscription/verification, mail outbox and audit state. Responses contain status/messages, delivery indication or a configured pilot redirect. | Same-origin, registration mode, validation and abuse gates remain. Executed evidence is pilot-mode with intake proof enabled and loopback mail only. Paid enrollment and invitation-bypass branches are not accepted by that evidence. New/existing registration answers differ and unverified registration can squat an address: these findings remain open. |
| C05 | POST signup/resend → PUBLIC-BY-DESIGN | Accepts email; rotates the stored pending owner's hashed verification token/expiry and queues mail to that stored address. Returns a generic acknowledgement (or configuration/rate-limit error). | Stored pending account supplies the organization/user. Request-supplied employer IDs grant no authority. Mailbox/IP limits, inactive/unverified-account predicates and canonical-origin validation remain. No real SMTP acceptance or concurrent-resend guarantee is claimed. |
| C06 | POST signup/verify → PUBLIC-BY-DESIGN (token activation) | Accepts a verification token. Atomically consumes its unexpired stored hash, activates its associated owner, sets pilot dates where applicable, creates that owner's session and audit; returns `ok` and a destination. | Same-origin and rate limiting remain. Stored token supplies user/organization, not forged request selectors. Proof includes two real applicants, invalid/old/replayed tokens and unchanged victim state. Public ingress is not public access to another account's token, session or employer. |
| C07 | GET auth/saml/start/[providerId] → PUBLIC-BY-DESIGN | Uniform JSON `error`/`code`, HTTP 503, no-store/nosniff. | No provider lookup or tenant data access, regardless of provider ID. This accepts only the permanently disabled refusal interface, not working SAML. |
| C08 | POST auth/saml/acs/[providerId] → PUBLIC-BY-DESIGN | Same uniform disabled 503 response. | No assertion acceptance, provider lookup, account activation or session creation. SAML metadata GET remains a separate GAP; its provider-existence disclosure is not approved here. |
| C09 | POST hcm/work-items/escalate → PRIVILEGED-OPERATIONS-TOKEN-ONLY | Dedicated scheduler can update due operational cases, write scoped work-item events and queue notices to active company-wide staff of each stored case organization. Response contains `escalated` and `remainingMayExist`; notices contain the work-item number, no payroll details. | `HCM_SLA_CRON_SECRET` bearer authorization precedes DB connection. Global cross-employer processing is intentional service authority, not a signed-in employer permission. Existing scheduler proof checks genuine work, forbidden sessions/tokens, idempotency and unchanged forbidden SQL. This decision does not authorize running a live scheduler. |

- [ ] C01 approved
- [ ] C02 approved
- [ ] C03 approved
- [ ] C04 approved
- [ ] C05 approved
- [ ] C06 approved
- [ ] C07 approved
- [ ] C08 approved
- [ ] C09 approved

## Executed evidence and what was not rerun here

The six pre-login handlers, proof runner and workflow are pinned to the
[merged #1898 fictional PG16 HTTP job](https://github.com/erwinmehehe/payrollph/actions/runs/42777964271/job/129700836113).
That proof records one first-run setup, two registrations, two activations and
one resend, with forged selectors ignored, recipient-bound loopback mail and
unchanged existing employers. It explicitly reports account squatting and
registration enumeration as unclosed findings.

The disabled SAML boundary and tests come from merged #1896. The HCM scheduler
has its dedicated local-HTTP/PG16 proof and credential-first source guard.
No new PG16 HTTP, paid enrollment, live mail, IdP, scheduler or production
execution is claimed by preparing this decision record.

Classification guards now validate the named methods' source/evidence even
when their label already exists. Negative controls reject an extra relabel,
invented coverage, stale or fabricated proof references, fabricated approval,
wrong worker credentials and altered certification claims.

## Review sources

- [Original owner-decision requirement](tenant-nonsession-triage.md#owner-decision-record)
- [Setup](../../src/app/api/setup/route.ts)
- [Intake challenge](../../src/app/api/intake-challenge/route.ts)
- [Signup](../../src/app/api/signup/route.ts),
  [resend](../../src/app/api/signup/resend/route.ts),
  [verification](../../src/app/api/signup/verify/route.ts)
- [Disabled SAML response](../../src/lib/saml-disabled-boundary.ts)
- [Scheduler authorization and writes](../../src/app/api/hcm/work-items/escalate/route.ts)

Approval may cover all nine or an explicit subset. Unapproved labels must stay
GAP on main. Until a decision is recorded, #1921 remains a draft regardless of
green CI. Runtime guards, unresolved findings and separate production gates
remain in force after any inventory decision.

