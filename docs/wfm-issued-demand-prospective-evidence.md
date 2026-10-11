# WFM issued future demand forecasts and prospective source-reported scores

**Engineering candidate, default OFF.** This is a stacked follow-on to #828's source-reported aggregated workload import, and depends on SQL 0114 after its predecessor 0113. The source is neither independently provider-certified nor a labor productivity standard.

## Exact problem fixed

Historical retrospective backtests can inadvertently include source corrections posted *after* the historical forecast target. A proper prospective claim needs to prove that the forecast and its inputs existed **before** the future interval, then score it only after actual observations settle.

This implementation introduces:
- One append-only **issued forecast** per exact employer + idempotency key, with server/database issue time, worksite, source/metric/interval, lookahead, a frozen set of future UTC intervals, predicted aggregate counts, training-source SHA-256 and entire snapshot SHA-256.
- The issue transaction takes the **same employer advisory lock (8857)** as the existing aggregate import, chooses source revisions whose `recorded_at` is no later than the database issue timestamp, and only trains on physically completed historical intervals. Source revisions arriving later cannot retroactively change the issued prediction or evidence digest.
- Each issue starts **tomorrow in Philippine time** and targets 7 or 14 days of *evidenced* intervals. Unknown hours/days are not filled with zero. The 400-point cap fails closed rather than truncating a supposed full forecast.
- A **final, one-time scored report** compares the issued future interval predictions to later reported, quality=`complete` revisions. It requires **all issued intervals** complete, each interval ended at least 24 hours earlier, and excludes any observation received at or before issue time. Missing, unverified, partial or unsettled data block finalization (409), not count as zero.
- The score records frozen MAE, WAPE (null if the actual total is zero), signed mean bias, revision IDs and a SHA-256 report digest. New source corrections after final score do **not** rewrite the report. Governance for append-only amendments, rescore approval and correction disclosure is a future stage.
- The manager Coverage panel lists exact-worksite issued snapshots and frozen scores, with explicit issue/final-score actions permitted only to **company-wide People admins** (and server-side MFA policy). No scheduling/payroll, timecard, overtime, wage, payout or attendance state is touched.

## Security and rollout

Both **independent**, server-side allowlists must permit the exact employer:
- `WFM_OPERATIONAL_DEMAND_ENABLED=true`
- `WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS=<strict exact IDs>`
- `WFM_ISSUED_DEMAND_FORECASTS_ENABLED=true`
- `WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS=<strict exact IDs>`
- `NEXT_PUBLIC_WFM_ISSUED_DEMAND_FORECASTS_ENABLED=true` controls the UI **only**, not authorization.

All flags are **unset** by the source branch. GET only returns data in the signed-in manager's assigned active worksite/unit or explicitly company-wide scope. POST issue and final-score additionally require company-wide People-admin role, CSRF/same-origin enforcement, current MFA when production policy requires it, rate limiting, exact-key JSON parsing and explicit acknowledgement. We never accept individual names, customer IDs, GPS, payment data, patient IDs or raw POS transactions.

## Evidence and operational limitations

- The observations are **importer-reported aggregate counts**, not authenticated by an approved third-party POS API. Scores can verify time ordering against stored PostgreSQL metadata, not the truth of externally supplied source contents.
- Source input uses existing mutable DBA-accessible tables; snapshot SHA helps detect accidental changes in the app, but is **not a tamper-proof signature** against a privileged database administrator or a compromised writer.
- The published forecast is based on weekday-and-time-slot trailing-six weighted means (>=9 complete historical observations) and is advisory. It cannot claim industry-grade model validation or a staffing-to-sales productivity relationship.
- A forecast may include only some intervals. Every missing time slot remains *unknown*, not a legitimate prediction of zero demand. Prospective WAPE is computed over **issued and fully settled** intervals, not all opening hours and not an independent provider-certified dataset.
- Individual issued forecasts can only be finalized once. Provider corrections arriving after frozen scoring must be investigated by the operations owner; no silent rescore path exists. This intentionally avoids retroactively inflating operational forecast accuracy.
- Issue source timestamps are determined by PostgreSQL inside the same serialized import lock. Database administrators can alter raw records; the system does not claim an external notarization or cryptographic immutability.

## Staged migration sequence

- `0112_xendit_payout_provider.sql` is reserved by draft #813. It is **not authorization to turn on a payment provider**.
- `0113_wfm_operational_demand_observations.sql` belongs to draft #828 and requires its own DBA approval.
- **`0114_wfm_issued_demand_forecasts.sql`**, this stacked PR, must only be reviewed/applied *after* separately approved 0112 and 0113. There is no ordered Drizzle journal in this repository and the advisory SQL-history guard correctly blocks any migration-number gaps.

No SQL, secret, pilot flags, notification worker, roster publisher, payroll or payout system is activated by merging source code. Staging DBA must rehearse the SQL on a disposable copy, verify indexes and constraints, and sign the selected employer pilot separately.

## Engineering acceptance

- [ ] Disposable PG16 schema, TypeScript, lint, input/issuance/score regression tests, source-size, full Next build at exact PR head.
- [ ] Entire repo CI including four statutory golden payroll suites, CodeQL, HTTP smoke, isolation, DR and synthetic production-payroll pilot.
- [ ] 375px Chromium browser + keyboard and site/account-change fixture for list, issue acknowledgement, finalization 409/201 and frozen result; no real customer data.
- [ ] Test two isolated synthetic employers, an unauthorized branch manager POST, unassigned site, wrong worksite/tenant and missing/MFA/CSRF/bad allowlist.
- [ ] Verify concurrent source import during issuance cannot cross the cutoff, tampered SHA raises review, same-key retry never creates a new issue, missing/partial actuals never become zero, zero denominator WAPE is null and late revisions do not re-score.
- [ ] Independent DBA on 0112 → 0113 → 0114, operator source-consent validation, HR/WFM/QA and security signoff. WFM pilot #691, real no-money payroll #579 and GA release #112 remain separate **NO-GO** until witnessed.

**Follow-on:** provider-specific authenticated aggregate source adapter + signed source manifests, source revision provenance, versioned amendment approval for post-score corrections, and approved site/role productivity/service-level curves before proposing (never auto-publishing) roster changes.
