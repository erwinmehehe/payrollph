# WFM demand intelligence v1 — backtested historical staffing outlook

**Release state:** source-level, read-only preview only. This improves manager planning but is **not an externally validated demand prediction engine**. No feature flag is turned on for an employer or operational release by this PR.

## What it does

- On the existing Coverage screen, a manager can choose one **authorized, active worksite** and a 7- or 14-day preview.
- Reads **up to 182 prior Philippine calendar days** of existing staffing requirements for that worksite; it neither creates observations nor backfills missing dates with zero.
- Separates weekday + shift definition + job profile. A group with at least **nine observed historical occurrences of that weekday** uses the six most recent same-weekday counts for a weighted headcount estimate. A three-observation **walk-forward holdout** checks errors using only observations earlier than each held-out target.
- Reports historical-plan MAE/WAPE against *entered staffing requirements* and a low/high **illustrative sensitivity range**, not a statistical confidence interval. Returns no suggestion when required evidence is missing or stale. The preview explicitly distinguishes headcount estimates from measured demand, payroll or employee presence.
- Server restricts both site selection and the historical SQL query to the **current session's exact employer and assigned organization unit**, with company-wide manager permission only when already granted by existing access controls. No employee, wage or GPS data enters the response.
- A too-large source (>2,000 requirement rows in six months), duplicate/contradictory key, invalid count/date/scope, or >40 distinct shift/job cohorts **fails closed** with an explicit source-review status, not a partial result.
- The client guards against aborted/out-of-order fetch results and rejects responses from another employer/worksite; no save/publish/approve/edit endpoint or payroll modification is introduced.

## Safe opt-in rollout

This capability remains **OFF for every employer by default**. A separately authorized pilot must configure **all three** flags:

- `WFM_HISTORICAL_OUTLOOK_ENABLED=true` — server-side kill switch.
- `WFM_HISTORICAL_OUTLOOK_ALLOWED_ORGANIZATION_IDS=<exact comma-separated IDs>` — strictly validated employer allowlist. An empty, wildcard, malformed or duplicate list denies access.
- `NEXT_PUBLIC_WFM_HISTORICAL_OUTLOOK_ENABLED=true` — controls whether the manager Coverage screen displays the panel; **it is not a permission mechanism**.

The authenticated server also enforces the exact employer membership and active worksite/unit scope on every request, even if someone bypasses the browser display flag. Feature switches are not set by this PR; no live employer is enabled.

## Source limitation that must remain visible

`staffing_requirements` represents *manager-entered planned staffing headcount*, and can be edited later. It is **not** observed customer visits, sales/POS receipts, orders, patient arrivals, forecasts frozen as-of issuance, nor measured actual required staffing. The walk-forward validation is a useful *technical check of planner consistency*, but without immutable point-in-time source snapshots its WAPE is **not out-of-sample operational demand accuracy**. Missing plan dates do not prove there was no work. A day/shift/role having no sufficient history remains unknown, not zero.

This milestone deliberately does not reclassify historical staffing requirements as independent demand measurements, does not automatically generate approved requirements or roster slots and does not tell managers that estimated headcount satisfies labor law, budget or safety policy.

## Synthetic engineering acceptance

1. Run exact-head TypeScript, ESLint debt gate, the focused forecast regression suite, full CI, four golden payroll suites, CodeQL, security checks and production Next build. The feature has no SQL migration.
2. Test a manager at an authorized site, another org unit, a different employer and a deactivated site. A valid preview may be returned only for the first. Check employee-level and pay/cost data do not appear in its payload.
3. Test sparse weekdays, <9 historical observations, same-weekday samples, conflicting duplicates, malformed calendar dates, stale sources, explicit zero counts, 2,001+ rows and >40 shift/job groups. No training row may be on/after the requested PH forecast date.
4. Browser check 375px and desktop, keyboard navigation, slow/failed requests, worksite/tenant switch and multiple quick switches. Verify the evidence caveat is visible for ready *and* insufficient results, and the table shows no misleading missing-day zeros.
5. Compare model output and three held-out cases manually on a fictional 2-site roster with independently computed expected values. Do not forge independent WFM-01–14 human pilot acceptance.

## Follow-on for a genuine UKG-style demand capability

Authorize a versioned, tenant-protected and permissioned source feed of historical **actual business-demand observations** (per site, role/service line, 15/30/60 minute interval, known units, timezone, quality/missingness) with an immutable as-of archive. Build ingestion replay/dedup, audit, late-arriving revisions, holiday/events and leakage-safe chronological backtests; then evaluate WAPE/MAE/bias on *held-out actual demand*, quantify cold starts, and calibrate recommended staffing against approved productivity/service-level rules. Keep forecasts advisory until human acceptance and governance approve staged scheduling.

**No live WFM/pilot go-live, notification activation, money movement, migrations or production secrets are changed.** #691 remains the operational WFM acceptance gate, separate from source CI and #579 no-money payroll reconciliation.
