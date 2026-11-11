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

## Whole-method reconciliation remains gated

This fix does not silently promote Studio POST or rewrite historical receipts.
Draft, lifecycle, execution, resolution and language proofs must be rerun against
the changed engine. Approvals, enterprise, security-write, Spend/managed payroll
and document-caller receipts also seal this dependency and need fresh evidence;
their old source seals must not simply be relabeled. The manifest remains
unchanged until reconciliation. The added dependency-renewal workflow executes
the original guarded HTTP assertions to produce fresh evidence. Historical
receipt-verification tests remain mandatory in the existing workflows and the
regression suite; they are not removed or waived by the renewal workflow.

Local focused tests: 27 pass; TypeScript passes; lint has zero errors and ten
existing warnings. Repin reports 2,430 unchanged, zero repinned/review needed.
The full tenant run reports 1,698 tests: 1,653 pass, 36 fail, nine skipped. Eight
failures are existing Windows private-file permission cases; the remaining 28
are fail-closed historical-source/credit checks affected by the changed engine.
These are real unresolved failures, not a passing suite. They must be reconciled
from fresh executed receipts before this PR can become merge-ready. The six-method
review fails on the stale Spend engine seal for the same reason.

All providers, workers, schedulers, external models, final-pay review, exact
thirteenth centavos, payroll history and CSP remain OFF. No production SQL,
Neon, migration, real credentials, provider calls or live configuration changes.
