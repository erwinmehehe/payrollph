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

## Pre-client HCM integration policy — no staging prerequisite (October 11, 2026)

**Decision:** A dedicated Vercel staging project, a separate remote staging database, the optional `hcm-staging-isolation` attestation, and protected remote UAT are **not required** to review, merge or locally verify this HCM integration while no employers are using the product.

- Use exact-commit GitHub CI, TypeScript, CodeQL/security/payroll-isolation, and automated browser checks backed by disposable local PostgreSQL with fictional employers. These are the engineering merge gates, not a staging deployment.
- The authorized maintainer checks the changed diff, retains feature flags and confirms negative role/tenant cases, deep links, privacy minimization, keyboard/mobile behavior and default-off route/API behavior. Recheck after every source commit.
- Manual screen-reader, 200% zoom and HR/privacy review are valuable improvements before onboarding live employers; they are not pre-client source-merge gates. Do not fabricate completion of those checks.
- If remote preview testing is ever desired, **do not run the synthetic fixture against an existing external database**. The existing Vercel project's Preview and Production database variable targets overlap; a separate synthetic database would then be required for that optional remote test, not for merging code.
- Real employer data, payroll releases, bank credentials, provider transfers and schema/backfill operations have their own safeguards. This policy does not authorize those operations.

## Source integration acceptance

1. Confirm the **current PR head** passes TypeScript, full CI, isolated HCM browser QA, security/CodeQL, and payout/payroll isolation. Old-head success is not evidence for a newer head.
2. Maintainer verifies employer/worker scope, denied-role boundaries, safe source data, navigation behavior, and feature-off recovery in disposable synthetic tests. No dedicated staging deployment or independent staging sign-off is needed.
3. Once checks and diff review pass, source may be merged under the repository's change-risk policy; external GitHub review is not mandatory unless a separate requirement genuinely applies.
4. Keep HCM activation explicitly controlled. Merging does not by itself authorize enabling these features against real employers or modifying live payroll/payouts.

This milestone is navigation integration only; existing HCM modules, authority and workflow decisions remain unchanged.
