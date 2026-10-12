# Core module navigation

Default off: CORE_MODULE_NAVIGATION_ENABLED=true. DEPENDS ON #865 canonical 0115-0121 source train; 0122 is not valid for isolated apply until the preceding migrations have reviewed journal receipts and a rehearsed database cutover. Apply drizzle/0122_tenant_module_disclosure.sql before any separately reviewed module activation (never use db:push on Neon production): old rows become all, future rows default core.

## Modules

New organizations start with `core` preferences. Existing organizations retain `all`
preferences and their original navigation. Flag-off navigation is also unchanged.
Core mode includes People, Time, Payroll, Reports and Settings, plus Dashboard and
Approvals so onboarding and independent checker work remain accessible. Reports
contains only the reports/exports the user's existing role permits.

Company-wide owner/admin/bookkeeper accounts can opt into module groups from More
modules. Choices are saved per tenant and shared by sidebar, mobile navigation and
command palette. An opt-in never adds role permissions or bypasses plan, MFA,
maker-checker or release gates. Hiding a module does not delete its data. Solo
workspaces retain their existing navigation.

The tenant core preference takes precedence over the older pilot-focused menu, so opt-ins and More modules remain reachable.

## Acceptance

Rendered new/existing navigation snapshots and role/solo restrictions; PostgreSQL migration rehearsal preserves existing tenants and defaults new tenants to core. Browser/role/phone evidence is required before activation.

## Screens and role states

| Screen | Roles | Empty/loading/error behavior | Phone/flag evidence |
| --- | --- | --- | --- |
| Core navigation | Existing role permissions; employee retains ESS | Dashboard loading stays unchanged; no optional pages until tenant opt-in; reports limited by existing permissions | Browser workflow captures 1280px/390px new versus existing tenant and flag-off nav |
| More modules | Company-wide owner/admin/bookkeeper; HR/manager/employee denied | No selections initially; saving status and disabled checkboxes; inline error alert and toast; persisted selections after refresh | Browser captures empty/enabled at desktop/phone; real local MFA login; unauthorized API denial |

Screenshots are synthetic acceptance evidence, not live employer approval. Artifacts exclude server logs, credentials, MFA secrets and session tokens. The workflow retains production MFA enforcement and signs in using a fictional account's authenticator code.
