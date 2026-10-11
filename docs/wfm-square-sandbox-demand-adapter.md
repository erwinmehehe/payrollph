# WFM Square SANDBOX completed-payment demand adapter

**Engineering pilot only; default OFF; one fictional merchant/location; no live seller, money movement, staff assignments or payroll modifications.**

This is the next isolated implementation of issue #838. It follows the already-merged operational-demand import / issued forecasting foundation in #828 and runs independently of open PRs #837 (planner), #843 (approved policies) and #813 (Xendit payout).

## Philippine market limitation

Square's own [International Development guidance](https://developer.squareup.com/docs/international-development) states that card-processing seller accounts and Square Sandbox are supported only in its listed regions, **not the Philippines**. Developers in the Philippines may build integration code, but a Philippine employer must not treat this sandbox adapter as a live domestic POS integration or attempt unsupported cross-border seller processing.

This sandbox-only connector is a **contract / aggregation engineering pilot**. For an actual Philippine business source, choose a provider with legal PH merchant support and consented APIs (or an explicitly validated authenticated export), and implement its own authorization, correction semantics and source mapping before any live pilot. The rest of WFM stays read-only.

## Provider semantics — verified against Square documentation

Square Payments [List payments](https://developer.squareup.com/reference/square/payments-api/list-payments) is `GET /v2/payments`, using merchant-authorized `PAYMENTS_READ` scope. Version **2026-09-16** is pinned. It supports `begin_time`, `end_time`, `location_id`, `limit` (maximum 100) and opaque `cursor`; response is eventually consistent. Our metric is **completed Square payment objects by `payment.created_at` at the configured Square sandbox location**. This is **not** orders, visitors, net sales, refunds, shift demand, or a guaranteed POS-only count: Square Payments may include activity from other channels. Do not use this signal as a staffing need without an approved productivity policy.

Always use the fixed `https://connect.squareupsandbox.com/v2/payments` hostname. This feature cannot target Square production or a caller-supplied URL.

Square warns that payments and updates are eventually consistent, with delayed offline activity. Re-scan historic days to capture late status changes. A scan is eligible only once its Philippine-local day has ended **at least seven full days earlier**. Even then, `quality:"complete"` means *the bounded, point-in-time provider page scan completed with no missing pages*, **not** Square-certified permanent completeness. A later corrected scan appends revised counts; frozen issued forecasts/scores are never rewritten.

## Least privilege / connecting the fictional merchant

The feature requires an environment provisioned by a consenting sandbox app owner. Do **not** enter a real seller's production token. No provider credential, OAuth token, customer/payment ID, amount, card number, order ID, raw provider JSON or team member data should be committed, logged, stored in aggregate tables, or returned to browsers. A real OAuth merchant-connection flow and credential rotation/revocation remains a separate prerequisite for a live pilot.

All flags default OFF. Configure in an isolated test environment:

```text
WFM_OPERATIONAL_DEMAND_ENABLED=true
WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS=<fictional-employer-ID>
WFM_SQUARE_SANDBOX_ENABLED=true
WFM_SQUARE_SANDBOX_ALLOWED_ORGANIZATION_IDS=<same-fictional-employer-ID>
WFM_SQUARE_SANDBOX_ORGANIZATION_ID=<same-fictional-employer-ID>
WFM_SQUARE_SANDBOX_WORKSITE_ID=<fictional-ph-worksite-ID>
WFM_SQUARE_SANDBOX_LOCATION_ID=<approved-Square-sandbox-location-ID>
WFM_SQUARE_SANDBOX_CONSENT_ACKNOWLEDGED=true
WFM_SQUARE_SANDBOX_ACCESS_TOKEN=<server-only-sandbox-token-from-secret-manager>
NEXT_PUBLIC_WFM_OPERATIONAL_DEMAND_ENABLED=true
NEXT_PUBLIC_WFM_SQUARE_SANDBOX_ENABLED=true
```

Never place `WFM_SQUARE_SANDBOX_ACCESS_TOKEN` in a `NEXT_PUBLIC_` variable. The token is read only by the server and is never accepted from a client request or stored in GitHub.

Only a signed-in company-wide People admin with authorization to the exact active `Asia/Manila` worksite, same-origin mutation, strong privileged MFA where configured and distributed rate limiting can initiate manual source reads/imports. A manager may only read aggregate freshness for the same authorized employer/site. The API is not enabled for demo user mutations.

## Operator journey

Under **Workforce → Coverage → Square completed-payment activity**, an authorized company People admin selects one historical Philippine date and a 15/30/60 minute interval, then acknowledges sandbox consent and source limitations.

1. **Preview aggregates** invokes `POST /api/workforce/demand-observations/square-sandbox` with `dryRun:true`, which fetches at most ten pages of 100 payment objects each and calculates 24–96 PH-local interval counts in memory. It writes **no aggregate rows**. Malformed pagination, cursor loops, unsupported status, wrong location, non-2xx provider response, timeout or limits produce an error and zero imported rows.
2. **Import changed counts** with `dryRun:false` re-fetches, compares the returned complete-day scan against the latest scoped aggregate revisions and appends only count/quality differences through the existing employer transaction lock, idempotency SHA and immutable audit. Zero-count intervals are recorded only after the full seven-day-aged scan succeeds. Same counts never create extra revisions.
3. **Refresh source freshness** calls the scoped, cached-disabled `GET` endpoint. It shows the last stored aggregate import and last **locally observed** successful provider scan. This is explicitly `source_reported_scan_only`, never independently provider-certified freshness. An unchanged scan may advance a local check receipt without fabricating new observed data.
4. A manager can subsequently view the imported `sourceKey=square_sandbox_payments` and `metricKind=transactions` through the existing aggregate-demand forecast/scoring flow, provided those separately approved demand features are enabled. There is no new forecast training method in this PR.

Request contract:

```json
{"organizationId":1,"worksiteId":2,"workDate":"2026-09-20","intervalMinutes":30,"dryRun":true,"acknowledged":true}
```

Numbers above are fictional examples. Real organization IDs, secrets and source data never belong in PR comments.

## Operational and privacy boundaries

Only aggregate bin counts and existing source revision metadata reach PostgreSQL, and only after an explicit authorized import. Provider IDs are used transiently **inside the bounded function** to deduplicate pagination and are not returned/persisted. Upstream errors are mapped to sanitized statuses; raw provider payloads and headers never appear in app logs or audit rows.

All intervals use a strict half-open Philippine-local window, with exact `+08:00` time alignment; no source minute rounding is exposed to clients. A full-day scan is capped at 1,000 ephemeral records over ten pages. Larger source days fail closed (do not truncate or silently report zero). For high-volume merchants, a later independently tested chunked-pull design is required.

This candidate deliberately lacks independently attested merchant OAuth, credential refresh, multi-location mapping, scheduled sync/backfill, external provider reconciliation and real-device operator UAT. Those remain unexecuted issue #838 acceptance requirements. It is **not** a production POS connection or automatic workforce optimization.

## CI and release gates

Synthetic tests (no Square credentials) cover pagination, deduplication, location boundaries, PH intervals, corrected revisions, retries, status errors, malformed responses, point-in-time zero semantics and payload redaction; a synthetic Chromium 375px harness checks worksite/tenant isolation, preview, explicit import and freshness without calls to schedule or payroll endpoints. The new workflow executes lint, TypeScript, focused tests, source gate, production build and mobile browser QA.

To run in an isolated checkout:
```bash
npx tsx --test tests/workforce-square-sandbox.test.ts
node scripts/wfm-square-sandbox-browser.mjs
```

Second command requires Playwright Chromium installation. No source secret or live Square account is necessary for either synthetic test.

**Pilot release decision: NO-GO** until exact-head CI passes; security/merchant-ownership review, OAuth/revocation and provider aggregate reconciliation are independently approved; actual staging source is tested with owner consent; #691 WFM UAT and #579 no-money shadow payroll remain separately verified. Xendit payout #813 remains independent and disabled.
