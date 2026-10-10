# PayrollPH — Enterprise HCM experience blueprint

Status: **Architecture / delivery proposal; not production acceptance.**
Updated: 2026-10-10
Tracking issue: [#692](https://github.com/erwinmehehe/payrollph/issues/692)
Existing epics: [#194](https://github.com/erwinmehehe/payrollph/issues/194), [#581](https://github.com/erwinmehehe/payrollph/issues/581), [#601](https://github.com/erwinmehehe/payrollph/issues/601), [#610](https://github.com/erwinmehehe/payrollph/issues/610).

## Product north star

An original, Workday-inspired **Philippine People Operating System**, built around an authoritative worker/employer relationship, versioned employment history, positions, supervisory organizations, role-appropriate action queues, controlled business processes, and verified Philippine work-to-pay evidence.

The objective is **connected experience and enterprise governance, not cloning Workday or reproducing its proprietary UI**. The existing four product pillars remain authoritative in their respective domains: Payroll, HRIS, WFM and HCM. The HCM workspace is an orchestration and evidence *projection* above the existing sources, not a duplicate writable worker master.

Benchmark references: [Workday HCM overview](https://www.workday.com/en-us/products/human-capital-management/overview.html), [Workday HCM Admin Hub](https://doc.workday.com/admin-guide/en-us/human-capital-management/hcm-hubs/reference--hcm-admin-hub.html), [Workday Skills Cloud](https://www.workday.com/en-us/products/human-capital-management/skills-cloud.html).

## Simulated cross-functional panel — review lenses

| Discipline | Principal design requirement |
| --- | --- |
| CHRO / Philippine HR lead | A worker's hire-to-exit lifecycle and next action must be understandable without navigating six independent modules |
| HCM solution architect | Supervisory orgs, job profiles, positions, worker effective-dated events and HCM business processes are authoritative and reusable |
| Product manager | Complete high-value manager/HR workflows before adding a broad training/engagement/talent marketplace |
| Philippine payroll practitioner | HR/WFM changes must carry provenance into payroll cutoff; no auto-change to released wages or payout instructions |
| Privacy / security engineer | Tenant, legal-employer, supervisory-org and field-level access; no salary, ID number or private performance note in generalized task results |
| Engineering / DBA | Source-linked projections, idempotent transitions, serializable governance where needed, bounded queries, append-only migration discipline |
| UX / accessibility | One consistent People Home, employee context, approvals, manager tasks, mobile and keyboard/focus access |
| QA / SRE | Source-specific integration tests, two synthetic employers with overlapping IDs, time boundaries, rollback/degraded-mode, exact-head CI and staging UAT |

These are role perspectives for product design; they are not claims that outside human professionals have reviewed or signed off.

## Repository reality (code exists vs operational proof)

Inspected on main at `8043e3e` (2026-10-10). This is a source inventory, **not** evidence of applied production migrations or completed user acceptance.

| Area | Current source evidence | Assessment / next gap |
| --- | --- | --- |
| Core employee, organizational and employment history | `src/db/schema.ts`, `src/app/api/employees/route.ts`, `src/lib/hcm-effective-changes.ts`, `src/app/api/hcm/worker-profile/route.ts` | Strong foundation; unify as-of worker context and prevent direct-route governance bypass |
| Supervisory org, jobs and positions | `src/lib/hcm-business-process.ts`, `src/lib/hcm-position-assignment-guard.ts`, `src/app/api/workforce-planning/route.ts` | Existing effective-dated position controls; improve HR/manager usability and safe org-chart visualization |
| Governed HCM business processes | `src/lib/hcm-business-process.ts`, `src/app/api/hcm/business-processes/inbox/route.ts` | 8 process types, sequential approval/review/to-do model; send-back/rescind, safe conditional routing and full process monitor need follow-on |
| HR operations and next actions | `src/components/hcm-people-operations-inbox.tsx`, `src/app/api/hcm/people-operations-inbox/route.ts`, `src/app/hcm/work-items/page.tsx` | Separate source triage, task inbox and persisted cases; no consolidated role-aware HCM home |
| Connected worker journey | `src/lib/hcm-worker-journey.ts`, `src/components/hcm-worker-journey-panel.tsx` | Source-linked seven-stage view; no single action/timeline surface, and missing links must not be inferred as employer failure |
| Workforce planning, recruiting, compensation | `src/app/api/workforce-planning/`, `src/app/api/recruitment/`, `src/app/api/compensation/route.ts` | Substantial source code; verify end-to-end handoff, effective-date locks and cost/role redaction |
| Performance, skills and development | `src/app/api/performance/`, `src/lib/hcm-talent-continuity.ts` | Strong performance depth; broad LMS / learning catalog is not a current dedicated module |
| Benefits, absence, WFM and payroll | `src/app/api/benefits/`, `src/app/api/leave/`, `src/app/api/workforce-planning/` and payroll APIs | Connected sources; maintain Philippine labor/payroll calculation and evidence boundaries |
| Identity and access | `src/lib/oidc.ts`, `src/lib/scim.ts`, `src/lib/saml.ts`, `src/lib/access.ts` | Source integration exists; real provider acceptance, delegation semantics and field-level privacy tests remain distinct |
| Intelligence | `src/components/workspace/people-intelligence.tsx`, `src/lib/hcm-people-intelligence-server.ts` | Reporting foundation; strengthen as-of snapshots, data lineage, access, and action-oriented drilldowns |

## Workday-style experience model for PayrollPH

### Shared navigation, tailored by persona

- **Employee:** My Home → profile and requests → time/leave/pay → documents → performance and development.
- **Manager:** My Team → approvals / reviews → staffing and positions → goals / performance → people changes. Only employees within authorized supervisory scope.
- **HR operations:** People Home → My Tasks → Worker 360 → Organizations & Positions → Recruiting & Onboarding → Employment Changes → Separation → Reports.
- **HR / Finance leader:** Prioritized work and exception ownership, approved workforce plan and privacy-scoped cost analysis; no ordinary HR user should inherit payroll release or bank authority.
- **Security / IT:** Access provisioning, joiner/mover/leaver tasks, scoped identity controls and logged exceptions.

A task must be *actionable only in its authoritative source*: approval in the HCM BP inbox, HR source check in its source module, case assignment in case management. An informational finding must never masquerade as an assigned approval.

### Data/control architecture

```
Tenant + legal employer + supervisory organization + scoped identity
                              |
               Canonical effective-dated sources
       HRIS worker / position / WFM / payroll / benefits
                              |
             HCM business-process coordination
       Frozen policy/version, assigned steps, audit trail
                              |
                Read-only work projections
       My Decisions | HR Follow-ups | Owned Cases
                              |
          People Home + Worker 360 + Manager Home
                              |
      Analytics / event ledger / approved integrations
```

No central HCM "status" can override the authoritative employment, pay, position or approval source. Cross-source views should expose `source`, `sourceId`, `observedAt`, `asOfDate` and completeness/authorization state. Aggregate views must not treat failed or incomplete source queries as empty or compliant.

## Delivery order

### Sprint 0 — model/permissions audit (short)

- Confirm source map and last-merge schema, HCM BP workflow and org-unit security; record data stewardship and all direct-write bypass routes against issue #610.
- Specify HR admin, manager, employee, payroll-only and auditor scopes by route and field.
- Choose employer context source; do not automatically use the user's first employer in multi-company mode.
- Define one thin normalized HCM work-projection contract, keeping per-source authorization.
- Capture the UI information architecture and two employer/persona acceptance scenarios.

**Definition of done:** signed-off technical proposal, zero production behavior change, reviewed security/tenant test plan.

### Sprint 1 — Unified People Home and My Tasks (issue #692)

- Build role-aware HCM entry point using existing authenticated routes.
- Show "My HCM Decisions", "People Ops Follow-ups" and "Owned Cases" as clearly separate sections.
- Keep source-linked navigation and a worker context card, without embedding a new approve/deny mutation.
- Handle loading / retry, unknown data, stale dates, pagination, keyboard/mobile, and privilege downgrade.
- Keep phase 1 read-only with no new DB migrations. Flag user-facing rollout if necessary.

**Definition of done:** exact-head unit/integration/browser tests; two-tenant wrong-ID denial; no sensitive generalized payload fields; realistic HR admin and manager staging scripts.

### Sprint 2 — Worker 360 and supervisory context

- A coherent as-of header: employee identity, legal employer, supervisory organization, manager, job/position, worksite, effective status.
- Timeline of *linked authoritative employment* events: hire, changes, approvals, position moves, absence, pay-review evidence, separation.
- Contextual task and action links, with explicit absence-of-evidence states; no shadow writable worker table.
- Org chart and vacancy views must use authorized hierarchy/position relationships; historical as-of reporting must not infer org ownership from today's assignment.

### Sprint 3 — Business Process Monitor and workflow completeness

- Monitor source-bound BP instances, pending steps, owners, due dates and failure states.
- Design send-back/correction/rescind before coding them; specify version and concurrency semantics.
- Preserve maker-checker, delegated approver and scoped authorization at action time, not only display time.
- Allow configurability only where policy and source transitions have deterministic, audited semantics.
- Payroll payout and bank instructions remain separate transaction owners.

### Sprint 4 — Manager self-service and decision-grade intelligence

- Manager "My Team" with scoped requests and payroll-safe leave/attendance exception handoffs.
- Published baseline vs actual headcount/position/vacancy and payroll-grounded cost reporting.
- Role-specific charts and audit-ready as-of exports with row-level scope, small-cohort privacy thresholds and explicit unknown states.

### Later, customer-validated only

Learning/LMS, broader succession and talent marketplace, engagement surveys, AI recommendations and global country expansion are not prerequisites for the Philippine HCM home. Extend these only after customers validate demand and payroll/WFM/HCM operational proof is in place.

## Safety, deployment and proof language

- No unreviewed source-field mutation, auto salary adjustment, bank data change, payroll release, money movement or live SQL migration from a Workday-style dashboard.
- Workflows cannot be self-approved; sensitive actions preserve multi-actor review and effective dates.
- Future module activation is independent of code merge. Do not widen manager permissions by reusing company-wide HR endpoints.
- Enforce tenant isolation at API and query layers. Apply as-of worker scope and field redaction, not only UI filters.
- Preserve NIST-aligned access management principles and Philippine data privacy handling; validate legal/statutory treatment with authorized employer professionals in the staging *application* (not by asking payroll staff to review TypeScript).
- Track four distinct proof states: **source built → CI validated → staging accepted → production proven**.
- Close release gates only with actual supporting evidence. Synthetic CI is not a real employer payroll or bank/government acceptance.

## First product acceptance walkthrough

A People admin selects Employer A, opens People Home, sees their authenticated HCM decisions, overdue source follow-ups and cases distinctly, opens one worker's linked position and pending approval, completes the approval in its *existing* governed module, refreshes and sees updated work status. They switch to Employer B: A's worker or task cannot appear, even when B has the same numeric employee ID.

A manager of one supervisory unit sees only authorized team context and assigned work. Payroll-only and employee accounts cannot open HR operational aggregates. A timed-out source shows "unavailable/partial" rather than "0 pending." None of these dashboard actions recalculates or releases payroll.

## Delivery references

Implementation ticket: [#692](https://github.com/erwinmehehe/payrollph/issues/692).
Related existing epics: [#581](https://github.com/erwinmehehe/payrollph/issues/581), [#601](https://github.com/erwinmehehe/payrollph/issues/601), route-bypass controls [#610](https://github.com/erwinmehehe/payrollph/issues/610), production gates [#112](https://github.com/erwinmehehe/payrollph/issues/112).
