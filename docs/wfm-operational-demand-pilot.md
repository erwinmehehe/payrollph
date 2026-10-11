# WFM operational demand v1: source-reported count import and retrospective forecast

**Status:** isolated engineering candidate. All production and employer flags remain **OFF by default**. This is not a Rippling/UKG-certified connector, a provider webhook, or a live predictive planning service.

## Why this differs from the existing staffing-plan outlook

The previous `/api/workforce/demand-outlook` estimates future **staffing_requirements**, which are mutable manager-entered *planned headcounts*. This new source takes **aggregated actual business activity counts** independently reported by an authorized employer's operations source (POS export, footfall counter, appointments, orders or calls) and measures retrospective forecast error against *those counts*. The importer does **not** confirm the contents against any provider or POS API: independent source quality checks remain the employer's responsibility.

No customer names, patient identities, email addresses, order IDs, individual transaction amounts, cardholder data, device ID, GPS or employee information may be submitted. Unexpected JSON keys or extra CSV columns are rejected rather than stored. The application records only interval timestamp, count, quality, source key, revision and audit metadata, never raw import files.

## Explicit pilot activation (ALL are required)

- `WFM_OPERATIONAL_DEMAND_ENABLED=true` — server import/read kill switch
- `WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS=<strict exact comma-separated employer IDs>` — server pilot allowlist (malformed/empty/`*`/duplicate values deny access)
- `NEXT_PUBLIC_WFM_OPERATIONAL_DEMAND_ENABLED=true` — display-only manager Coverage panel switch, **not security permission**

The server uses current signed-in session, authorized exact employer, and active site bound to its real organization unit. Managers can read within approved scope. **Imports require company-wide People admin**, recent MFA when the production policy requires it, same-origin protection and a distributed request rate limit. No provider credential or browser API key is accepted as an alternative to authentication.

**Before any pilot**: DBA independently reviews and applies `drizzle/0112_wfm_operational_demand_observations.sql` on a selected staging copy, verifies constraints/indexes and compatibility, checks rollback and retention policy, and signs off the exact employer activation. The repository has no ordered Drizzle migration journal; don't replay all historical SQL files and don't `db:push` against production employers.

## Source export format

Choose an active site, metric (`transactions`, `visits`, `orders`, `appointments`, or `calls`), a stable lowercase source key such as `pos-main`, and **15, 30 or 60 minutes**. Use a CSV exported with only the four aggregate columns:

```csv
intervalStart,observedCount,quality,revision
2026-10-09T09:00:00+08:00,27,complete,1
2026-10-09T09:30:00+08:00,31,complete,1
2026-10-09T10:00:00+08:00,14,partial,1
```

The server accepts only **completed**, PH +08:00, interval-aligned timestamps within the past 366 days, no interval spanning local midnight, and **1–100 rows per request**. It caps values at 1,000,000 aggregate counts per interval. Only a **complete** quality row is eligible for model training. `partial` and `unverified` replace the latest source version as **unknown** (never zero). **Explicit zero is valid** only for a complete zero-count interval.

A correction is a separate import with the same source/metric/worksite/time slot but `revision=2`, then 3 etc. It does not delete earlier revision rows. The SQL transaction serializes employer imports, validates expected next revisions and writes the new batch, observations and sanitized audit atomically. Retries with the exact same idempotency key and payload are safe; a key reused for changed content or a skipped revision returns 409. Application imports are append-only, although a privileged DBA could still modify records directly; there is **no claim of cryptographic immutability or independently verified source delivery**.

## Forecasts and backtests

`GET /api/workforce/demand-observations/outlook` requires exact employer, site, source key, metric, interval and 7/14-day horizon. It fetches a bounded 183-day lookback of **that source's revisions**, selects the highest revision per actual time slot, and excludes incomplete/partial/unverified intervals.

The deterministic model uses 6 preceding same-weekday/same-clock-slot counts and 3 held-out chronological observations; >=9 complete samples and a recent sample within 35 days are required for each forecasted interval. Results show estimated *activity counts*, historical-retrospective MAE and WAPE; the dataset limit is 25,000 source versions per selected site/source/metric, with fail-closed `source_review` if exceeded or conflicting.

**Accuracy limitation:** Source corrections can be imported after their historical date. The model's historical walk-forward error compares chronological observations retrospectively but is *not a frozen point-in-time production forecast benchmark*. There is no external demand-to-staff productivity policy yet. The UI must not output workforce headcount, automate open shifts, infer attendance, alter payroll or claim a statistically calibrated confidence interval from this heuristic.

## Engineering and operator acceptance before rollout

- [ ] Disposable PostgreSQL 16 `db:push`, exact-head TypeScript, lint, new pure and SQL-backed tests, entire repo CI, all four payroll golden suites, security and Next build.
- [ ] Real 375px/browser keyboard, stale fetch, worksite/tenant switch, error/timeout/correction replay and import form tests on **fictional** data.
- [ ] Confirm site/org permissions and inactive/foreign org units, unapproved cohort, origin/MFA/rate limit and company-wide importer access deny correctly.
- [ ] Test same-key retry, tampered-key replay conflict, simultaneous revision writes, audit transaction rollback and quality correction precedence with synthetic data.
- [ ] Independent operator verifies one consented, non-PII actual source export against the provider-side aggregate report. Validate interval granularity, weekends, holidays and service-day boundary.
- [ ] Establish source ownership, approval, retention/erasure, import frequency, quality thresholds and consent/data-sharing obligations. Encrypt transport; no customer payload in code/artifacts.
- [ ] WFM #691 cross-role pilot acceptance, real employer no-money payroll #579, release gate #112 stay separately **NO-GO** without reviewer evidence.

## Next engineering increment

Persist **immutable issued forecast snapshots with created-at and source-version cutoffs**, compare them against observations received later (true live-out-of-time scoring), and connect role-specific productivity/service-level rules with a separately authorized approval workflow for proposed roster changes. Do not imply UKG-like true demand prediction or operational scheduling parity from this source ingestion alone.
