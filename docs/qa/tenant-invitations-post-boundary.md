# Workspace Invitations POST: real localhost SMTP and employer-isolation candidate

**Status: DRAFT / NOT ACCEPTED / zero method credits.** Authoritative manifest: `POST invitations` remains `GAP`.

## Executable scope

The PR's dedicated PostgreSQL 16 job runs a production-mode Next server at 127.0.0.1:3000 and a local-only SMTP capture listener at 127.0.0.1:2525. The execution guard refuses hosted or non-GitHub Actions targets, real mail-provider credentials, nonlocal SMTP, activated billing/payout workers and any preexisting employer or audit source. All employers, users, sessions and messages are fictional (`example.invalid`).

Three real employers are created in the disposable database. A and B are distinct authenticated attacker owners. The victim employer and invitation use genuinely higher persisted IDs, not assumed ID arithmetic.

- **Own GET control:** all three owners read exactly their own preseeded invitation and owner membership. Employer A's real result must fail B's own-data assertion.
- **Cross-employer denial:** A and B independently try real foreign GET and POST against the victim. The response must be HTTP 403 with no victim marker. A real foreign `orgUnitId` under A's employer must return HTTP 404. Each denial preserves all three employers' invitation, membership, people, pay profile, payroll, outbox and audit snapshots.
- **Own POST positive:** both attacker owners submit their own new invitation via authenticated POST. HTTP 201 must match a real, tenant-scoped inserted invitation, valid expiring token hash, selected org unit and actor.
- **Actual local SMTP delivery:** each owned POST must create exactly one **sent** invitation outbox row, produce exactly one captured localhost SMTP transaction to the correct fictional recipient, include a generated token that hashes to the saved invitation, redact that one-use token from durable outbox text and record exactly one actor-bound `Invitation created` audit. All denied and replayed requests must produce zero new SMTP transactions.
- **Replay and cross-tenant immutability:** duplicate POST must return HTTP 409 and not add invitations, outbox messages or audits. Every other employer's persisted source must remain unchanged after each legitimate attacker write, including the higher-ID victim.
- **Negative controls:** the pure unit suite rejects empty or swapped own reads, forged proof receipts, token mismatch, missing/incorrect audit, undelivered SMTP, remote/malformed SMTP configuration, provider secrets or active billing/payment switches.


## Additional four-part hardening on the new PR head

The prior dedicated runner was already green on a historical commit ([workflow run 40827849066](https://github.com/erwinmehehe/payrollph/actions/runs/40827849066)). The route, runner, unit suite and workflow source blobs remained unchanged on main before this PR. This PR extends that same real-HTTP runner, rather than counting an old proof against new test bytes.

- **Forged selectors on the positive path:** real higher-ID victim `employeeId`, `legalEntityId`, `userId`, `invitationId` and unrelated `payrollRunId` are supplied on the legitimate A/B own invitation POSTs. Their own 201, SQL token-hash, unit, outbox, audit and unchanged victim snapshot must still match the authenticated employer, demonstrating the selectors are ignored.
- **Privileged owner positive and distinct-role denial:** a real company-wide owner creates a successful `role=owner` invitation scoped only to its own employer and delivered through the fictional local SMTP sink. An unrelated company-wide `role=admin` principal, authenticated and MFA-verified in the same employer, must receive 403 when trying to invite an owner. No invite, account, audit or email may be created on that denial.
- **Email and identity side-effect invariance:** in addition to SQL snapshots for each employer, rejected foreign-employer POSTs, foreign-unit requests, eight unit-admin privilege denials, replayed invitations, and revoked-session POSTs must preserve the local SMTP capture count. Snapshots now include actual employer-linked user accounts, not only membership and invitation tables.
- **Anonymous real-victim denial:** an unsigned request to invite into a populated higher-ID victim employer must receive 401, contain no victim marker, modify no scoped SQL data, and send no email.
- **Strict proof environment:** require the fictional canonical app origin and privileged MFA setting, and reject alternate direct/pooled database URLs, Neon API key and Vercel environment markers in addition to existing provider/SMTP restrictions.
- **Exact fictional output boundary:** precisely four delivered local SMTP messages are expected (A owned employee, B owned employee, A owner-role, A unit-admin owned employee), while all rejections deliver zero.

These assertions do not prove paid SaaS enrollment, transactional provider delivery, or every nondefault product flag. `POST invitations` therefore **remains GAP with no additional coverage credit** until new-head CI and independent coverage-owner/security acceptance. This PR changes no production route, shared manifest, roster, payroll, migrations or provider configuration.

## Intentional boundaries

The SMTP receiver is a strictly localhost **test double**, not evidence of delivery to an external mailbox. No production SMTP, Resend, Postmark, real customers, payments, bank/payout system, actual subscriptions or deployed feature flags are used. The source API's billing/MFA gating, successful invitation **acceptance**, all possible invitation policy states, and real transactional delivery are **not fully certified** by this isolated suite. The private-pilot employer positive does not demonstrate the self-service paid-subscription branch.

The test uses the existing production invitation route unchanged. It does not edit migrations, shared coverage manifest, credit ledger, source route or other open PR-owned files. The result may remain **GAP** until independently reviewed method-specific proof meets all coverage policy requirements.

## Acceptance steps

Run on the **exact final PR head**:

```bash
node --check scripts/qa/tenant-invitations-post-boundary.mjs
node --test tests/tenant-invitations-post-boundary.test.mjs
```

The dedicated GitHub Actions job must also pass the real PostgreSQL 16 + Next HTTP + captured SMTP runner. Check CI, CodeQL, Security HTTP Smoke and independent privacy/security review before considering merge.

**Do not enable provider secrets, production mail, live employer datasets or automatic coverage credit. Keep PR draft until reviewed.**
