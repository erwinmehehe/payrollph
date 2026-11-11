# Studio stored recovery scope

SOLO_VERIFIED_DEV_RECOVERY. This is fictional disposable PG16 / localhost
evidence, not production acceptance or an independent security review.

## Finding and fix

A real local HTTP diagnostic on the pre-fix source showed that an employer-owned
failed execution whose stored worker FK pointed to another employer could revoke
that worker's linked login session. This proves a failure to reject an inconsistent
stored association; it does not establish that a normal caller can create one.

Retry and replay now acquire the same transaction/advisory lock and validate the
stored execution, rule and optional worker against the requested employer before
any action. The execution row is update-locked; rule and worker rows are share-locked
throughout recovery, preventing reassignment after validation. A missing or foreign
binding raises an error before a replay, state change, audit or session effect.
Existing action allowlists, role/MFA, dead-letter and cross-employer guards remain.

The service's existing cross-pool action writes are not newly made atomic with
its execution-result transaction by this change. No broader atomicity is claimed.

## Real proof

`tenant-studio-recovery-scope-http.mjs` uses two authenticated attackers, seven
filler employers and a populated higher-ID victim. All four safe recovery actions
are exercised through both retry and replay. Target workers have real fictional
login sessions and memberships; effects are checked in PostgreSQL, not inferred
from HTTP status. Every refusal compares business rows, linked users/sessions and
prior audit rows for all ten employers. Forged references include a genuine victim
execution, foreign organization selector, and attacker-owned executions containing
foreign worker or rule FKs. Cross-employer oracle mutations must be rejected.

The first local fixed-source run passed 16 persisted own recoveries, 64 refusals,
16 oracle discriminations and one actual concurrent-transfer lock-timeout check.
Its executed source was `c4be91cc140ef3a6afd32da763a045e9644ba749`.
After adding an explicit mutation-failure diagnostic, a fresh database repeated
all checks at `ddd963fc95b4402b1a9b0d1686789bf78f240696`; its sanitized receipt is
`scripts/qa/tenant-studio-recovery-scope-local-receipt.json`.
An actual HTTP run with a deliberately no-op ownership oracle failed with
"write validator accepts another employer's data"; the original was restored.

The expanded local run at `22601e38253ecae564ad86161cb8bc865d1b4b63`
also proves acknowledge, resolve and reopen for all six authoritative case
families: coverage, timesheets, missing-timesheet expectations, attendance,
payroll readiness and statutory follow-up. Its additional 36 own transitions,
36 refusals and 36 oracle discriminations bring the run to **52 persisted own
transitions, 100 refusals and 52 oracle discriminations**, plus the transfer-lock
check. Authoritative source records remain unchanged. A synthetic pre-seeded
Released payroll row is only inert source evidence; no payroll release endpoint
or provider was called.

## Completed whole-method credit proposal

The reviewed credit writer now proposes **one** distinct method, Studio POST:
455 to 456 COVERED and 17 to 16 GAP. This is a draft-branch proposal, not a claim
that main already has the credit. All other method classifications, existing
receipts and page/action gaps are preserved.

The immutable complete-method receipt requires seven separate successful native
PG16 HTTP jobs covering all eleven action names. Acknowledgement, resolution and
reopening additionally cover all six authoritative source families. All 332
runtime, fixture and proof input blobs and each executed job recipe are checked
against current files; an unchanged route hash alone is insufficient.

| Evidence | Actual successful run/job |
|---|---|
| Case acknowledgement | 42937361287 /130250628988 |
| Manual drafts and templates | 42934565441 /130241307724 |
| Publish, activate, disable, rollback | 42934565504 /130241308894 |
| Quarantine and execution recovery | 42934565526 /130241308450 |
| Resolve/reopen and audit veto | 42934565626 /130241308708 |
| Keyless language proposals and signed saves | 42934565608 /130241309191 |
| Locked recovery and all six source families | 42937362387 /130250632298 |

`tenant-studio-dependency-renewal-receipt.json` separately preserves actual fresh
approval, enterprise, security-write, Spend/managed-payroll and document-caller
execution evidence. It validates 299 transitive inputs and ten successful jobs;
historical receipts are not rewritten or relabeled. The generic approval renewal
is actual HTTP job 130250631208 in run 42937361753, not its earlier failed
preflight. Existing historical-receipt tests remain mandatory in the original
workflows and regression suite.

`node scripts/qa/tenant-studio-post-credit.mjs --write` generates the method
receipt links, headline/counts and tracking documents. `--check` is read-only and
idempotent. Partial modes, borrowed jobs, altered sources, provider claims and
changed receipts fail closed. Generic table credit is not used for this promotion.

## Validation

The pre-promotion checkpoint had 28 source/credit failures in addition to eight
existing Windows private-file permission failures. Those 28 were not waived.
After complete-proof reconciliation, the full private PG16 tenant run had
1,747 tests: 1,730 passed, eight existing Windows permission failures and nine
skips. Focused credit/inventory/six-method tests passed; TypeScript and lint
passed (zero errors, ten existing warnings). Repin had 2,430 unchanged, six new
citations, zero repinned and zero needing review. Read-only generic reconciliation
proposed zero additional methods. Any final-head CI result must be checked
separately; these local results are not a green GitHub verdict.

All providers, workers, schedulers, external models, final-pay review, exact
thirteenth centavos, payroll history and CSP remain OFF. No production SQL,
Neon, migration, real credentials, provider calls or live configuration changes.


## Bounded historical-source compatibility (not a new method credit)

The changed engine source is the exact four-edit narrowing of the historically
sealed `src/lib/automation.ts`: original Git blob `288d27789e062803d68ea38fd41fa78ee155a1ee` and reviewed
new blob `ce2c8e8feee4554c85f7739b73f2fa0325b81306`. The verifier
`scripts/qa/tenant-studio-automation-source-compat.mjs` reverses *only* the
four approved edits and requires the byte-identical SHA-1 Git blob of the
original. It pins the new employer-row update/share-lock helper, the original
disposable PG16 recovery receipt, complete proof runner and contract; any
unreviewed source, receipt, lock or proof edit fails closed.

This compatibility check does **not** rewrite or replace the historical
approvals PATCH or enterprise POST HTTP receipts, their job identifiers, source
pins or existing provisional coverage status. The current-source fictional
PG16 checks remain mandatory. The following earlier-head runs passed:
[Studio recovery scope](https://github.com/erwinmehehe/payrollph/actions/runs/42937362387),
[enterprise action matrix](https://github.com/erwinmehehe/payrollph/actions/runs/42937362395),
[Spend/managed, document callers and approval task renewal](https://github.com/erwinmehehe/payrollph/actions/runs/42937361753).
The original complete approvals workflow had a preflight failure on the old
source hash, so its complete new-head reproof is still needed. Independent
security and method-acceptance review remains PENDING. This is **not** new
COVERED credit, production acceptance or deployment approval.

## Combined #1922 / #1924 renewal checkpoint

The reviewed engine now contains both stored-resource recovery locks and
employer-bound account/session side effects. The earlier seven-job cohort and
dependency receipts above are historical; they do not prove this combined
engine. The strict complete-method gate now requires eight fresh Studio jobs,
including the shared-account session-boundary proof, plus renewed transitive
dependency evidence. Until those actual HTTP runs and their source pins are
reconciled, the proposed Studio credit must not merge. No historical receipt
has been rewritten to pretend it executed new code.
