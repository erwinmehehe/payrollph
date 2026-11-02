# Tenant-isolation proof design: provider webhook routes

Status: **design only, no code and no coverage credit.** Source read at origin/main `1c94f2003`.

## Why these routes are different

The manifest's COVERED rule assumes a signed-in employer who can name a foreign object. Webhook routes have **no session, no employer selector and no caller-chosen organization**. Authentication is a provider secret, so an "attacker employer" is not a caller. The real threat is narrower and still serious: **a validly authenticated provider event that names or implies another tenant's object must not read, write or acknowledge that object.** The current rule has a route-specific alternative only for session-derived own-employee endpoints, so these routes need an explicit, owner-approved alternative before any credit is written (see Decision 1).

## Route inventory (all `POST`, all currently GAP)

| Route | Auth | How the tenant is bound today | Risk |
| --- | --- | --- | --- |
| `webhooks/xendit-payout` | `x-callback-token`, constant-time check | Organization and legal entity are **pinned by env** (`XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID` / `_LEGAL_ENTITY_ID`); run looked up with both, must be `Released`; reference `PAY-<runId>-…` parsed from the event | Money path. Strongest binding of the five. |
| `webhooks/paymongo/transfers` | HMAC signature | Run looked up by `payload.runId` with **no organization filter**; tenant then taken from the run, and the event is accepted only if transfer id, reference number and amount match that organization's own payout audit receipts | Money path. The only tenant check is the receipt match. |
| `webhooks/xendit/subscriptions` | `x-callback-token` + `business_id` | `reference_id` + `plan_id` must match a `saas_billing_checkouts` row; amount/currency checked; stale plan ignored | Billing state, invoices. |
| `webhooks/resend` | Svix signature | `outbox_id` from the event; `recordEmailProviderEvent` looks the outbox row up **by id alone**; dedupe scans the latest 500 `Email provider delivery event` audit rows globally | Delivery status, not money. |
| `webhooks/drain` | worker token only | Global, employer-spanning by design | Already a zero-credit `global-worker-token-only` hold; not a tenant proof target. |

## Observations to confirm by test, not assumptions

1. **PayMongo run lookup is global.** Containment depends entirely on the receipt match. The proof must show a signed event carrying run A's id with run B's transfer id and reference (and the reverse) is ignored with no write to either tenant.
2. **Resend dedupe is a 500-row global window.** A replay older than the window may be applied again. This is an idempotency question, not a tenant leak, but the proof must record the behavior rather than hide it. If confirmed, it is a separate fix PR.
3. **Resend resolves outbox rows without an organization.** The row must match the event's provider, and its stored provider message id must equal the event's, but the message id is only compared when the row already has one. For a row with no stored id, a signed event naming that outbox id is accepted. The proof should show what a signed event naming another tenant's outbox id does in both cases, and decide whether that is acceptable for a platform-level provider account.
4. **Xendit payout is single-tenant by configuration.** Isolation is the env pin, so the proof is about the pin: a valid-token event for another tenant's run is refused and leaves the other tenant's SQL unchanged.

## Proof shape (per route)

Same evidence labels as the rest of the manifest, adapted:

- **Own:** a correctly authenticated event for a real, seeded own object returns the documented 2xx and writes exactly the expected rows (provider event, audit, state) for the owning organization.
- **Foreign:** a correctly authenticated event that references a real victim object (victim id greater than both attacker-owned ids, read back from PostgreSQL) returns the documented refusal or ignore response, with a full before/after snapshot of the victim's tables unchanged.
- **Forged selector:** body fields such as `organizationId`, `employeeId` or `runId` that disagree with the authenticated binding are ignored or refused.
- **Authentication negatives** (wrong or missing token or signature, oversize body, bad JSON) must write nothing. These never count as tenant credit on their own.
- **Replay and race:** duplicate delivery and two concurrent deliveries produce one write.

## Harness approach

- Does **not** use the hash-bound row-table runner, which assumes a session cookie. Use a dedicated script per route family, in the style of `tenant-wrk02-batch2-http.mjs`, with its own workflow job.
- Signs requests in the harness with synthetic secrets that exist only in the CI job environment. The payload helpers (PayMongo HMAC, Svix, callback tokens) should be imported from the same library the route uses so a signing change cannot silently pass.
- Real PostgreSQL 16, real Next server, fictional data only. `XENDIT_PAYOUTS_ENABLED` and `PAYMONGO_DISBURSEMENTS_ENABLED` stay unset; **no provider HTTP is ever made**. Webhooks are inbound only.
- Reuse the fixtures in `tests/xendit-webhook-overlap-postgres.test.ts` and `tests/paymongo-provider-event-idempotency.test.ts` rather than inventing a second payout seed.

## Proposed order

1. **`webhooks/xendit-payout`**: smallest, money path, binding is explicit.
2. **`webhooks/paymongo/transfers`**: highest risk because the lookup is global; may produce a hardening PR before any credit.
3. **`webhooks/xendit/subscriptions`**: needs checkout and plan fixtures; includes amount/currency mismatch and stale plan cases.
4. **`webhooks/resend`**: after Decision 3.
5. `webhooks/drain` stays a worker-token hold unless the owner asks for a worker-token proof.

Each step is one draft PR from fresh main, with the two-phase promotion (proof first, credit second citing the exact-head run) used for the WRK-02 batches.

## Decisions needed from the owner

1. **Credit rule for signature-authenticated callbacks.** Either extend the manifest's route-specific alternative to "authenticated provider event for own object accepted, authenticated event naming a real victim object refused with unchanged victim SQL", or keep these routes GAP permanently. I recommend the extension, written into the manifest criteria in its own PR first so the rule is reviewed separately from any credit.
2. **PayMongo global lookup.** If the proof shows the receipt match is the only containment, should the route also require the run's organization to be bound by a configured allow-list (as Xendit payout does), or is the receipt match accepted as the control?
3. **Resend scope.** Whether delivery-status updates keyed by provider message id are acceptable as platform-level, or must be organization-bound.
4. **Subscriptions.** Whether the proof may run with `XENDIT_BILLING_ENABLED=true` against synthetic secrets in CI only.

## Not changed by this document

No route, harness, manifest status, workflow or SQL. No credit. Independent security review remains pending for every route above.
