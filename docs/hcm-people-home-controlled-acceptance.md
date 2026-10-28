# HCM People Home / My Tasks integration — controlled acceptance

Status (2026-10-28): source-level server minimization from PR #755, partial-source error handling from PR #1429, and synthetic membership-revocation QA from PR #1510 are merged on `main`. Issue #695 remains OPEN: signed-in deployed-app HR/security/operator acceptance, physical accessibility checks, and explicit employer activation approval are **NOT RUN / NOT APPROVED**. This document is a source/QA handoff, never authorization to enable payroll, bank, document, WFM, or HCM features.

## Scope

- One employer context chosen by the authenticated user; no implicit first-employer fallback on People Home.
- The server-side loader independently revalidates active company membership, company-wide People role, SSO/session policy, custom permission-set denials and the explicit tenant feature gate before reading source rows.
- Three distinct read-only source previews:
  - My HCM decisions: currently pending steps whose recorded assignee matches the signed-in user or their legitimate delegated role using the existing decision resolver.
  - People Ops follow-ups: bounded samples of unresolved lifecycle notifications and incomplete onboarding/offboarding provisioning only. These are NOT assigned approvals and do NOT represent the complete HR triage source.
  - Cases assigned to me: unresolved operational cases with the user explicitly recorded as owner.
- Decisions, HR source corrections and case updates remain in existing governed modules. No new action mutation, worker master, payroll rule, bank or schema migration is introduced.
- HCM decision preview examines at most 30 source candidates, batches membership/delegation checks in two tenant-qualified queries and fails the preview closed above 250 active delegation records, and returns up to five authorized rows. People Ops reads at most seven lifecycle rows and seven provisioning rows; owned cases read at most six rows. The UI presents only five per group, never a complete count.
- Source outages are rendered as unavailable, not an empty queue. Date-only lifecycle milestones are distinguished from true timed workflow deadlines. People Ops is always shown as a partial source sample.
- Payroll amounts, bank accounts, statutory IDs, performance scores, private notes and employee identifying fields are excluded from the People Home task projection.

## Activation gate

Both `HCM_PEOPLE_HOME_ENABLED=true` and `NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED=true` AND a canonical numeric employer in `HCM_PEOPLE_HOME_ORG_IDS` are required. The server route returns 404 if any check fails. Keep all three settings OFF/empty in production until protected staging and the named approvals in #695 are complete.

## Release checks before merge or enablement

1. Confirm exact draft PR SHA, reviewed diff and current-main compatibility. Run TypeScript, all applicable unit/integration tests, CI, CodeQL, Payout/Payroll Isolation, SQL history checks and build.
2. Use TWO fictional tenants with overlapping employee numeric IDs. Verify that explicit employer switches reload the authorized workspace; direct queries for non-members or employee-only memberships are rejected and do not silently fall back.
3. In the actual protected staging UI, check owner, admin, company-wide HR, company-wide bookkeeper, payroll, checker, employee, company manager and unit-scoped HR. Only company-wide People-authorized roles may open People Home.
4. Create pending HCM steps for a named user, a role and a delegate; also create an unassigned step and a maker-initiated approval. Verify assignments and maker-checker label agree with the authoritative HCM Inbox and no action is offered on People Home.
5. Create HR source findings (review, follow-up, neutral optional check) and a separately owned/unowned operational case. Verify no source check is labelled an approval, and the owned-case preview does not show unowned cases.
6. Test source failure, missing dates, 31+ pending BP candidates and more than five visible source items. The UI must not claim "all clear" or fabricate an exact decision count on a truncated candidate set.
7. Before trusting the displayed content, inspect the **complete server HTML/Next RSC response body and serialized DOM**, not only visible text. For both signed-in fictional HR users, reject any employee number shared across tenants, private employee/source label, case detail or pay-profile amount, even when hidden in script payloads. On an actual high-ID, feature-allowlisted foreign employer 404, verify both response body and rendered markup contain no victim markers. Source-only regression on a disposable PG16 localhost server does not replace real signed-in UAT.
8. Switch employer rapidly, refresh and deep-link from each People Home card. Confirm the link returns to the selected employer, the People screen and (for decisions) the expanded Employee administration/HCM Inbox panel. No stale tenant data should remain.
9. Synthetic Chromium verifies named screen-reader landmarks/articles, heading hierarchy, keyboard focus and 375px viewport. Protected staging must still cover zoom, real screen-reader interaction, slow-network/retry behavior and sanitized traces without real personal data.
10. Keep GitHub source merge authorization distinct from protected production deployment, real employer payroll validation, bank encryption, live DB migration and release committee authorization.

## Production hold

As observed on Oct 11, the GitHub main CI can pass while the Vercel production alias serves an older commit. Resolve exact SHA promotion and independently verify the latest live RBAC/readiness runs against that same SHA before describing any new HCM workflow as production-proven.

Related: #692, #695, #744, #112, #691 and #579.
