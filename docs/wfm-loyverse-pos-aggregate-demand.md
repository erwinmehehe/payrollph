# Linaw WFM — Loyverse POS aggregate demand (Philippine-market candidate)

**Draft engineering candidate; all flags OFF by default; no live merchant connected.** This read-only source integration is independent of unmerged WFM staffing planner #837, policy approval #843, non-Philippine Square sandbox prototype #847, and payout draft #813. It uses the already merged WFM demand import / issuance tables from #828, so adds **no migration** or payroll-specific write.

## Provider and metric

Authoritative API: [Loyverse API v1.0](https://developer.loyverse.com/docs/); endpoint **GET /v1.0/receipts** with server-bound `store_id`, `source=point of sale`, `created_at_min`, `created_at_max`, `limit=250`, `cursor`. Store binding is independently checked through **GET /v1.0/stores?store_ids=...**, including `country=PH/Philippines`. Only `receipt_type=SALE` and noncancelled receipts with source `point of sale` are counted; `REFUND` receipts are not counted and do not retroactively erase the physical effort of an earlier sale. This is **gross POS sale-receipt count**, not fiscal tax receipts, net revenue, cash/card transactions, item count, unique customers, number of orders, or a validated staffing target.

The business event time is **receipt_date** in the store's Philippines timezone, rather than when the external API received the record. Loyverse notes that `receipt_date` can be earlier than `created_at`, and POS devices may sync historical receipts late. Therefore a day is eligible only when the day has closed and **seven additional days** have elapsed; we query receipt `created_at` from its start through seven days after its end, and bucket matching `receipt_date` into exact 15/30/60-minute PH intervals. Late sync **after** seven days is still possible; local `quality=complete` means a full bounded provider scan was successfully read, not permanent provider certification. Re-scan old dates to append corrected interval revisions, never rewrite issued forecasts or scores.

Source name: `loyverse_pos_sales`; metric: `transactions` for *gross POS SALE receipts*. No customer, line item, notes, receipt number, worker identity, financial amount, provider response, Authorization header or OAuth token is persisted or transmitted to client. Receipt numbers are transient in-memory deduplication keys and discarded at request completion.

## Authorization: human-consented token provision, not self-service OAuth

Official Loyverse [access-token help](https://help.loyverse.com/help/loyverse-api) explains that personal API tokens may have unrestricted access. **Do not use such personal all-resource tokens for the real employer pilot.** The proper multi-merchant path is a developer-registered OAuth 2.0 grant explicitly limited to `RECEIPTS_READ` and `STORES_READ`; the current source requires a separate qualified operator to obtain and rotate that grant in a secrets manager before enabling the app. The API only verifies the *configured grant declaration* and authorized store returned by the provider; it does **not** implement the OAuth exchange, refresh, introspection, revocation or app registration itself. Never claim otherwise.

An authorized merchant must opt in, validate the legal entity, store mapping, API agreement, access grants, billing/permissions and retention expectations, and independently approve the source. No actual merchant has been connected or reviewed in this PR. BIR/POS fiscal accreditation and employer-specific reporting requirements must be confirmed independently; **Loyverse API support is not BIR clearance**.

Exact, server-only opt-in example for isolated test environment (tokens are never committed):

```text
WFM_OPERATIONAL_DEMAND_ENABLED=true
WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS=<synthetic-or-reviewed-org-id>
WFM_LOYVERSE_POS_ENABLED=true
WFM_LOYVERSE_POS_ALLOWED_ORGANIZATION_IDS=<same-org-id>
WFM_LOYVERSE_POS_ORGANIZATION_ID=<same-org-id>
WFM_LOYVERSE_POS_WORKSITE_ID=<reviewed-PH-worksite-id>
WFM_LOYVERSE_STORE_ID=<merchant-approved-PH-store-UUID>
WFM_LOYVERSE_MERCHANT_CONSENT_RECORDED=true
WFM_LOYVERSE_AUTH_MODE=oauth_receipts_read
WFM_LOYVERSE_GRANTED_SCOPES=RECEIPTS_READ STORES_READ
WFM_LOYVERSE_ACCESS_TOKEN=<server-secret-manager-OAuth-grant>
NEXT_PUBLIC_WFM_OPERATIONAL_DEMAND_ENABLED=true
NEXT_PUBLIC_WFM_LOYVERSE_POS_ENABLED=true
```

The tenant, worksite and store IDs are explicitly pinned; arbitrary browser IDs/URLs cannot change the source. Company-wide People admin with CSRF/origin, privilege MFA in protected production, rate limits, live membership, and PH worksite checks is required to run the import. Branch-only managers can read scoped source freshness but cannot import or create credentials. Every non-preview attempt and status is append-only audited with sanitized provider state; no raw API payloads or PII are logged. A credential failure or missing store permission returns source review, not a zero-demand day.

## Manager and operator journey

In **Workforce → Coverage → Loyverse POS receipt demand**, choose a worksite, historical date (at least seven days past its end), and a 15/30/60-minute interval.

- **Preview without import** retrieves a complete, bounded provider page scan in memory and shows the number of receipts plus prospective bin revisions. It writes no imported counts.
- **Import changed counts** repeats the source scan, checks existing scoped version history, and writes only changed interval counts via existing `writeOperationalDemandImport` transactional idempotency/audit. The first complete day can establish authoritative *source-reported* zero bins, but partial/missing pages cannot.
- **Refresh source status** exposes last local attempt, successful scan, failure, and last aggregate import separately. These timestamps are **local audit evidence**, not a source freshness certificate. A later correction reimport changes source history without altering issued forecast snapshots.
- The existing demand outlook and future-issue workflow can consume the source `loyverse_pos_sales` (with separately enabled WFM permissions). Staffing planning remains advisory and needs governed versioned productivity policies, coverage, worker-level eligibility/rest, manager signoff, and isolated payroll controls.

## Bounded fail-closed behavior and caveats

The API uses a fixed `https://api.loyverse.com/v1.0` base; only HTTPS GET for `stores` and `receipts`, fixed provider parameters, max 12 pages of 250 receipts (~3,000) and 8-second network timeout per page. Missing pages, empty/looping cursors, inconsistent duplicate receipt numbers, mismatched store/source, non-PH store, bad timestamps, non-success status, unexpected response type, and limits all reject the entire provider scan **without any partial aggregate import**. High-volume stores beyond the page cap require a separately validated incremental strategy.

A scan can miss cancellations/refunds or backdated receipts created later than the 7-day lookahead, or full receipts that change after the scan. This is precisely why it is source-reported and must not be advertised as provider-certified complete or used automatically to staff a real employer. This is a **planning signal only**. Real-source reconciliation must compare the authorized merchant's POS Back Office receipt exports, API store/date totals and later corrections, record zero unexplained count differences, and privately retain company/store authorization and approvals.

## Tests and real-world release gates

Dedicated `.github/workflows/wfm-loyverse-pos-qa.yml` runs lint, TypeScript, source-size, disposable PostgreSQL schema with fictional two-employer immutable revisions, synthetic provider pagination/late sync/cancellation/refund failure tests, Next build and 375px Chromium manager/admin browser verification. No real OAuth grant or vendor account is used.

To move beyond the draft, obtain: exact-head full repository CI; independent security/privacy source permission review; merchant OAuth authorization and verifiable store mapping; actual consented API-vs-export reconciliation on a staged merchant; BIR compliance assessment separate from payroll; controlled data-retention agreement; independently witnessed WFM-01–14 real-device QA (#691), additional DSP signoff (#840), a real employer's no-money shadow payroll (#579), and production gate #112. All are separate from synthetic green CI.

**Release decision: source-only draft, pilot activation NO-GO; production scheduling and payroll/payout OFF.**

## Independent receipt-count reconciliation helper

An authorized People admin's dry-run response contains a `scope` and a `intervalCounts` array, with 24, 48, or 96 bins. A different operator can aggregate the same day's Loyverse Back Office sales by store and receipt date into a sanitized JSON report. The report must have fields `source` (value `independent_loyverse_backoffice_aggregate`), `scope`, `workDate`, `intervalMinutes`, `intervalCounts`, and `generatedAt`.

Run `node scripts/wfm-loyverse-reconcile.mjs SOURCE_JSON REPORT_JSON` only on approved local evidence. It rejects mismatched tenants, malformed periods, extra fields, or count differences, and compares every interval—not merely daily totals. Even a perfect match returns `count_match_unattested` and `humanSignoff=NOT_EXECUTED`. Do not commit merchant reports or identifiers. Actual merchant reconciliation and independent witness signatures have not occurred.
