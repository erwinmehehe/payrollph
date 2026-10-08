# PayrollPH verification checklist and roadmap gates

Updated: 2026-10-06

This checklist turns the product roadmap into evidence gates. A capability is not "done" because code exists; it is done only when its calculation, authorization, audit, recovery, production, and reconciliation evidence is complete.

## Gate A — Payroll correctness and statutory safety

- [ ] Golden reconciliation suite has at least 50 independently reviewable fixed cases and is required by CI.
- [ ] Monetary rounding boundary tests cover half-cent, repeating-decimal, negative adjustment, and aggregate-vs-line rounding cases.
- [ ] SSS/MPF boundary matrix covers floor, every relevant MSC transition, MPF transition, ceiling, mid-period hire/separation, and multiple payroll runs in one month.
- [ ] PhilHealth floor/ceiling and monthly aggregation are independently reconciled.
- [ ] Pag-IBIG contribution ceilings, employer/employee shares, and monthly aggregation are independently reconciled.
- [ ] TRAIN withholding boundary cases are independently reconciled for supported pay frequencies.
- [ ] ₱90,000 13th-month/other-benefits pool is reconciled across multiple payroll runs and benefit sources.
- [ ] De minimis category ceilings reconcile period-to-date actual payments.
- [ ] Holiday, rest-day, OT, night differential, and overlapping premium combinations have golden cases.
- [ ] Retro pay, negative adjustments, final pay, unpaid leave, mid-period hire, and separation cases reconcile independently.
- [ ] Payroll recalculation invalidates stale approvals/exports where required.
- [ ] Released payroll is immutable except through explicit audited correction/reversal flows.

## Gate B — Pay Rules governance

- [ ] Worked-time premium golden cases pass.
- [ ] Holiday/rest-day premium golden cases pass.
- [ ] Overtime premium golden cases pass.
- [ ] Night-differential premium golden cases pass.
- [ ] Statutory floors cannot be reduced by configurable policy.
- [ ] Effective dating and overlapping policy versions fail closed.
- [ ] Organization, org-unit, employee, shift, and worksite targeting are deterministic.
- [ ] Missing targeting evidence fails closed rather than guessing.
- [ ] Policy approval, change history, actor, effective date, and payroll impact are auditable.
- [ ] Pay-rule accounting flags reconcile to taxable, SSS, PhilHealth/Pag-IBIG treatment where applicable.

## Gate C — WFM depth tied to payroll

- [ ] Schedule templates, assignments, overrides, swaps, split shifts, and overnight shifts have regression coverage.
- [ ] Punch pairing and break allocation fail visibly on ambiguous evidence.
- [ ] Attendance corrections require governed approval and snapshot protection.
- [ ] Actual OT is preserved even when authorization is missing or rejected.
- [ ] OT authorization failures become payroll review exceptions and never suppress statutory entitlement.
- [ ] Required vs scheduled vs actual coverage reconciles hours.
- [ ] Labor cost forecast vs actual reconciles to payroll-grade rates.
- [ ] Holiday/rest-day/worksite/shift classifications flow consistently from WFM evidence into payroll.
- [ ] Leave treatment is explicit and payroll fails closed when treatment is missing.
- [ ] WFM exceptions have owner, status, SLA/age, evidence, resolution, and audit trail.
- [ ] Employee self-service schedule/attendance actions respect tenant and role scope.
- [x] WFM-to-payroll handoff has an end-to-end fresh-tenant pilot covering schedule -> punches -> persisted exception -> four-eyes correction approval -> payroll trace (`scripts/pilot-payroll-qa.ts`; CI: Production Pilot Payroll QA).

## Gate D — HCM core supporting WFM/payroll

- [ ] Worker profile has effective-dated employment, org unit, manager, worksite, job, pay, and schedule assignments.
- [ ] Job families, profiles, grades/levels, skills, positions, and incumbency are authoritative and effective-dated.
- [ ] Position status and headcount ledger reconcile requested, approved, open, filled, frozen, and closed states.
- [ ] Employee lifecycle events cover hire, transfer, promotion, pay change, manager change, worksite change, leave, separation, and rehire.
- [ ] Lifecycle changes that affect pay/WFM trigger explicit downstream impact review.
- [ ] Onboarding/offboarding provisioning and access removal are auditable.
- [ ] HCM analytics are tenant/RBAC scoped and derived from authoritative lifecycle records.
- [ ] No HCM workflow silently rewrites payroll history.

## Gate E — Workforce planning and compensation

