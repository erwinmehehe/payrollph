# HCM connected navigation — employer-scoped engineering acceptance

**Status:** Development candidate, not a production rollout. No code in this work enables disabled HCM features, authorizes payroll, changes database schema, or creates employee records outside disposable CI.

## Product scope

This connects the already-source-governed People Home (merged #755), Worker 360, and Business Process Monitor (merged #768) with a small shared server-rendered navigation strip. It uses only the already-authorized employer and employee context from each page; it does not add a new worker master, access policy, workflow decision, or cross-employer search.

- **People Home:** the employer remains explicit in every link. The Home and Process Monitor appear only when both their server and navigation gates authorize this employer and the signed-in company-wide role.
- **Business Process Monitor:** one-click return to People Home, without losing the selected employer, while all workflow decisions remain in the authoritative People HCM Inbox.
- **Worker 360:** a Worker 360 self-link is possible only when a **positive, explicit employee ID** is already present. The existing return-to-People link now retains `organizationId`, instead of falling back to the user's first/default employer.
- **Permissions:** company-wide HR/owner/admin may discover People Home, Monitor and Worker 360 only when corresponding feature flags allow. A company-wide bookkeeper may discover People Home summaries, but not the restricted Monitor, Worker 360, HCM Inbox or People directory, because the bookkeeper workspace role page list excludes People. Source links to that unavailable workspace are presented as non-actionable guidance. A forged `workspacePage=People` URL must not bypass the existing role page list. Unit-scoped HR, employee, manager, payroll and checker receive no privileged HCM navigation from this component.
- **Feature switches:** navigation visibility is not authorization. Both the server and public discovery switches must permit a Monitor or Worker 360 link even for the **current page**; a selected-tab self-link cannot bypass disabled public navigation. Each destination independently enforces its original server-side membership, custom-deny, session and role checks. The shared links are a read-only projection from flags and already-authorized context.

## Synthetic engineering proof

- Unit tests: explicit positive numeric employer and worker IDs; per-employer feature allowlists; missing flag; narrower process/worker rights; bookkeeper role page list and forged deep-link denial; unit-scoped and role-negative scenarios; exact links and `aria-current`.
- Browser QA: local PostgreSQL 16 in GitHub Actions, two fictional employers IDs 1/2, one fictional worker and fictional HR/bookkeeper/manager/payroll/checker/employee/scoped HR/custom-denied HR accounts. HR completes Monitor → People Home → Monitor using keyboard activation, follows HCM Inbox into the expanded authoritative People panel, and loads the fictional Worker 360 source before returning to Monitor. Links retain employer/worker; changing the employer updates every destination; finance users see only allowed navigation. Monitor and Worker 360 are checked at a 375px viewport, Worker 360 is checked for 320 CSS-pixel reflow, and the three HCM pages undergo a pinned axe-core semantic-rules audit. The Worker 360 API is checked for no-store, wrong-employer worker denial, finance-role denial and rate minimization. A disabled server process proves both Monitor and Worker 360 page/API kill switches.
- Source labels, worker identity, private notes and pay amounts are never added to the navigation. It contains no database queries, mutations, payroll/release decisions, or third-party calls.

## Protected staging status and evidence boundary (October 11, 2026)

- **NO-GO: protected remote staging is not established.** Direct connected Vercel project inspection shows no custom environments. The current project's sensitive `DATABASE_URL` and `DATABASE_URL_UNPOOLED` entries both target Preview **and** Production; Vercel Authentication alone does not isolate their data.
- No deployment on PR #773's exact SHA in the existing Vercel project has been verified. The repository already has `.github/workflows/hcm-staging-isolation.yml` and `docs/hcm-staging-isolation-runbook.md`, but the protected manual attestation cannot be claimed until a separate project, new synthetic-only PostgreSQL database and approved read-only verifier are provisioned.
- Isolated GitHub Actions synthetic browser QA proves only the source-built candidate and fictional tenants, **not** protected Vercel staging, manual 200% browser zoom, screen-reader behavior or human acceptance. Automated axe-core semantic checks are a subset, not a complete WCAG audit.
- Required human evidence (unfilled): staging operator / exact deployment SHA / separate DB attestation / HR reviewer / privacy-security reviewer / keyboard + 200% zoom + screen reader observations / rollback owner and result. Do not fill these from CI bot runs.
- Keep all HCM production flags OFF and this PR draft until protected staging evidence and operator decision are recorded; see #695, #733, #734, #112 and #744.

## Release conditions

1. Verify exact-head TypeScript, full CI, isolated HCM browser QA, security, CodeQL, and payout/payroll isolation. A historical green run does not cover a later commit.
2. Independently verify keyboard, screen-reader, 200% zoom, disabled flags and real employer switching in a protected synthetic environment, **before** enabling an organization.
3. Obtain independent People/HR and privacy/security reviewer sign-off. Keep finance release, bank encryption and production routing gates from #112, #695 and #744 separate.
4. Do not enable `HCM_PEOPLE_HOME_ENABLED`, `HCM_PROCESS_MONITOR_ENABLED`, or `HCM_WORKER_360_ENABLED` in live production merely because a navigation PR merged.

This milestone is navigation integration only; existing HCM modules, authority and workflow decisions remain unchanged.
