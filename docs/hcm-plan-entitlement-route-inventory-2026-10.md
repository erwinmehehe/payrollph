# HCM route / plan boundary inventory — October 2026

This is a **source-entrypoint inventory**, not certification that every underlying query, direct API, custom permission set, or production employer is compliant with a plan. Classifications are intended for review before any real entitlement activation.

| Surface / representative route | Method(s) | Access policy at this milestone |
| --- | --- | --- |
| Organization Explorer: `/hcm/org-explorer`, `/api/hcm/org-explorer` | Page / GET | #835 merged: HR/tenant/feature first, opt-in Enterprise direct-page/API gate |
| Position history: `/api/hcm/position-history` | GET | #835 merged: companion direct API shares the gated Explorer boundary |
| HCM Process Monitor page/API | Page / GET | #835 merged: authorized HR and opted-in Enterprise gate |
| Action Center page | Page | #844 draft: opt-in Enterprise for advanced *page only* |
| Effective-dated Worker 360 page and source API | Page / GET | #844 draft: opt-in Enterprise; not equivalent to employee's ordinary self-service |
| Shared HCM inbox, `/api/hcm/business-processes/inbox` | GET / POST | **Keep assigned work and POST decisions available under original maker-checker, scope and permission checks**; #844 draft restricts only company-wide `recent` history projection for opted-in non-Enterprise employers |
| Business-process definitions, `/api/hcm/business-processes/definitions` | GET / POST | **This PR (#846):** opt-in Enterprise for designer reads and create/revise/activate/deactivate; auth, permission, origin, MFA, rate preconditions remain |
| People Operations inbox, `/api/hcm/people-operations-inbox` | GET | Ordinary People experience; existing tenant/role gating retained |
| Manager self-service: `/api/hcm/my-team`, `/api/hcm/manager-decision-inbox`, `/api/hcm/team-leave-calendar` | GET | Existing manager unit-scoping and pilot feature flags retained; not paywalled here |
| Employee lifecycle notifications, terms, probation, effective changes, documents and capabilities | Mixed GET / POST / PATCH | Mixed employment master, compliance and lifecycle sources; **not yet classified into billable depth vs essential core operations**; requires route-by-route review before any paywall |
| HR work items, events, escalation | GET / PATCH / POST | Operational case handling: not paywalled by this milestone, role/source checks require independent audit |
| Salary correction preview, `/api/hcm/salary-corrections/preview` | POST | Sensitive payroll-adjacent action; must not be gated purely by navigation or modified without money controls and financial UAT |
| Compensation, payroll-related approvals, workforce labor costing, workforce planning | Mixed | Advanced commercial modules **and** pay-critical dependencies overlap; explicitly deferred pending finance/HR process mapping and external acceptance |

## Safety principles

1. A visible navigation link is **never** an authorization grant. Continue enforcing on direct API, page and mutations after the selected employer, session, role and custom permission set are verified.
2. Do not paywall **completion of an already assigned employee review/approval** simply because its workflow was configured using an Enterprise designer. Keep maker-checker and original source authorization intact.
3. Subscription invalidity or billing outages on enrolled employers must never default to an inferred Enterprise tier, show source details or permit workflow configuration changes.
4. **Pilot preservation:** all opt-in gates default to OFF, require a global gate flag plus exact employer IDs, and incur no new billing query for unenrolled employers.
5. Before real activation: inventory active employer-specific definitions and pending approvals; provide the HR owner with emergency disable/rollback, explicitly verify billing status, negative-test other employers and capture operator sign-off.

## Next route audit candidates

- Configure vs execute: HCM lifecycle policy and term decisions; avoid withholding critical employment/legal rights because a paid plan lapses.
- Position, grade, compensation band, headcount planning and forecast reads/writes: distinguish planning features from authoritative employee/payroll sources.
- Governance readiness and HR case queue: classify read-only oversight without hiding operational blockers from owners.

**Never describe this inventory as full Workday parity or comprehensive API entitlement coverage.** Synthetic CI establishes source behavior only; real employer acceptance, external provider evidence and production launch controls remain separate.

## #850 source controls — opt-in advanced planning and compensation configuration

- **Existing default-OFF control (no new environment flag):** `HCM_ENTERPRISE_PLAN_GATE_ENABLED=true` **AND** `HCM_ENTERPRISE_PLAN_GATE_ORG_IDS=<explicit employer IDs>`. All other employers retain prior behavior without an added billing read. Clear either setting to roll back. No setting is activated by source integration.
- **Explicitly opted-in employers:** active **Enterprise** subscription with an actual billing record plus module entitlement (`advanced-workforce-planning` or `advanced-compensation-configuration`); missing subscription, inactive payment state or lower tier gives 402; billing unavailable gives 503. Original session, exact-employer membership, role/custom deny and unit checks occur first. Denied responses are private/no-store.
- **Advanced planning:** Planning GET, architecture creation (job family/level/grade/profile), plan creation and plan-linked position creation; direct allocations, baselines, scenarios, forecasts, forecast-plan, demand-handoff and published-plan position-execution APIs (GET/POST/PATCH). Do **not** mistake UI hiding for an API boundary.
- **Ordinary HR and financial continuity:** org-unit management, governed unlinked position creation, direct assigned worker changes, source-governed position lifecycle and `/api/workforce-planning/transfer` do not gain a paid gate. In-progress manager allocation decisions remain on original role/approval checks. Compensation GET continues the authorized payroll/proposal evidence, while creation of **new salary bands and cycles** requires the premium feature; existing proposals, recurring components and independent PATCH approvals remain unpaywalled. The Compensation page withholds only the band/cycle **creation forms** for enrolled lower tiers; it retains governed proposal/action views.
- **Release boundary:** exact-head CI/TypeScript/lint, direct-route negative tests and fictional role/employer browser and PostgreSQL acceptance before closing #850. No source PR merge enables the opt-in, modifies payroll amounts or authorizes real employer changes.
