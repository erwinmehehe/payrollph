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

## Security correction and reproof

The original four-operation PG16 job passed, but CodeQL identified a check/read
race and file-to-network credential flow in its fixture handoff. The HTTP runner
now reads no fixture file. It verifies the exact ten-employer PG16 seed cohort,
loads persisted employer/run/worker identities directly from that database, and
creates its fictional sessions in memory. The seed writes only numeric allowlist
IDs, never session credentials. Application origins are four literal loopback
URLs. No alert is suppressed or dismissed.

The earlier proposed credit was withdrawn while this changed proof was rerun.
[The corrected PG16 job](https://github.com/erwinmehehe/payrollph/actions/runs/43445170899/job/131952613984)
passed on `5fcff5d201fbfe510842c2b755cdac7f764ca30a`: twelve successful own
operations, 58 protected refusals, eight missing/foreign comparisons, three
persisted unknown-outcome recoveries, seven synthetic POSTs and ten GETs.
Every operation retained both attacker employers and the genuine victim positive.
There were zero real provider calls. All 71 executed local-module, build and
workflow inputs are sealed in `tenant-xendit-post-executed-receipt.json`.

The restricted `tenant-xendit-post-credit.mjs --write` command now proposes
exactly one source-current method: **457 COVERED / 6 GAP → 458 COVERED / 5 GAP**.
Its `--check` verifier rejects altered execution, source drift, missing modes,
borrowed GET proof or false independent acceptance. Final-head CI and CodeQL
must pass before merge. The original file-handoff result is historical only.
