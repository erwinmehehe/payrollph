# Linaw Workday-depth — Action Center and Worker 360 paid-view acceptance

**Scope:** controlled, read-only HCM discovery. This change is **stacked on PR #835** and must not merge before the Enterprise HCM base guard is merged and its exact-head CI is green.

## Behavior

Only employers explicitly enrolled by both:

```env
HCM_ENTERPRISE_PLAN_GATE_ENABLED=true
HCM_ENTERPRISE_PLAN_GATE_ORG_IDS=1,2
```

are checked against the actual selected employer's **active Enterprise subscription with `advanced-hcm-discovery` entitlement**. The organization ID list above is **fictional test fixture only**. Do not enable production enrollment using those values.

- `/hcm/action-center?organizationId=N`: gated after session, explicit employer, People Home rollout, HR authorization and company-wide organization scope.
- `/hcm/worker-360?organizationId=N&employeeId=E`: gated after session, explicit employer and worker, Worker 360 feature switch, employer-role and company-wide HR checks.
- `GET /api/hcm/worker-360?organizationId=N&employeeId=E`: same gate **before source read**, after tenant/role and as-of-date authorization/validation.
- The shared HCM business-process inbox `GET` still returns source-assigned `myWork` and actor-owned `submitted` under the original role/tenant constraints. For opted-in Core/inactive subscriptions, only the **company-wide `recent` history preview** is withheld: `meta.companyHistoryAvailable=false`, and `recent` contains only the actor's own submitted history instead. On Enterprise, the original authorized company-wide history remains available. Billing outages fail closed for that history alone, without blocking assigned decisions.
- Existing `org-explorer`, `position-history` and `process-monitor` endpoints remain covered by the base PR #835.
- Core/Scale/non-entitled or inactive enrolled employer: 404 page; private, no-store JSON API 402 with `HCM_ENTERPRISE_PLAN_REQUIRED`. Billing outage fails closed with 503 API and an unavailable page.
- Unenrolled employer: no subscription lookup and **no behavior change**. Feature rollout switches and HR permissions remain independent.

## Deliberately NOT gated

The assigned HCM business-process inbox's **`myWork` and `submitted` GET projections**, and its governed `POST`, are **not** paywalled. Those endpoints also serve ordinary HR follow-ups and assigned reviews; the POST independently checks assignment and maker-checker authority. Employee self-service, ordinary People Home, leave/time/payroll, manager My Team, on-call HR cases and financial approvals are outside this change. Paying for Enterprise never grants a permission.

## Evidence

The existing synthetic-only HCM Monitor Browser QA workflow runs **two isolated app instances** against fictional PostgreSQL 16 employers:

- Default-off regression: familiar HCM navigation, actual assigned source actions and Worker 360 remain accessible for authorized pilot roles. Login rate-limit state is reset only between fictional test suites, without relaxing production limits.
- Opted-in Enterprise: Enterprise HR sees Action Center and Worker 360 page and obtains the source-linked Worker 360 JSON; Core HR cannot open either page or fetch Worker 360 directly but **can fetch its own assigned HCM inbox**; a manager with an Enterprise employer is denied before billing; anonymous users get 401 from the worker API.

The tests deliberately do **not** perform HCM decisions, approve pay, mutate employee records, submit agency files or move money.

## Merge/release gates

Require exact-head CI, browser both modes, CodeQL, dependency/security smoke, tenant isolation, four payroll goldens, TS/Next build and controlled staged HR operator review. Do not claim complete enterprise parity or end-to-end HCM plan enforcement until all remaining direct pages/APIs and custom permission sets are inventoried.

**Rollback:** unset `HCM_ENTERPRISE_PLAN_GATE_ENABLED` for the opted-in employer or revert the new PR. No database migration or bank transfer.
