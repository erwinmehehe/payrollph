# HCM connected navigation — employer-scoped engineering acceptance

**Status:** Development candidate, not a production rollout. No code in this work enables disabled HCM features, authorizes payroll, changes database schema, or creates employee records outside disposable CI.

## Product scope

This connects the already-source-governed People Home (merged #755), Worker 360, and Business Process Monitor (merged #768) with a small shared server-rendered navigation strip. It uses only the already-authorized employer and employee context from each page; it does not add a new worker master, access policy, workflow decision, or cross-employer search.

- **People Home:** the employer remains explicit in every link. The Home and Process Monitor appear only when both their server and navigation gates authorize this employer and the signed-in company-wide role.
- **Business Process Monitor:** one-click return to People Home, without losing the selected employer, while all workflow decisions remain in the authoritative People HCM Inbox.
- **Worker 360:** a Worker 360 self-link is possible only when a **positive, explicit employee ID** is already present. The existing return-to-People link now retains `organizationId`, instead of falling back to the user's first/default employer.
- **Permissions:** company-wide HR/owner/admin may discover People Home, Monitor and Worker 360 only when corresponding feature flags allow. A company-wide bookkeeper may discover People Home but not the restricted Monitor or Worker 360. Unit-scoped HR, employee, manager, payroll and checker receive no privileged HCM navigation from this component.
- **Feature switches:** navigation visibility is not authorization. Each destination independently enforces its original server-side membership, custom-deny, session and role checks. The shared links are a read-only projection from flags and already-authorized context.

## Synthetic engineering proof

- Unit tests: explicit positive numeric employer and worker IDs; per-employer feature allowlists; missing flag; narrower process/worker rights; bookkeeper distinction; unit-scoped and role-negative scenarios; exact links and `aria-current`.
- Browser QA: local PostgreSQL 16 in GitHub Actions, two fictional employers IDs 1/2, one fictional worker and fictional HR/bookkeeper/manager/payroll/checker/employee/scoped HR/custom-denied HR accounts. HR completes Monitor → People Home → Monitor round-trip and Worker 360 → Monitor; links retain employer/worker; changing the employer updates every destination; finance users see only allowed navigation; 375px viewport remains overflow-free.
- Source labels, worker identity, private notes and pay amounts are never added to the navigation. It contains no database queries, mutations, payroll/release decisions, or third-party calls.

## Release conditions

1. Verify exact-head TypeScript, full CI, isolated HCM browser QA, security, CodeQL, and payout/payroll isolation. A historical green run does not cover a later commit.
2. Independently verify keyboard, screen-reader, 200% zoom, disabled flags and real employer switching in a protected synthetic environment, **before** enabling an organization.
3. Obtain independent People/HR and privacy/security reviewer sign-off. Keep finance release, bank encryption and production routing gates from #112, #695 and #744 separate.
4. Do not enable `HCM_PEOPLE_HOME_ENABLED`, `HCM_PROCESS_MONITOR_ENABLED`, or `HCM_WORKER_360_ENABLED` in live production merely because a navigation PR merged.

This milestone is navigation integration only; existing HCM modules, authority and workflow decisions remain unchanged.
