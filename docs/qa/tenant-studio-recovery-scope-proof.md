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
The sanitized receipt will be renewed if proof bytes change.

## Whole-method reconciliation remains gated

This fix does not silently promote Studio POST or rewrite historical receipts.
Draft, lifecycle, execution, resolution and language proofs must be rerun against
the changed engine. The approvals PATCH and enterprise POST receipts also seal
this transitive dependency and need fresh evidence; their old source seals must
not simply be relabeled. The manifest remains unchanged until reconciliation.

All providers, workers, schedulers, external models, final-pay review, exact
thirteenth centavos, payroll history and CSP remain OFF. No production SQL,
Neon, migration, real credentials, provider calls or live configuration changes.
