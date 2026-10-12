# Linaw WFM: cross-functional pilot acceptance matrix

**Status:** Draft acceptance plan, 2026-10-10. **No acceptance tests or human sign-offs are implied by this document.** This file is safe to keep in GitHub because it must not contain employee, bank, payroll or personal identifiers.

## Product outcome and explicit boundary

A Philippine operations manager should complete **roster → coverage recovery → governed approval → employee schedule visibility → time evidence → exception/correction → independently approved timesheet → payroll review** without re-keying authoritative employment or time records. The connected Payroll / HRIS / WFM / HCM record is the competitive differentiator; the WFM interface must not silently approve a shift, determine absence, alter wages, release payroll or send payouts.

Current code baseline (October 10): nested overlap/rest guard (#681), smart coverage drafts/live floor (#677), and unified weekly team roster (#683) have been merged. **Code merged is not production acceptance.** Independent code/security review, manager/HR/bookkeeper application UAT, hardware evidence, live release proof and parallel payroll comparison have not been established by those merges. See #194, #678, #674, #579 and #112.

### Cross-functional panel and evidence owners

| Role | Required decision / evidence |
| --- | --- |
| Product owner | Approve narrow pilot persona, workflow success criteria, scope and known limitations |
| Engineering lead | Review exact deployed/source SHA, tenant and organizational scope, stale data, race conditions, API and database integrity |
| WFM operations manager | Exercise team roster, gaps, open shifts, shift changes, manager inbox and attendance exceptions in the **app** |
| Philippine payroll officer / bookkeeper | Independently compare night, rest/holiday, overtime, leave and correction effects through payroll previews and immutable trace |
| HR representative | Verify employment state, approved leave, worker eligibility, managers, effective dates and appropriate employee communication |
| Security/privacy reviewer (DPO where applicable) | Confirm least privilege, tenant isolation, audit, PII minimization, secure evidence retention, breach and restore procedures |
| QA / test lead | Own scripted scenarios, expected-vs-actual capture, reproducible defects, automated regression and repeatability |
| UX/accessibility reviewer | Validate phone-size tasks, keyboard/screen-reader feedback, statuses, errors, low-bandwidth behavior and comprehension |
| SRE / DBA | Verify staging configuration, job/notification flags OFF, migrations actually applied, backups, recovery and safe rollback |
| Employer sponsor / release owner | Authorize pilot organization, independently review evidence and approve the exact rollout; never infer approval from CI |

The AI-assisted panel can prepare and test the design/code. It **cannot impersonate any independent reviewer, payroll professional, employer, DPO, DBA or bank official**, and it cannot certify real-world acceptance.

## Stage 0 — isolate the pilot

- Use two explicitly separate **fictional** tenants, A and B. Do not upload private employer or employee data to GitHub.
- Seed a synthetic multi-site tenant (target 50–200 workers across at least three sites and multiple departments); include both hourly/salaried roles and at least two shift/leave rules.
- Give distinct test accounts to: limited-scope manager, company-wide People admin, employee, HR operator, payroll officer, independent checker and owner. Include tenant B negative-access identities.
- Keep outbound notification/clock-in watch, biometric import, unreviewed scheduler, production banking/disbursements and any money-moving provider **OFF**. Use no-money simulation and dry-run files only.
- Freeze the tested commit SHA, migrations/config/feature flags, browser version, synthetic fixture version and Asia/Manila dates in the private QA record.
- Record names of **actual human** reviewers and dates privately; GitHub should contain sanitized pass/fail summaries and non-sensitive identifiers only.

## Stage 1 — end-to-end manager / employee / payroll journey

1. HR creates synthetic eligible workers, effective employment dates, roles, worksites and manager scopes; verify one authoritative employee identity.
2. Manager loads a seven-day roster; review all pages, unassigned days, rest days, overnight/split shifts, staffing minimums, leave and evidence marked **Needs review**.
3. Create a realistic uncovered shift and compare deterministic scarce-role-first versus balanced-hours coverage drafts. Explain why a worker was eligible or excluded.
4. Stage a proposed replacement as **pending**. A different authorized manager must revalidate and approve it; test rejection and concurrent/changed-source failure.
5. Verify the employee's schedule reflects the approved effective change. Where acknowledgment is not yet available, **record the gap**; do not claim acknowledgment happened.
6. Capture a normal shift and a difficult one (overnight, partial leave, missing punch, duplicate or correction). Confirm live-floor labels are **recorded evidence, not physical presence or absence determinations**.
7. Employee requests a correction; an authorized manager decides; submitted/approved timesheets stale and reapproval is required when underlying evidence changes.
8. Payroll officer previews the employee's exact period: recorded schedule and punches, expected/actual minutes, premium boundaries, approved OT, leave and pay rule/version evidence. Checker independently reviews the run.
9. Verify earnings are not suppressed merely because managerial OT authorization is missing. Invalid/ambiguous premiums must fail closed with actionable errors; released payroll remains immutable.
10. Capture immutable output and trace snapshots, re-run deterministically, and verify that the scenario produces no payout, transfer, provider call or employee disciplinary action.

## Stage 2 — scenario and non-functional acceptance

**All scenarios below start NOT RUN; they must be executed and evidenced, not checked off based only on source or automated CI.**

| ID | Priority | Scenario | Expected behavior | Required reviewer |
| --- | --- | --- | --- | --- |
| WFM-01 | P0 | Tenant A manager switches to tenant B, pages and refreshes while old requests are pending | No stale tenant A worker rows or old-page data display under tenant B; old requests canceled/ignored | Security + QA |
| WFM-02 | P0 | Scoped manager and tenant B user query team roster, live floor, coverage, exports and mutations | Server denies out-of-scope access; client page counts and exports are explicitly page/scope local | Security |
| WFM-03 | P0 | Seven-day team roster with 50–200 workers, three sites, rest/overnight/split days | Deterministic paged statuses and worksites; invalid schedule evidence says Needs review; no false rest days | WFM manager |
| WFM-04 | P0 | Two managers stage an overlapping overnight shift or conflicting same-day claim | Revalidation blocks duplicate/nested overlaps, rest/streak conflict, stale claim and race; no silent publish | Engineering + WFM |
| WFM-05 | P0 | Scarce licensed/certified role, approved leave, employee without qualification | Ineligible workers excluded with reason; cannot bypass qualification/site/leave via request tampering | HR + WFM |
| WFM-06 | P0 | Unconfirmed punch, malformed break, duplicate open time-in, approved full/partial leave | Advisory review, explicit uncertainty, no automatic absence, no invented time or silently priced premium | WFM + Payroll |
| WFM-07 | P0 | Regular shift plus Philippine night/rest/holiday/OT stacking, crossing midnight and pay period | Deterministic amounts checked against separately calculated Philippine payroll-approved vectors, to centavo | Payroll officer |
| WFM-08 | P0 | Employee correction after timesheet submission/approval; cutoff lock | Stale snapshot rejected; protected approval/release gated; past released payroll not rewritten | Payroll + QA |
| WFM-09 | P0 | Unauthorized employee/manager tries to self-approve claim, timecard or payroll | Maker/checker separation enforced in server API; audit actor/source evidence intact | Security + Payroll |
| WFM-10 | P0 | Feature flags OFF and simulated provider failure/retry | No real notification/clocking worker/pay or bank operation; safe retry/rollback and error visibility | SRE + Security |
| WFM-11 | P1 | Visibility refresh, failed network, rapid page changes and mobile back/forward | Current view remains scoped; stale responses cannot win; errors explain next action | UX + QA |
| WFM-12 | P1 | Clock-in watch on more than 200 assignments | Feature-gated keyset pagination reads the full eligible cohort before emitting alerts; 1,000-row synthetic database test exercises six bounded pages. **Engineering candidate only, NOT independently accepted:** verify scheduler lease, full coverage, app UI, tenant scope and notifications in staging | SRE + WFM |
| WFM-13 | P1 | Low-bandwidth mobile employee schedule, correction and shift claims | Usable navigation, labels, focus, accessible feedback; no silent offline success | UX + Employee |
| WFM-14 | P1 | Real biometric/offline device replay, clock drift and conflicting entries | Remains a separate **uncertified** integration gate; no real-device claim from synthetic test | Device + Security |

## Proposed measurable exit gates (targets, not observed results)

**Engineering candidate:** exact-head TypeScript, Next.js build, tests, security/tenant isolation checks, CI and relevant golden WFM-payroll assertions complete; any failed check blocks advancement.

**Operator pilot candidate:** every **P0** row has a test run ID, expected/actual, sanitized evidence reference, defect owner and separate qualified reviewer disposition. No open critical/high tenant, wage, approval or data-integrity defects. Validate realistic workload and paging; capture p50/p95 latency rather than inventing performance claims.

**Payroll shadow pilot:** after authorized security/privacy controls, complete the real-employer no-money pilot in #579 with independently reconciled employee and component totals and **zero unexplained differences over ₱0.01**. This is separate from synthetic WFM UAT. Broader readiness requires the multi-period parallel evidence in #194/#112 plus device/bank/government acceptance when applicable.

**Live release:** named human security/DBA/payroll/HR/operations authorization at the exact deployment SHA, restore and rollback evidence, production security/encryption/email gates from #112, explicit feature-flag decision and documented employer consent. No live payroll/payout or auto-absence action from this matrix.

## Pilot run record (copy one per scenario into a private evidence system)

- Scenario ID; fictional fixture version; tenant/worksite/role scope
- Exact app build/deployed SHA; API version; database migration journal reference; flags
- Expected UI, API status and immutable payroll/source trace
- Actual result and time (Asia/Manila); screenshot/log **stored privately**
- Defect ID/severity and whether the fix was retested against a new SHA
- Reviewer role, actual human identity, date, Pass / Needs fixes / Not run
- Owner's explicit GO / NO-GO and rollback reference (separate from developer or automated checks)

## Development sequence and work-in-progress constraints

1. **Now:** repair live-floor superseded request / tenant switch visibility; build regression coverage. This is code-hardening work, not operational acceptance.
2. Verify mainline merged #681 → #677 → #683 against this matrix in a protected synthetic staging app. Update outdated issue #674 snapshot from live GitHub state; preserve audit of decisions.
3. Finish the single manager worklist and employee acknowledgment journey only after identifying genuine gaps in UAT. Keep manager-only actions governed and do not create another scheduling engine.
4. Keep default-OFF notification reliability / >200 assignment paging, real device offline proof and independent payroll pilot as explicitly separate lanes.
5. Only after those gates consider sector-specific BPO and retail packs, forecasts and broader HCM integrations.

Links: [WFM roadmap #678](https://github.com/erwinmehehe/payrollph/issues/678) · [integration board #674](https://github.com/erwinmehehe/payrollph/issues/674) · [real payroll pilot #579](https://github.com/erwinmehehe/payrollph/issues/579) · [production readiness #112](https://github.com/erwinmehehe/payrollph/issues/112).

## WFM-12 engineering candidate (2026-10-12 — NOT an acceptance sign-off)

**Migration reservation blocked:** Main was at 0114 but older open drafts #813/#858 already claim 0115, so this PR keeps its required DDL in `docs/engineering/migration-proposals/wfm-roster-scale-rules.sql` and does not claim a conflicting `drizzle/0115_*.sql`. The DBA must assign a contiguous migration number after the release train resolves the competing claims. Enabling the feature before that database migration would fail closed.\n\nThe opt-in `WFM_ROSTER_SCALE_RULES_ENABLED` gate introduces a paged clock-in watch scanner (200 assignment rows per keyset page, maximum 20,000). No alert event is invoked until all pages and worker schedule reads succeed. Above the explicit hard cap, it reports `cohort-too-large` and emits nothing; a failed read must not mark a partial population as complete. A 1,000-assignment disposable PostgreSQL test verifies six pages (five 200-row pages plus empty terminal page) and no cross-tenant contamination; the separate pure tests cover truncation, duplicate employee assignments and invalid date windows.

Team-roster GET already paged employees in groups of 20. New requests can optionally set `endDate` for a bounded 1–14-day window; intersecting assignment reads now restrict both effective start and end. Page totals, daily digests and CSV downloads remain **explicitly page-local**, not whole-employer coverage signals. The new date-range contract is off until the release gate is enabled.

Roster-publish checks reuse existing schedule resolution and legacy guardrails. Additional tenant-configured checks label daily/weekly scheduling caps, gaps, overlapping shifts, independently approved OT caps, and rest-day/holiday premium implications. Only configured scheduling policy blockers (daily, weekly, rest gap) can be manager-excepted with a 12–240 character reason. Overlap and OT authorization blocks cannot be manager-waived; premium warnings never alter wages. The existing company advisory lock, original maker/checker requirements for governed bulk batches, same-transaction audit rows and `sealAuditEvents` hash chaining remain in place.

**Must still execute before marking WFM-12 PASS:** full exact-head CI, migration rehearsal, 1,000-row paged watch under a leased scheduler tick, tenant A/B and restricted manager app UAT, duplicate/history/race and interruption cases, notifications deduped after retries, SRE + WFM independent sign-off, and performance/latency evidence at representative employers. Automated source or synthetic tests alone cannot certify the acceptance matrix. PH defaults require payroll/legal validation before production enablement.
