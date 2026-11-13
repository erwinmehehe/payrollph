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

The earlier proposed credit is withdrawn while this changed proof is rerun.
Xendit POST remains GAP until a new successful real-HTTP receipt seals these
corrected inputs. The original result remains historical, not current proof.
