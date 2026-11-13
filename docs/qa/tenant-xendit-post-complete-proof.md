# Xendit payout POST: complete fictional tenant proof

The candidate targets all four operations of the currently unclaimed
`POST /api/payroll-runs/[id]/xendit-payout` method: preflight, submit, reconcile,
and resolve-unknown. No route or production authorization guard is changed.

## Execution boundary

The user approved `XENDIT_PAYOUTS_ENABLED=true` and
`XENDIT_PAYOUTS_LIVE_APPROVED=true` **only in the isolated synthetic CI profile**.
Those are technical test gate settings, not independent live acceptance.
All unrelated money/provider/history/CSP gates and workers remain OFF.

Seven filler employers, two attackers and a genuine higher-ID victim are
created in an empty disposable PG16 service before the servers start. Each
employer has its own explicitly allowlisted localhost server, assigned treasury
operator, separate real release-user evidence, frozen payroll payment trace,
and recent-MFA session. No secrets or real employer data are used.

The fetch preload accepts only one literal fake credential and exact Xendit
payout paths, and rewrites them to a real TCP server on 127.0.0.1:3013.
Any other destination, method, credential or redirect configuration fails.
There is no mock application HTTP, authorization, database, ledger or audit.

## Required proof

- Three legitimate employers each complete all four operations with populated
  own receipts and independently queried persisted payout rows.
- Both attacker employers address the real victim for every operation, compare
  its response with a missing run, and leave every protected employer/ledger/
  payroll/audit row unchanged. No denied request reaches even the fake provider.
- Forged body employer/run selectors cannot move an owned operation to the
  victim. Victim payout references and a genuine victim provider payout ID
  cannot settle an unresolved own instruction.
- An actual provider HTTP failure after accepting a fictional instruction
  persists an unknown outcome. Repeating submit must not POST again; read-only
  provider lookup must settle the same original transfer.
- Anonymous, wrong-role, missing-MFA, cross-site, release/submitter separation
  and revoked-membership requests fail closed.
- A fourth server keeps both payout gates OFF. It blocks preflight/submission
  while allowing historical Xendit reconciliation/recovery without any POST.
- Mutation/negative tests reject empty, foreign, duplicate or wrong-amount
  ledgers, false denials, changed source pins and modified victim audit rows.

## Accounting

No credit exists merely because this code or its unit tests exist. The full
PG16/real-HTTP job is required on reviewed source. Credit may be generated only
after inspecting all four operations, both attackers, victim positive,
forged-reference rejection, unchanged victim SQL and the exact executed inputs.
Unexecuted or failing pathways stay GAP. Evidence is
SOLO_VERIFIED_DEV_RECOVERY; independent security/treasury and production
acceptance remain pending. No real provider call, deployment or money movement.

## Executed evidence and proposed promotion

[The actual PG16 job](https://github.com/erwinmehehe/payrollph/actions/runs/43440091136/job/131935148448)
passed on `5c5294b9dc203550ac70f481e747a42685a23269`: twelve successful own
operations across employers 8, 9 and victim 10; 58 protected refusals; eight
missing-versus-foreign comparisons; three persisted uncertain-outcome recoveries;
seven synthetic provider POSTs and ten GETs. Repeated submit never resent an
instruction. Historical reconciliation/recovery passed with both payout flags
OFF, and no real provider was contacted.

The inspected result and all 70 executed local-module/build/workflow inputs are
sealed in `tenant-xendit-post-executed-receipt.json`. All remain byte-identical
after integrating main's separate default-OFF SSO change. The restricted writer
`node scripts/qa/tenant-xendit-post-credit.mjs --write` promotes only this POST;
`--check` verifies the sealed receipt, source bytes and exact method citations.
It refuses another job, altered receipt, missing operation, changed route or
borrowed GET proof. Mutation tests preserve those failures.

Proposed ledger: **457 COVERED / 6 GAP → 458 COVERED / 5 GAP** of 498 methods.
The four operations are one API method, never four credits. No route, deployment
setting or real-money authorization changes. Final-head CI remains a merge gate;
this PR stays draft pending review.
