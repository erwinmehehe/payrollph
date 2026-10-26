# #187 Evidence-bound company premium targeting / rate-table slice

A **development-only** bounded extension to the already executable additive `worked_time_premium` rule family.

- Optional `locationCodes`, `clientCodes`, `skillCodes` and `languageCodes` selectors are strict 1–64-character ASCII codes and must be supplied as **authoritatively verified payroll context**. An enabled selector with no source evidence throws instead of guessing from employee names, job titles, emails or org membership. Existing `shiftCodes` and `worksiteIds` continue independently.
- Optional `rateTable` is a 1–24-tier collection of non-overlapping, half-open `[minMinutes,maxMinutes)` buckets of an additive percentage and/or hourly premium. One bucket applies to **the full matched segment**; it is not a marginal overtime/statutory table. Fixed rate and table in the same rule are rejected.
- Both components are opt-in and do not alter existing rules, government multipliers, public statutory tables, pay releases, approvals, migrations or organization permissions.
- Runtime payroll currently has verified `worksiteId` and `shiftCode`, **not** canonical client/skill/language/location codes; those extra selectors intentionally reject absent evidence. Do not enable tenant policy rows using these new selectors until authoritative, tenant-qualified HR/WFM sources are explicitly attached and tested.
- Current statutory/OT/night/holiday premium families are **not extended** by this patch. Other threshold/window features remain outstanding, and #187 stays open.

## Acceptance required
Exact-head unit/golden/regression/CodeQL; two-employer source-bound target evidence and segment-rounding proofs; independent payroll policy review of every tier/rate and financial trace; no production activation without signed source/date/pack evidence.
