# PayrollPH WFM — Rippling / Deputy / UKG benchmark and source gap audit

**Reviewed:** 2026-10-13 against `main` at the code snapshot current during this audit. **Scope:** source components, APIs, regression tests and docs; **not** a signed live competitor usability study or real employer UAT. Competitor roles reflect the product direction selected by the owner, not copied proprietary workflows.

## Recommendation: prove the foundation, then refine screens and forecast

The first delivery gate is [#691 WFM operational acceptance](https://github.com/erwinmehehe/payrollph/issues/691), beginning with independent WFM-12 staging evidence. Production DBA incident #899, migration #910 and readiness #112 run in parallel. Avoid adding broad optional features or enabling flags to make the UAT appear complete. The [executable staging packet](qa/wfm-691-staging-acceptance-runbook.md) lists roles, fixtures and outcome rules.

| Benchmark | Implemented today in reviewed source | Specific verified gap / next proof | Stage |
| --- | --- | --- | --- |
| **Rippling — unified Time → Payroll** | [Team roster](../src/components/workspace/workforce-team-roster-panel.tsx) resolves effective employee schedules and shows reviewer-aware policy findings; [timesheet](../src/components/workspace/workforce-timesheet-panel.tsx), [attendance corrections](../src/app/api/workforce/attendance-corrections/route.ts) and [shift-to-pay tests](../tests/wfm-payroll-handoff-e2e.test.ts) use common employee/attendance/payroll records. | Execute *one real app* HR → roster → clock → reviewer correction → independently approved time → payroll preview without re-keying. Check cutoff immutability, audit and exact employee-level PH premiums with bookkeeper. Synthetic tests are not employer acceptance. | **P0: #691 then #579** |
| **Deputy — daily roster UX** | [Weekly team roster](../src/components/workspace/workforce-team-roster-panel.tsx): week pager, scoped search/filter, 20-person server pages, seven-day grid, individual future-day editor, rules preview before publishing. [Coverage](../src/components/workspace/workforce-coverage-panel.tsx), [manager home](../src/components/workspace/workforce-manager-home.tsx) and [swaps](../src/components/workspace/workforce-schedule-swap-panel.tsx) expose availability, gap resolution, request and independent approval. | Today's coverage, roster editor and swaps are **separate panels**; the inspected swap flow is a form-plus-review table, not a proven one-screen/mobile swap journey. Test how many steps an authorized manager needs to locate a gap, find an eligible substitute, propose/reject and publish after rules. Avoid assuming a missing drag-and-drop UI across the entire application from this scoped audit. | **P0: observe #691; P1: targeted UI simplification after sign-off** |
| **UKG — forecasting depth** | [Historical plan outlook](../src/components/workspace/workforce-demand-outlook-panel.tsx) clearly marks plan-based WAPE as **not** business-demand accuracy. [Aggregate operational demand](../src/components/workspace/workforce-operational-demand-panel.tsx) supports 15/30/60-minute source intervals; [issued future forecasts](../src/components/workspace/workforce-issued-demand-panel.tsx) freeze a prospective forecast and later score MAE/WAPE against complete actuals. [Demand-to-staffing](../src/components/workspace/workforce-demand-staffing-panel.tsx) produces explainable staffing/cost what-if, no schedule publish. | Validate aggregate-source authorization and source-complete settlement; compare immutable issued forecast to actuals over repeated future windows. Quantify drift/bias and forecast coverage with site/role windows before claiming production predictive accuracy. Unsupported/missing data must stay unknown, and cost visibility remains role restricted. | **P1: prospective calibration + sourcing after #691** |
| **Draft-only automation** | [Greedy roster preview](../src/components/workspace/workforce-greedy-roster-panel.tsx) uses requirements, eligibility, approved leave, fairness and unfilled reasons; explicitly does **not** publish. [Tests](../tests/workforce-greedy-roster.test.ts) include 1,000-worker candidate consideration and no unknown-evidence assignment. | Witness that no draft is silently persisted/published or made payable, and that an independent manager actively publishes after the same roster rule checks, with explicit unfilled reasons. | **P0 safety proof; no ML replacement** |

## Deputy-inspired UX acceptance observations (do not redesign yet)

Run these as witnessed tasks with an actual site-scoped manager and employee on desktop plus 375px Android/iPhone browser. Capture *measured* clicks, elapsed time, error recovery, focus/keyboard usability and the number of panel/context switches. Set a product-owner-approved improvement target **after baseline**, rather than inventing one.

1. Locate one unfilled Friday shift from the manager home; use coverage to identify permitted workers and explicitly rule out leave, expired skill or different site.
2. Open its employee/day in the seven-day team roster; review daily/weekly/rest blockers and rest/holiday premium warnings before an authorized schedule action. A 13-hour shift and five-hour rest produces exactly two blocking findings, not a hidden deduction.
3. Submit a two-employee swap; requester's own approval must be rejected; independent manager sees current schedules and source conflicts, then accepts/rejects with an audit receipt.
4. Try rapid tenant switching, 20-row page navigation, phone back/forward, network failure, stale async response, unsupported split shift and corrected time punch. Old employer/shift state must not leak.
5. Verify employee acknowledgment/visibility of changed shifts and that one action takes the user back to the affected roster/coverage item rather than requiring a blind search. If missing, file a **single scoped UX ticket** with video/evidence and a success metric.

**Likely P1 improvements after measurement:** unified roster/coverage/swap deep links and manager action flow; compact responsive week view; visible pending-review state and change acknowledgment. Keep the current schedule rules, independent publication authorization and employee-pay evidence.

## UKG-inspired forecasting acceptance observations

Use authorized **aggregate** activity only (never employee-level payroll as fake customer demand). For two fictional sites with differing weekday peaks:

1. Import approved synthetic interval observations; verify units, 15/30/60-minute windows, absence/partial data handling and source revision cutoff.
2. Issue a **prospective** forecast for 7/14 days; record its immutable hash, training cutoff and output *before* target actuals exist.
3. After complete synthetic actuals, finalize **MAE, WAPE, signed bias and coverage**. Re-import a corrected actual; prior frozen score must not silently change. Empty/partial intervals remain *unknown*, not zero.
4. Compare demand-to-staffing gap and illustrative labor-cost sensitivity for approved and hypothetical productivity/service targets, restricted by payroll-aware role. No named shift, payout or statutory pay gets modified by the forecast.
5. Track repeated issued forecasts by worksite/role/horizon only when source provenance and sample size permit. *Source-reported* scores are not independent provider-verified model accuracy. Review calibration before a more complex solver.

**P1 development candidate, not yet authorized:** a read-only evidence dashboard with issued-versus-actual coverage, MAE/WAPE/bias trend, baseline comparison and clear source limitations. Delay ML, auto-publish, optimization claims and proprietary UI imitation.

## Acceptance and ownership

| Work | What unblocks it | Owner/evidence |
| --- | --- | --- |
| **Now:** WFM-12 1,000-assignment full path | Protected staging, independent WFM/SRE roles, one leased real-app clock-in-watch tick, tenant/multi-page failure and latency results; [synthetic upgrade #936](https://github.com/erwinmehehe/payrollph/pull/936) stays draft until WFM policy review | SRE + QA + WFM manager; #691 |
| **Now:** WFM-01..14 and photo/offline | Multi-role/phone/device testers, DPO/legal/privacy, independent payroll checks and signed source-SHA acceptance | HR + AppSec/DPO + payroll + owner; #691 |
| **Parallel:** deploy readiness and migrations | Historical DBA receipts, #899 write-impact assessment, credentials/worker health | DBA/SRE; #910 #899 #112 |
| **Later:** measured UX simplification | Manager/employee UAT recordings, gap ticket with one clearly owned workflow | Product + UX; #678 |
| **Later:** forecast accuracy depth | Prospective locked input/actual evidence, provider provenance, repeated score data and access rules | Operations + finance + data; #678 |

**Decision:** freeze broad WFM features until operational acceptance. The three benchmarks remain design inputs, not reasons to duplicate already merged modules.
