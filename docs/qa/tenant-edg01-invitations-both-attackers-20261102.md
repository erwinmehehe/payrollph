# EDG-01 invitations POST — two-owner forged-unit isolation proof

## Ownership and source

- Existing frozen batch **EDG-01**, exact method `POST /api/invitations`.
- Initially based on `main@9fb1ddd79a7517085097dae4d0e66e2552efc0f9`.
- The previous seven open PRs and new #1738, #1739, #1741 have no claim on this method.
- No application route changes, production email changes or new coverage credits.

## Exact independent-fixture real-HTTP evidence

The existing dedicated PostgreSQL 16 workflow and `scripts/qa/tenant-invitations-post-boundary.mjs` execute actual Next.js HTTP with a disposable localhost SMTP sink restricted to `example.invalid`. Test evidence already requires:

- Two **separately signed-in** fictional employer owners and a real higher-ID victim employer with populated invitation, employee, legal entity, org unit and membership rows.
- Legitimate 201 POST, persisted invitation token hash, a genuinely captured local SMTP one-use invite link, employer-bound sent outbox row and actor audit for both owners, plus valid owner-role and unit-admin branch positives.
- Foreign employer GET and POST refused with genuine 403; unrelated employer/victim SQL snapshots and audit, payroll, outbox and recipient state untouched.
- Forged real victim employee, user, legal-employer and invitation ID selectors cannot silently retarget the sender, and a forbidden duplicate causes no additional SMTP.
- Unit-admin scope, privileged-invitation denials, same-session revocation and anonymous rejection.

Previously only attacker A's independent active session submitted a real **victim org-unit ID** with its own employer POST and asserted an unchanged database/SMTP sink. This PR now runs that same actual 404 denial for both attacker owners. Each branch independently snapshots all three fictional employers and confirms no local SMTP delivery. The strict runner count must equal **two**. If B unexpectedly succeeds, all checks must fail.

Both the runner's fail-closed environment and workflow now require `NEXT_CSP_ENABLED=false`, without loosening existing provider, worker, scheduler, billing, payout or remote SMTP forbiddance.

## Review and credit status

**DRAFT / GAP / testedBy null / 0 new credits.** Old passes are not final-head proof. The 4-part own-positive, genuine victim-denial, unchanged victim PostgreSQL, and forged-selector proof must pass on the exact final head. If it fails, record the failed case and hold credit. Later separate manifest/ledger/source-hash/receipt/metrics reconciliation requires a fresh exact final-head run.

Repository owner `@erwinmehehe` is the **sole reviewer**; no independent reviewer exists. When completely verified, use `SOLO_VERIFIED_DEV_RECOVERY` rather than an independent-review claim.

No Neon/production SQL, real recipients, external SMTP, provider tokens, agency, payment, payout, worker or CSP activation, deployment or merge.
