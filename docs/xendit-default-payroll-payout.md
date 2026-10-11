# Xendit as default payroll payout provider — controlled integration

Status: **engineering candidate; not active for real-money payouts**. Default selection does not constitute a completed disbursement implementation or employer acceptance.

## Default and safety behavior

- `PAYROLL_PAYOUT_PROVIDER` defaults to `xendit`. Set it explicitly to `paymongo` only for an authorized legacy PayMongo workflow.
- When Xendit is selected, the existing `/api/payroll-runs/[id]/exports` PayMongo preflight and disbursement actions refuse to send money (501). This prevents unintended PayMongo transfers, including when old PayMongo credentials remain configured.
- Bank-file/manual payout paths retain their existing treasury, validation, and authorization gates.
- No migration, deployment, credential update, money movement, or transfer to an external account is performed by this change.

## Implemented source

- `src/lib/payroll-payout-provider.ts`: default provider, allow-list and live-gate declarations.
- `src/lib/xendit-payroll-payouts.ts`: V3 `POST /v3/payouts` and read-only `GET /v3/payouts/:id` transport with strict request/response identity, immutable references, centavo amounts, provider-specific key, webhook token comparison and event parsing.
- `tests/xendit-payroll-payouts.test.ts`: isolated request-building and identity tests; no real network transfers.
- The UI identifies Xendit as the selected default and does not expose the old PayMongo buttons while the new flow is incomplete.

## Required gates before enabling live payout (NOT YET IMPLEMENTED)

1. **Do not enable `XENDIT_PAYOUTS_ENABLED` for real employers yet.** Complete an employer-scoped, database-backed Xendit payout orchestration flow. The current PayMongo-ledger path has a PayMongo-only DB check constraint; do not repurpose it without a reviewed migration and atomic per-transfer claim model.
2. Replace one-shot API calls with durable per-recipient work items: exactly one frozen payout reference, amount, bank destination and persisted idempotency key per employee. Store the initiating legal employer, provider business ID, encrypted destination fingerprint and immutable payroll source hash. Enforce the global single-run provider claim, cross-provider duplication denial and no fallback after timeout.
3. Process V3 individual payouts with bounded concurrency and backpressure. **A timeout does not equal a failure.** Any request with unknown outcome must be looked up by reference/id before another submission; never automatically try a new idempotency key.
4. Implement an authenticated webhook inbox with durable deduplication, server-verifiable business/amount/reference mapping and official Xendit status transitions. On REVERSED or FAILED status after settlement, reopen investigation; do not silently mark a previously paid salary unpaid, automatically retry, or count returned money twice.
5. Add a reconciliation dashboard for 100% of payroll rows: pending/succeeded/failed/reversed/unknown. Pending and unknown money is not eligible for automatic retry. Require maker-checker authorization for failed-only retries, with new explicitly approved payout attempt records.
6. Validate verified Philippine destination bank/e-wallet mappings against Xendit's supported channel list, rather than relying only on local BIC examples. Validate name formats and any required bank-specific recipient information with sanctioned sandbox and real bank test accounts.
7. Obtain employer-specific Xendit onboarding, API scopes, funding arrangement, fees, contractual permission to disburse salary, and positive/negative/reversal UAT evidence. Record signed finance/security approval before any production activation.

## Configuration reserved for subsequent rollout

```text
PAYROLL_PAYOUT_PROVIDER=xendit
XENDIT_PAYOUTS_ENABLED=false
XENDIT_PAYOUTS_LIVE_APPROVED=false
XENDIT_PAYOUT_SECRET_KEY=(dedicated MONEY-OUT API key; not subscription billing key)
XENDIT_PAYOUT_CALLBACK_TOKEN=(do not log or expose)
XENDIT_PAYOUT_BUSINESS_ID=(actual approved business)
XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID=(approved Linaw organization)
XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID=(approved legal employer)
XENDIT_PAYOUT_VERIFIED_BANK_BICS_JSON=(reviewed bank-to-BIC map, optional)
```

Current Xendit billing is separate in `src/lib/xendit-subscriptions.ts` and must remain so. Do not use subscription billing credentials for payroll.

Source-of-truth API contracts: https://docs.xendit.co/apidocs/create-payout-v3 ; https://docs.xendit.co/apidocs/get-payout-v3-by-id ; https://docs.xendit.co/apidocs/payout-v3-webhook .

## Verification

Run `npx tsx --test tests/xendit-payroll-payouts.test.ts`, `npx tsc --noEmit`, `npm run lint` and the full payroll/treasury/tenant/golden suites on an isolated Postgres instance. This branch has not been runtime-tested against the target repository in a local checkout because external GitHub git clone was unavailable in this environment. CI checks must be reviewed on the exact PR commit.

No PR merge or real-money deployment is authorized until full payout orchestration, database migration, webhook handling, integration and reconciliation acceptance gates are completed.
