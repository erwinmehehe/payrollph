# #1154: payout positivity-check boundary acceptance

Source-only acceptance for five of group C's six raw catalog records. This
does not resolve the separate missing entity-transfer unique constraint or
the other 45 candidate-only objects. No production SQL or model changes.

| Table | Source model | Forward 0116 | Proposed disposition after successful exact-head PG16/18 |
| --- | --- | --- | --- |
| payout_batches | payout_batches_positive_total_check | payout_batches_transfer_count_check; payout_batches_total_amount_cents_check | Boundary-equivalent combined versus separate checks; preserve all raw names pending naming/DBA decision |
| payout_transfers | payout_transfers_positive_amount_check | payout_transfers_amount_cents_check | Boundary-equivalent amount checks; preserve raw naming difference pending naming/DBA decision |

The test executes the entire unchanged 0116 SQL in a previously empty,
explicitly named disposable database. Minimal fictional parent tables satisfy
the real forward FKs and tenant triggers. It materializes only the current
Drizzle model's relevant integer/bigint columns, NOT NULL attributes and check
expressions in a separate schema, using Drizzle runtime metadata. No hand-copied
model check predicate or source-grep assertion stands in for execution.

Each engine executes 42 paired cases (84 inserts): five transfer counts crossed
with seven amounts, plus seven transfer-only cases. Values include NULL, zero,
negative cents, integer/bigint bounds, and 9007199254740993 cents. Cents travel as
decimal strings and are read back as text; the test does not assert that the
application's JavaScript number mapping safely supports arbitrary bigint values.
Expected outcomes are independently asserted (23502 for NULL, 23514 for a
nonpositive value, exact retained cents for accepted values). Every insert is
rolled back to a savepoint. The real forward tenant trigger must reject a
cross-organization batch. Final rollback must restore the initially empty
catalog, and neither model nor forward payout rows may remain.

CI requires both PostgreSQL 16 and 18. A missing test URL is an explicit skip in
the general inventory; the dedicated jobs set ISSUE1154_PG_REQUIRED=true and
therefore fail closed if their service URL is missing. The evidence artifacts
retain all five distinct catalog definitions, exact source hashes and all
boundary witnesses. No diff normalization or allowlist suppresses these names.

Status is NOT_RUN until the exact PR head's two dedicated jobs pass. Passing
boundaries do not prove every possible expression equivalent, production schema
parity, authentic migration provenance, release approval, live provider behavior
or centavo reconciliation. #1136 stays a separate 54-name-only proposal.
#1154 remains open for all object dispositions and independent review. Production
target/role verification, #899/#907 recovery evidence and protected PLAN/APPLY
remain separate prerequisites. No flags, grants, numbered SQL or runtime behavior
are changed by this work; UI screenshots are not applicable.
