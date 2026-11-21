# Western Visayas VI-30 — source-verified, staged and NOT activated

Prepared on 2026-11-21 (Asia/Manila). Scope: [issue #2062](https://github.com/erwinmehehe/payrollph/issues/2062), [draft PR #2063](https://github.com/erwinmehehe/payrollph/pull/2063).

## Official source and time-bound category references

[National Wages and Productivity Commission, Region VI](https://nwpc.dole.gov.ph/region-vi/), [Wage Order No. VI (Western Visayas)-30](https://nwpc.dole.gov.ph/wp-content/uploads/2026/11/WAGE-ORDER-NO.-VI-WESTERN-VISAYAS-30.pdf) and [NWPC news announcement (November 11, 2026)](https://nwpc.dole.gov.ph/western-visayas-soccsksargen-private-sector-workers-kasambahays-to-receive-wage-increases/).

Order VI-30 issued **2026-10-21**, published **2026-11-04**, effective **2026-11-20**.

| Ordinary private-sector category | Through November 19, 2026, previous VI-29 | From November 20, 2026, VI-30 | Source status |
| --- | ---: | ---: | --- |
| Non-agriculture, industrial or commercial, **more than 10** workers | ₱550/day | ₱590/day | NWPC SOURCE READ |
| Non-agriculture, industrial or commercial, **10 or fewer** workers | ₱525/day | ₱565/day | NWPC SOURCE READ |
| Agriculture | ₱520/day | ₱565/day | NWPC SOURCE READ |

The wages are legal-category references, **not universal rates**. Exact geography, employer sector, workforce size, coverage/exemptions, worker category, employment agreement, original work date, and possible wage distortion must be independently reviewed by qualified Philippine payroll professionals. Domestic workers are covered by a **separate monthly wage order** and are NOT included in this daily table.

## Implemented safely by PR #2063

- **Pure isolated, source-backed candidate:** `src/lib/wage-order-region-vi30-review.ts` provides an explicit work-date and employer-class lookup for the November 20 transition. It rejects invalid dates, unsupported earlier history, and unclassified requests for a category-specific rate.
- **Tests:** `tests/wage-region-vi30-effective-date.test.ts` exercises previous/new category rates, first effective day, historical rates, mid-cutoff transitions, missing/incorrect class and validation, and an explicit default-off production boundary.
- **Protected live source intentionally NOT changed:** `src/lib/wage-orders.ts` and its existing tests are byte-identical to `main` (source blob `0bb8c55d6cad0f3a22f6096f0937dd55ca0b227d`). This keeps existing source-bound tenant-security holds truthful and fail closed. **As a result, live `wageOrderFor('VI')` still uses the old 2025 high-tier advisory ₱550; that is not a current November 20 legal determination.**
- **No automatic payroll changes, wage/MWE reclassification, provider calls, credits, consent, money, real agency filings, runtime feature flags or production data.** This PR is a safe staging step, **not** a completed operational wage update.

### Why the earlier direct change failed security CI

Before staging, PR #2063 edited the protected live registry from blob `0bb8c55d6cad0f3a22f6096f0937dd55ca0b227d` to `7065f544a4c6ea7653609135d325ad93cf78c346`. The original source-hold inventories/zero-credit proof guards correctly refused to transfer a previous source receipt to new runtime bytes. This was the root cause of failures in wage-source inventory, security HTTP, SSO, DL-02 and broad regressions. **Changing the pinned hash without an independently executed proof and accountable ledger transition would be security weakening, not a fix.**

### Required before integrating the candidate into live payroll

1. **PH payroll specialist and employer policy owner** confirm the source and exact covered category, geographical applicability, order exceptions, company size, work date and treatment for periods straddling November 20. Document a reviewer and dated decision outside public GitHub if personal/regulated data is involved.
2. **Tenant/security source owner** maps the changed runtime wage dependency to **every** affected HTTP/API method, historical proof, source closure and current coverage status. Make an explicit, reviewed zero-credit supersession for every newly stale method. Do not borrow v1/v2 #2056 proof that executed the previous wage source; if its own closure depends on the registry, the method must be withdrawn until re-executed.
3. In a **separate activation PR**, deliberately integrate the candidate into the protected live code after mapping the dependency impact; retain historical work-date rules. Re-run exact-head real PostgreSQL 16/18 and real HTTP, own-employer positive, real foreign-employer denial, forged selector containment, unchanged victim records, dates/categories and source-bound release checks.
4. Regenerate only **fresh executed** method receipts, with checked source SHA and named independent security/payroll reviewer. Leave all unrelated previous receipts immutable; no acceptance just because a test says `PASS`.
5. **Rollout remains NO-GO** until separate employer-pilot, privacy/security, statutory-policy, database and backup gates are approved. A source reference and a passing synthetic test are not a government certification or approved payment decision.

**Owner decision outstanding:** do not merge or activate the staged logic as an operational rate update until these gates are met. No unreviewed bypasses of the existing wage source checks.
