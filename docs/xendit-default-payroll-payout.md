**Release-train update (2026-10-12):** The canonical *source-only* Xendit migration is `drizzle/0119_xendit_payout_provider.sql`, already included in `main` through the source train from #865. PR #813 adds no separate numbered payout migration. This does **not** establish that SQL was applied to Neon or that Xendit money-out was approved. Former 0112/0114/0115/0117 Xendit reservations are obsolete.

# Xendit default Philippine payroll disbursements — controlled release

**Status (2026-10-13):** source implementation on PR #813, ready for exact-head CI and source review. `PAYROLL_PAYOUT_PROVIDER` defaults to existing PayMongo while `XENDIT_PAYOUTS_ENABLED` is off; when explicitly enabled for an approved pilot, Xendit becomes the preferred provider for new batches. **No live money movement is authorized by a source merge**. Keep `XENDIT_PAYOUTS_ENABLED=false` and `XENDIT_PAYOUTS_LIVE_APPROVED=false` until provider and treasury acceptance.

## Implemented

- Xendit V3 PHP salary payout API: `POST /v3/payouts` (one payout per employee), `GET /v3/payouts/{id}` and authenticated V3 payout webhooks.
- Dedicated MONEY-OUT key, nonshared legal-employer and organization allow-list, business-ID match, explicit payout authorization and no automatic switch to PayMongo.
- Frozen payroll input and employee account checks, exact-centavo totals, a keyed preflight fingerprint and cash-movement confirmation.
- The existing immutable payroll payout ledger now supports provider `xendit` with **the same one-run exclusivity** as PayMongo. `drizzle/0119_xendit_payout_provider.sql` updates database constraints; **no live database migration was performed**.
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
PAYROLL_PAYOUT_PROVIDER=paymongo
XENDIT_PAYOUTS_ENABLED=false
XENDIT_PAYOUTS_LIVE_APPROVED=false
XENDIT_PAYOUT_SECRET_KEY=(dedicated MONEY-OUT API key, not billing key)
XENDIT_PAYOUT_CALLBACK_TOKEN=(from Xendit payout webhook settings)
XENDIT_PAYOUT_BUSINESS_ID=(approved business)
XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID=(Linaw organization)
XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID=(exact Philippine legal employer)
XENDIT_PAYOUT_VERIFIED_BANK_BICS_JSON=(reviewed extra bank-to-SWIFT map, optional)
```

Only after reviewed enablement, set `XENDIT_PAYOUTS_ENABLED=true` and `PAYROLL_PAYOUT_PROVIDER=xendit` for the exact authorized employer. The payout profile, PostgreSQL defaults and historical batches remain unchanged while OFF.

Set a public HTTPS Xendit payout webhook URL to `https://<your-app-host>/api/webhooks/xendit-payout` in Xendit's dashboard only in the independently authorized rollout. The callback token must never be client-side or in the GitHub repository.

**Separate billing:** `src/lib/xendit-subscriptions.ts` is for customer subscriptions; its credentials do not authorize employee payouts.

## Independent acceptance gates required before real payroll

1. Rehearse proposed `drizzle/0119_xendit_payout_provider.sql` on isolated PostgreSQL 16/18 against the canonical 0115–0118 dependency order and independently reviewed schema receipts. Confirm the provider constraint, one-run exclusivity and event deduplication. Do **not** apply it to Neon without separate DBA authorization, backup/rollback evidence and verified prerequisite migrations.
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
- `drizzle/0119_xendit_payout_provider.sql`
- `tests/xendit-payroll-payouts.test.ts`
- `tests/xendit-payroll-ledger-integration.test.ts`

Official Xendit contracts: https://docs.xendit.co/apidocs/create-payout-v3 ; https://docs.xendit.co/apidocs/get-payout-v3-by-id ; https://docs.xendit.co/apidocs/payout-v3-webhook .

**Verification:** check `npm run lint`, `npx tsc --noEmit`, `TZ=Asia/Manila npm test`, source isolation, pilot QA, and all payroll golden suites from the exact PR head. Source merge status is recorded on GitHub; it is not production activation evidence.

The October 13 regression suite executes the real React payout components and export route. With an absent or false server-delivered Xendit flag, the original PayMongo actions, copy and method options remain available and no Xendit status request is made. A previously stored Xendit method is shown as a disabled choice during rollback rather than silently rerouted. The export route authorizes employer/unit access and MFA before reading payout claims or provider readiness. Disposable PostgreSQL tests deny an unrelated employer before exposing its ledger metadata.

`node scripts/payout-ui-browser-qa.mjs` captures desktop and 390px disabled, loading, error, retry and empty-ledger states, and verifies HR cannot render the payout panel. This uses actual components with intercepted synthetic local API responses; it does not certify deployed authentication or provider settlement. CI uploads the screenshots as `payout-ui-components-desktop-390`. No production SQL, real credentials, environment activation or money movement was performed for these source fixes.


## Superseded migration-number history

Earlier draft branch reservations for Xendit at 0112, 0114, 0115 and 0117 are obsolete. The canonical source tree on `main` now has `0115_payout_profiles_foundation.sql`, `0116_payout_ledger_foundation.sql`, `0117_inline_first_payroll_journey.sql`, `0118_wfm_roster_scale_rules.sql`, and `0119_xendit_payout_provider.sql`. PR #813 introduces no independently numbered SQL file.

These filenames describe version-controlled **source**, not a proven production migration history. An independent DBA must reconcile applied SQL hashes, constraints, legal-employer ledger ownership and rollback evidence before authorizing any live schema change. Treasury and payer authorization remain separate from source integration.
