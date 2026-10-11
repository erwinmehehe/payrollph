# Enterprise workflow designer — opt-in authorization slice

**Status:** source PR, no production activation, no tenant enrollment, no live approvals or payroll touched.

## Target

Bamboo-simple HR tasks remain available to staff: employee directory, leave, onboarding, assigned HCM inbox and review/approval execution. The Workday-depth **workflow definition designer** (create, revise, activate/deactivate 1–12-step approval/review/to-do process definitions) becomes discoverable only when its authenticated same-employer source authorizes it, with an additional active Enterprise entitlement check for explicitly enrolled employers.

### Server enforcement (not menu-only)

`GET /api/hcm/business-processes/definitions?organizationId=N`:
- Session, explicit employer and existing company-wide People-admin permission checks happen first. For explicitly enrolled employers, the role is further limited to company-wide **owner, admin or HR**; a bookkeeper cannot configure approvers merely because the employer has an Enterprise plan.
- For `N` explicitly enrolled in `HCM_ENTERPRISE_PLAN_GATE_ORG_IDS` **and** `HCM_ENTERPRISE_PLAN_GATE_ENABLED=true`, source entitlements must confirm an active Enterprise subscription with `advanced-hcm-discovery`.
- On denial returns private no-store HTTP 402, or private no-store 503 on billing outage, before reading workflow-definition or supervisory organization rows.
- Non-enrolled employers retain the original response with no new billing query.

`POST /api/hcm/business-processes/definitions`:
- Same-origin, session, public-demo, company-wide permission, MFA and sensitive-action rate limiting remain required **before** entitlement lookup.
- Subscription gate executes **before** parsing `save` or `set-active` operations or touching any workflow definition row. Versions, status toggles and new rules share one protected entrypoint.
- Existing maker-checker and policy transaction serialization remain unchanged. This PR does not change execution or payroll authority.

### Interface

People workspace's process designer initially stays hidden until its own authorized GET succeeds. HTTP 402 `HCM_ENTERPRISE_PLAN_REQUIRED` or HTTP 503 `HCM_ENTITLEMENTS_UNAVAILABLE` suppress the designer rather than offer an edit button that cannot work. Other API errors show a retryable error. The component is keyed by the selected employer so no previously loaded definition/edit form can carry into another employer.

**This is not a paywall on the ordinary HCM inbox.** Source-bound `GET/POST /api/hcm/business-processes/inbox` and existing worker decisions remain governed by their original assignment, unit scope and maker-checker controls.

### Synthetic acceptance

The dedicated disposable PostgreSQL 16 / Chromium workflow checks:
- Active Enterprise HR can read configuration; an invalid POST reaches validation but writes nothing.
- Core HR cannot GET configuration or POST invalid configuration action even if HR member of both employers.
- A manager and a company-wide bookkeeper cannot read or configure workflow definitions despite Enterprise employer status.
- Unauthenticated user gets 401 before any plan lookup.
- The source contracts ensure both route methods guard before reads/mutations and do not add a gate to assigned decision endpoints.
- Previously green HCM navigation, source-security, restore, CodeQL, payroll goldens and full CI must remain green on the **same exact SHA**.

### Real employer pilot gates remain OPEN

Before enabling this flag for a real employer, review every currently active definition and any in-flight requests; ensure authorized emergency disable/recovery if subscription changes or billing is unavailable; obtain HR owner sign-off; verify plan billing accuracy; conduct staged cross-employer UAT and backup/restore. No production launch is authorized by passing synthetic CI.

**Rollback:** unset `HCM_ENTERPRISE_PLAN_GATE_ENABLED` for the employer or remove that employer's ID from the allowlist. No schema migration, employee mutation, payout, filing or irreversible state change.