- [ ] Annual/quarterly workforce plan versioning.
- [ ] Requested vs approved vs filled headcount.
- [ ] Scenario planning.
- [ ] Fully loaded Philippine labor-cost forecast using payroll and employer contributions.
- [ ] HR + Finance + hiring-manager approval workflow.
- [ ] Approved position -> requisition handoff.
- [ ] Budget variance by org unit and cost center.
- [ ] Attrition/backfill planning.
- [ ] Salary bands by job profile + level + location.
- [ ] Compa-ratio and range penetration.
- [ ] Compensation review cycles, budget pools, recommendations, approvals, and audit.
- [ ] Approved compensation change creates an effective-dated pay revision.
- [ ] Performance data may inform compensation but cannot automatically change pay.

## Gate F — Payroll operations, maker-checker, and recovery

- [ ] Five-role journey passes: HR -> Payroll Officer -> Checker -> Owner -> Employee.
- [ ] Payroll exceptions block release when required and expose a clear recovery action.
- [ ] Decline/resubmit/reapprove paths preserve evidence.
- [ ] Bank export totals reconcile exactly to released net pay.
- [ ] Payout reconciliation supports pending/succeeded/failed and failed-only retry.
- [ ] Payslip generation and delivery are idempotent.
- [ ] Email outbox exposes queued/sent/failed and failed-only recovery.
- [ ] Accounting journal totals reconcile to payroll.
- [ ] Every release has an immutable receipt and actor/timestamp evidence.
- [ ] Concurrency tests protect approvals, configuration changes, payout, and release.

## Gate G — Government outputs and external acceptance

- [ ] BIR Alphalist validated against the official workflow.
- [ ] BIR 2316 validated against representative employee cases.
- [ ] SSS R-3 validated against official acceptance.
- [ ] PhilHealth RF-1 validated against official acceptance.
- [ ] Pag-IBIG MCRF validated against official acceptance.
- [ ] Government output totals reconcile to payroll source records.
- [ ] Filing evidence stores period, source payrolls, generated artifact hash/version, actor, and validation status.
- [ ] Regulatory effective dates are versioned and historical payroll remains reproducible.

## Gate H — Security, privacy, and enterprise controls

- [ ] CI, CodeQL, and Security HTTP Smoke are required and green.
- [ ] Tenant isolation tests cover every payroll/WFM/HCM sensitive API family.
- [ ] Owner/HR/Payroll/Checker/Employee permissions have positive and negative tests.
- [ ] Bank data is encrypted at rest and legacy plaintext migration is proven complete.
- [ ] MFA/TOTP production encryption is configured and recovery paths are tested.
- [ ] Document uploads remain disabled unless fail-closed malware scanning is production-proven.
- [ ] Audit events cover pay-impacting configuration and privileged actions.
- [ ] Data retention, export, correction, and deletion workflows are tested under RA 10173 controls.
- [ ] OIDC readiness, then SCIM/SAML based on enterprise demand.
- [ ] Session/IP policy and permission-set roadmap remains after core payroll/WFM evidence gates.

## Gate I — Production proof

- [ ] Production reports the exact deployed Git SHA before readiness is evaluated.
- [ ] Production Rollout Readiness is green.
- [ ] Live five-role RBAC smoke is green.
- [ ] At least one real transactional email delivery is persisted.
- [ ] A controlled provider payout or signed-off manual bank-file payout is reconciled.
- [ ] Fresh non-demo payroll pilot completes without developer intervention.
- [ ] Independent expected payroll figures are prepared outside Linaw.
- [ ] Independent reconciliation confirms gross, premiums, deductions, tax, contributions, net, payout, payslip, and accounting totals.
- [ ] Production payroll pilot sign-off evidence is stored.
- [ ] Backup/restore, worker/scheduler, incident rollback, and operational ownership are documented and exercised.

## Gate J — Quality and release discipline

- [ ] No open PR is merged with failing required checks.
- [ ] Stale/superseded design and experimental PRs are closed rather than carried indefinitely.
- [ ] Dependency updates must pass the same payroll regression suite as product changes.
- [ ] Golden payroll cases are append-only unless a documented statutory or calculation correction explains the change.
- [ ] Every statutory logic change includes source/effective-date evidence and regression cases.
- [ ] Every launch claim distinguishes code-complete, pilot-ready, production-proven, and GA-ready.
- [ ] Roadmap status is updated from evidence, not feature count.

## Current priority

1. Make the Pay Rules golden reconciliation gate green and required.
2. Clear the remaining open PR queue without bypassing failed checks.
3. Keep the WFM-to-payroll fresh-tenant pilot green while expanding WFM regression depth.
4. Complete HCM lifecycle/position/headcount support needed by WFM.
5. Expand independent statutory reconciliation matrices.
6. Close production environment blockers and run the five-role pilot.
7. Obtain external government/bank acceptance evidence.
8. Only then widen compensation, enterprise identity, and analytics.
