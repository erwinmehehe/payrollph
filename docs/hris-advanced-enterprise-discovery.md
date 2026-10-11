# Linaw HRIS — simple People Home with Enterprise-only HCM depth

Status: **Source PR / synthetic acceptance required**, not a production activation or a new full-module paywall.

## Product behavior

- **Default HR experience:** People Home navigation favors directory, inbox, and everyday HR follow-ups. Job/organizational and process-monitor tools are not permanently exposed in the top nav.
- **Progressive disclosure:** An initially closed, native-keyboard-accessible `<details>` section labeled **Advanced HCM tools** appears only when all of these hold:
  1. Authenticated owner/admin/HR actor has current company-wide access to the *explicitly selected legal employer* and its People Home feature gate is active.
  2. The source-of-truth `getEntitlements(organizationId)` returns **active Enterprise** subscription/account entitlement with `advanced-hcm-discovery` in the matrix.
  3. At least one advanced link is already independently enabled for that employer through the server source-navigation gates.
- Destinations are only existing **Action Center, Organization Explorer, Process Monitor** routes. No unreviewed workflow writes, salary changes, bank changes, approvals or payroll release are added by this navigation.
- HR command-palette employee matches show **employee number and job title**, never pay rate. The original selection still opens an authorized employee via the existing workflow.

## Explicit limits

**This controls discovery, not the underlying permissions or full plan entitlements for every HCM endpoint.** Existing HCM endpoints and the Planning/Compensation workspace still enforce their preexisting role/scope/pilot policies, and this PR intentionally does not alter grandfathered pilot access or billing. Do not advertise Enterprise as the sole way to reach those modules until a separately reviewed entitlement audit covers every direct API, mutation and browser route.

An entitlement/read failure hides the optional advanced discovery instead of failing the ordinary People Home. An invalid or unauthorized employer never gets an advanced link. Default application activation flags remain unchanged.

## Validation

- Exact-head unit, TypeScript, lint, full tests, four payroll goldens and Next build
- Enterprise (active), Enterprise (inactive), Core/Scale/Solo, HR company-wide, HR unit-scoped, manager, bookkeeper, employee, missing entitlement
- Employer A allowlisted advanced route versus Employer B without rollout flags
- Keyboard: activate summary, tab through existing links, leave panel collapsed by default
- Existing HRIS browser/tenant/manager/payroll/security gates unchanged
- Real untrained-HR task-time and 375px mobile UAT, external payroll acceptance and operational sign-off **still separately required**

**Rollback:** revert this UI/discovery source PR. No migration, data backfill, provider or transfer.
