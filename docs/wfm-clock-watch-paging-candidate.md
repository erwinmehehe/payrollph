# WFM-12 clock-in watch paging candidate

This is a **source-only, default-off engineering candidate**, not completed WFM-12 human acceptance.

## Baseline and behavior

On `main` at `4d81636122c55ac5e512b2f4c393101f00e55d83`, the interactive seven-day team roster already uses server-side 20-employee pages and tenant/org-unit predicates. The background clock-in-watch job instead skipped the entire cohort when more than 200 active schedule assignments matched its two-day window.

With `WFM_CLOCK_WATCH_PAGING_ENABLED=true` **and the existing** `WFM_CLOCK_IN_WATCH_ENABLED=true`, the worker uses ordered assignment ID keyset pages of 200, scans up to 10,000 matching assignments before emitting any event, and rejects malformed/overfull pages or incomplete cohorts. With the new flag unset, existing 200-assignment behavior remains unchanged.

The watch still emits **advisory** automation events only. It does not mark people absent, generate deductions, create payroll entries or make timesheet approval decisions. Its scheduler/automation controls remain separately default-off. The scanner does not itself guarantee a database point-in-time snapshot across pages. For a continuously changing dataset, perform WFM operations acceptance with concurrent roster mutations and review whether a repeatable-read snapshot or per-tenant leased scan is needed.

## Synthetic checks

`TZ=Asia/Manila npx tsx --test tests/wfm-clock-in-watch-paging.test.ts`

Behavioral tests cover: 1,000 ordered assignments in eight pages; no partial result after exceeding the configured scan cap; duplicated/regressing cursor rejection; flag exact-true behavior.

Before merging, run `npx tsc --noEmit`, `npm run lint`, the golden payroll suites and `TZ=Asia/Manila npm test` on the exact branch. Independently perform WFM-12 operations sign-off; CI tests alone are insufficient. Do not enable either automation flag in production from this document.
