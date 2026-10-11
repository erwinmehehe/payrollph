# Xendit default Philippine payroll disbursements — controlled release

**Status:** implemented on draft PR #813; source only. `PAYROLL_PAYOUT_PROVIDER` defaults to `xendit`, but **no live money movement is authorized by this change**. Keep `XENDIT_PAYOUTS_ENABLED=false` and `XENDIT_PAYOUTS_LIVE_APPROVED=false` until independent acceptance.

## Implemented

- Xendit V3 PHP salary payout API: `POST /v3/payouts` (one payout per employee), `GET /v3/payouts/{id}` and authenticated V3 payout webhooks.
- Dedicated MONEY-OUT key, nonshared legal-employer and organization allow-list, business-ID match, explicit payout authorization and no automatic switch to PayMongo.
- Frozen payroll input and employee account checks, exact-centavo totals, a keyed preflight fingerprint and cash-movement confirmation.
- The existing immutable payroll payout ledger now supports provider `xendit` with **the same one-run exclusivity** as PayMongo. `drizzle/0111_xendit_payout_provider.sql` updates database constraints; **no live database migration was performed**.
- Atomic one-at-a-time employee payout claims (up to three API calls per request). A timeout, network interruption or malformed provider acknowledgment marks the recipient's state as **reconciliation_required** and blocks further salary submission for the same run. Do not treat an HTTP error as a bank failure.
- Individual Xendit payout IDs recorded against the original payroll instructions. GET reconciliation is read-only at the provider; the authorized treasury operator can link an unrecognized payout only after providing an existing Xendit ID, which is re-verified against expected amount/reference/business ID.
- Webhook authentication via `x-callback-token`, business/organization/legal-entity scoping, database-deduped events and explicit `reversed` handling. Reversed payouts are **not** automatically retried.
- Workspace payout control center, employer payout-method selector, distinct old PayMongo path and optional bank-file fallback (blocked after any Xendit ledger claim to prevent duplicate salaries).
- Isolated API tests and synthetic database workflow tests (test suite execution / CI results must be checked on exact PR head).

## Lifecycle

```text
Released payroll
  -> Xendit no-money local preflight + fingerprint
  -> privileged treasury submit confirmation
  -> stage immutable payroll-run batch and per-employee transfer rows
  -> atomically claim single employee before API call
  -> send one POST /v3/payouts with a deterministic idempotency key
  -> durable provider acknowledgment (or RECONCILIATION REQUIRED)
  -> read-only GET /v3/payouts/{id} and authenticated webhooks
  -> succeeded | failed | reversed | uncertain
  -> close when every expected employee transfer settled and no reversals
```

## Rollout configuration

```text
PAYROLL_PAYOUT_PROVIDER=xendit
XENDIT_PAYOUTS_ENABLED=false
XENDIT_PAYOUTS_LIVE_APPROVED=false
XENDIT_PAYOUT_SECRET_KEY=(dedicated MONEY-OUT API key, not billing key)
XENDIT_PAYOUT_CALLBACK_TOKEN=(from Xendit payout webhook settings)
XENDIT_PAYOUT_BUSINESS_ID=(approved business)
XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID=(Linaw organization)
XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID=(exact Philippine legal employer)
XENDIT_PAYOUT_VERIFIED_BANK_BICS_JSON=(reviewed extra bank-to-SWIFT map, optional)
```

Set a public HTTPS Xendit payout webhook URL to `https://<your-app-host>/api/webhooks/xendit-payout` in Xendit's dashboard only in the independently authorized rollout. The callback token must never be client-side or in the GitHub repository.

**Separate billing:** `src/lib/xendit-subscriptions.ts` is for customer subscriptions; its credentials do not authorize employee payouts.

## Independent acceptance gates required before real payroll

1. Apply/rehearse database migration 0111 after the existing 0110 event inbox on isolated staging. Confirm strict provider constraint, per-run exclusivity and event dedup indexes under real PostgreSQL 16.
2. Verify current V3 payout payload and SWIFT/e-wallet routing codes in Xendit's **authorized sandbox**. Validate BDO, BPI, other bank and e-wallet destinations, name formats, amount caps and current published channel availability.
3. Independently authorize the legal employer, Xendit account, MONEY-OUT API scopes, funding source, fees, Payout Webhook token and finance approvals. Document whether Xendit's merchant account is permitted to make each employer's salary payments; no unapproved pooled/employer-crossing money movement.
4. Exercise at least two independent payroll cutoffs with synthetic or employer-authorized data. Validate 100% individual amounts, cutoff release, idempotency, unknown timeout, duplicate call, rejected, failed, reversed, out-of-order webhook, mid-run interruption and treasury maker-checker controls.
5. Require signed payment-provider acceptance, bank receipt evidence, reversal reconciliation, legal-employer approval and production security signoff. Deploy under flags OFF, then separately enable only for the approved employer.
6. Production verification: ensure never to reroute uncertain salary transfers to PayMongo or a bank file. Use Xendit dashboard/GET to resolve unknown outcomes manually; failed-only retries require an additional separately reviewed attempt workflow and are **not** automatically available here.

## Implementation references

- `src/lib/payroll-payout-provider.ts`
- `src/lib/xendit-payroll-payouts.ts`
- `src/lib/xendit-payout-ledger.ts`
- `src/lib/xendit-payroll-operations.ts`
- `src/app/api/payroll-runs/[id]/xendit-payout/route.ts`
- `src/app/api/webhooks/xendit-payout/route.ts`
- `src/components/workspace/xendit-payout-panel.tsx`
- `drizzle/0111_xendit_payout_provider.sql`
- `tests/xendit-payroll-payouts.test.ts`
- `tests/xendit-payroll-ledger-integration.test.ts`

Official Xendit contracts: https://docs.xendit.co/apidocs/create-payout-v3 ; https://docs.xendit.co/apidocs/get-payout-v3-by-id ; https://docs.xendit.co/apidocs/payout-v3-webhook .

**Verification:** check `npm run lint`, `npx tsc --noEmit`, `npm test`, source isolation, pilot QA, and all payroll golden suites from PR CI. No GitHub merge, deployment, real credentials, or real payouts were performed by the assistant.
