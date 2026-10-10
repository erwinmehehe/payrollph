# A-2 — Durable payroll payout ledger (staging implementation)

**Risk:** T3 financial integrity. **State:** draft; no production migration, network transfer, webhook integration, real payroll, or activation is included.

## What this changes

The current PayMongo integration uses batch-level HTTP idempotency and a wallet advisory lock, while reading prior transfers from audit-event JSON. Those do not supply a committed one-row-per-employee payment claim that protects against two workers and process crashes.

This candidate implements a PostgreSQL-backed, immutable payout **preparation and claim** layer:

- `payout_batches`: one provider request with one stable PayMongo idempotency key, a non-PII fingerprint, employee count, frozen total, and an irreversible submission claim.
- `payout_transfers`: exactly one logical employee payout per run, with immutable run, employee, payroll entry, amount and reference number. Unique run+employee, entry and reference indexes.
- `payout_batch_transfers`: records which employee payout attempts belong to each batch. This allows a future reviewer-authorized *new* failed-only retry batch while keeping one logical employee ledger record, without pretending that one PayMongo batch key can be unique per employee.
- `prepareInitialPayoutBatch` verifies Released status, organization, exact positive payable entry set, immutable employee references, centavo totals, and absence of prior legacy payout evidence. A `FOR UPDATE` run lock and constraints serialize preparation; inserts and a minimal audit receipt commit together.
- `claimPreparedPayoutBatch` atomically transitions a Prepared batch and its linked Prepared transfers to Submitting and returns one winner. **It makes no network call.** A crash after this DB commit blocks a blind retry.
- `markPayoutBatchForReconciliation` moves a claimed ambiguous outcome to `reconciliation_required`. Neither this state nor `succeeded` can be reset to `prepared` by the candidate code.
- `recordPayoutProviderBatchResponse` validates every accepted remote transfer ID/reference/amount against the frozen claimed batch. It stores the exact provider batch and transfer IDs atomically, but records status as **submitted**, never settled. Wrong counts, amounts or identities roll back, and a late response to an ambiguous outcome requires reconciliation rather than silently changing state.

The service does not store bank account numbers, government IDs, employee names or PayMongo raw responses. The hash does not substitute for validating the frozen recipient destination during final integration.

## Critical migration prerequisite

PR #745 proposes the A-1 provider-event inbox as numbered migration **0110**. The SQL in `docs/sql/pending-payout-ledger.sql` is intentionally **not numbered or auto-applied** while that PR is unmerged. Once #745 merges and the DBA confirms actual `drizzle/` state, reserve **0111** or the next contiguous number, compare the SQL against the Drizzle schema, and rehearse with a fresh database and a separately authorized encrypted staging clone.

The Drizzle table definitions are included so isolated GitHub Actions `db:push` can test unique constraints and transactions. **`db:push` does not install custom SQL triggers.** The pending SQL includes database-level immutable identity/amount triggers. A DBA must test them after applying the numbered migration; passing CI tests alone is not proof they exist in production.

## Integration before any live provider access (NOT included in this PR)

1. Reconcile historical payout batches, in-flight requests, manual completions and provider-confirmed settlements. Existing/ambiguous history must enter a blocked queue; it must **never** be silently staged as a fresh payout.
2. Extend the frozen released-payroll snapshot to include a verified employee ID, payroll entry ID, approved recipient destination and any approved destination changes; recompute from authoritative record inside the same transaction.
3. Preserve `withPayrollPayoutSubmissionLock` for wallet-level cross-run balance serialization. **In addition**, prepare and claim one durable payout batch, **COMMIT the claim**, and only then call PayMongo with the exact saved idempotency key. Never make network calls inside a DB transaction.
4. On a returned PayMongo batch response, persist the provider batch and each transfer ID with amount, expected employee, reference and tenant verification. A missing response, crash or ambiguous HTTP/network error must leave `submitting` or be moved to `reconciliation_required`; **never** reset to Prepared or auto-resubmit with a new key.
5. Add an A-1-verified webhook and provider-GET reconciliation adapter that updates only matching ledger records; forbid `succeeded -> failed` regressions without a separately modeled reversal.
6. Design an authorized failed-only retry path with a **new batch**, its own stable idempotency key and audited manual treasury approval. Prevent pending/succeeded employees from ever being resubmitted.
7. Add a rollout kill switch that keeps live disbursements OFF until the schema is deployed, historical data reconciled, independent approvers assigned, provider sandbox UAT completed and rollback rehearsed.
8. Provide a monitored reconciliation queue for any batch stuck in Submitting or Reconciliation Required.

## Tests & evidence

The synthetic CI test suite checks: exact cents and employee/reference identity, two-transfer single-batch idempotency, existing legacy payouts blocking backfill, concurrent database claim (exactly one winner), foreign-tenant no-access, unknown-outcome quarantine and malformed requests. No payments are sent by these tests.

**Before release:** DBA verifies unique indexes and immutability triggers in staging, runs two-worker simultaneous acceptance, simulates network loss at each step, records provider sandbox traces, validates webhook/reversal behavior, captures maker/checker and treasury approval, verifies exact Git SHA, and retains a signed rollback plan.

**Do not enable production PayMongo disbursements or apply this candidate migration from this PR.** A-2 remains open until the later payment-path integration and third-party evidence pass.
