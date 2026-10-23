# Underpayment posting and payout authorization

The existing unique source constraint prevents a second correction for the same
employer, worker and source run. Drizzle wraps the PostgreSQL unique violation;
the route's old top-level SQLSTATE check misses it and throws. With default-off
`UNDERPAYMENT_DUPLICATE_CONFLICT_ENABLED=true`, only the exact wrapped constraint
becomes HTTP 409 `UNDERPAYMENT_SOURCE_ALREADY_REQUESTED`. Other errors retain
their existing handling. No financial formulas or database constraints change.

The separate `underpayment-posting.yml` workflow runs actual production-mode HTTP
and disposable PG16 with posting both OFF and ON. The duplicate-response flag is
ON in this fixture only. A pre-import guard requires explicit `isolated-posting`,
localhost port 3011 and the dedicated disposable database. Providers, credentials
and hosted targets remain forbidden; no production setting is changed.

Two independent synthetic attacker employers target a real high-ID victim.
The proof executes foreign employer/worker/source requests, foreign claim reviews,
duplicate-source submission, maker self-review denial, recent MFA, independent
approval and overlapping reviews. One review succeeds, one conflicts, exactly one
taxable earning persists, and subsequent approval/rejection retries cannot alter
it. Rejection remains executable while posting is OFF. Every denial compares
actual victim money/audit PostgreSQL state.

Xendit payout route GET/POST authorizes actual own/foreign runs and rejects an
employee submitter. New Xendit submission remains unavailable with PayMongo
selected and both providers disabled; repeated submits must create no payout
ledger. This is authorization and containment proof, not enabled provider-send
or settlement acceptance. Existing concurrent-submit tests use a synthetic
provider stub and PostgreSQL; no bank transfer is attempted.

Two underpayment POST/PATCH coverage links are provisional pending exact-head HTTP
CI and review. Aggregate 141 COVERED / 10 PUBLIC-BY-DESIGN / 342 GAP, plus 19
page/action gaps, remains NOT ACCEPTED. Frozen closure queues stay open.

Local direct-handler diagnostics use a fixture authentication adapter forbidden
in CI. They are not HTTP authentication evidence. No UI change; the existing
client displays the route's conflict error. Production activation remains separate.
