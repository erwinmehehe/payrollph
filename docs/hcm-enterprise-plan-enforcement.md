# Enterprise HCM direct-route gate — opt-in engineering pilot

Status: **new PR, not production-enabled**. Protects Organization & Positions Explorer and Business Process Monitor, both read-only HCM capabilities, on **both** the rendered page and their JSON GET API.

## Preconditions and exact gate

The existing session/role, explicit employer ID, assigned organization scope, permission set and server-side feature flags must permit the request first. When the following are explicitly set in an isolated test/staging environment:

```
HCM_ENTERPRISE_PLAN_GATE_ENABLED=true
HCM_ENTERPRISE_PLAN_GATE_ORG_IDS=17
```

…the same employer must also have an active **Enterprise subscription** and the `advanced-hcm-discovery` feature. The selected legal employer is validated exactly (17 does not equal 170, 017, or 17.0). Existing production employers receive **no new billing reads or access changes** until opted in by exact ID.

A mere Enterprise account type without a subscription is **not sufficient**. The existing billing helper can infer that tier from organization type; the route guard explicitly rejects entitlement snapshots with `status="none"`.

### Responses

- No opt-in / other employer: preserve existing behavior.
- Opted-in, active Enterprise subscription with entitled feature: preserve original authorized read.
- Opted-in, inactive subscription, Core/Scale/Solo, feature not entitled, or missing subscription: HTTP 402 for GET API; UI fails closed without rendering tenant data.
- Entitlement source outage/missing snapshot: API 503, UI unavailable/404; never treat as Core or an empty source.
- No authenticated same-employer HR role/scope: preexisting 401/403/404 happens **before** billing. Do not expose subscription details to unauthorized actors.

## Scope limitations

This is a **defense-in-depth route-classification slice**, *not* a comprehensive Enterprise subscription paywall. It does not gate HCM Action Center, decision/inbox APIs, Planning, Compensation, onboarding, employee profiles, payroll, bank transfers, or HRIS employee self-service. Direct write workflows remain subject to their existing protections. Separately inventory all advanced HCM routes before promising universal plan enforcement.

## Required acceptance

- Exact-head CI with four payroll goldens, lint, typecheck, Next build and security checks.
- Test enabled and disabled modes; exact employer A vs B; missing/expired/inactive subscription; wrong role/permission set; billing outage.
- Synthetic browser/API negative tests for two employers and role-scoped actors. Human staging UAT remains separate.
- DO NOT set these environment flags on real employers before isolated testing, billing review and explicit rollout approval.

Rollback: unset `HCM_ENTERPRISE_PLAN_GATE_ENABLED`; no migrations, backfills, banks, payouts or government submissions.
