# HCM Document Renewal Watch — read-only pilot acceptance

Status: **draft PR #726, not live and not an employee-compliance certification**. This feature uses the existing hcm_employee_document_compliance, hcm_document_requirements and employees sources. It does not create a second policy/document master or initiate notifications.

## Operator experience

The existing **Documents** workspace gets two modes when the client navigation flag is enabled for a company-wide owner/admin/HR member: **Documents & policies** (unchanged) and **Document Renewal Watch**. The new mode offers search across employee name/number and document requirement code/name, status filters, expiry windows, source-record preview, and a **View employee** action.

The employee action uses the **already selected organization** and its current authorized employee roster. It opens the existing People employee drawer without inventing a new deep link or trusting a returned employee ID to select a different tenant. If that employee is not available in the current workspace roster, it fails with a notice rather than guessing an organization.

The renewal query is on /api/hcm/document-renewal-watch, with required positive organizationId, optional nonnegative cursor, 1-50 limit (UI uses 30), optional q (max 80 chars), state and expiry filters. Search and both filters apply in **SQL before keyset paging**. Previous/next navigation shows no guessed total, and the page summary is explicitly page-local.

## Authorization, data envelope and flags

- HCM_DOCUMENT_RENEWAL_WATCH_ENABLED=true is a **server-only gate**; absent means the API returns 404.
- NEXT_PUBLIC_HCM_DOCUMENT_RENEWAL_WATCH_ENABLED=true is a build-time **navigation gate only**; it cannot authorize the API. Both are OFF when absent, and both remain OFF in live environments pending release signoff.
- API requires an authenticated session, active requested-tenant membership, deny-only People admin custom permission, company-wide role **owner/admin/hr**. Bookkeeper, manager, scoped HR, payroll-only, inactive and foreign-tenant requests must not receive employee document data.
- SQL joins to employee and requirement require matching organization ID; no source data can be searched before access checks. No bank, compensation, government identity numbers, file bodies, file URLs, waiver reasons, or free-text notes enter the response.
- Responses are private, no-store. The client aborts stale requests, verifies the tenant and returned filter envelope, clears sensitive results on a failed request and refuses a cursor outside the expected order.
- Enabling the public flag without the server flag does not expose records. Disabling only public navigation is **not** a security rollback: switch off the server flag and redeploy.

## Source and date semantics

- All expiration and due comparisons use a Philippine Asia/Manila business date. Date-only values are not converted to browser-local calendar dates.
- Waivers are shown as waived, never assumed overdue. Recorded expiration earlier than today is expired; approaching expirations use the requirement's renewal lead days (clamped to 0-365), and missing submissions become overdue only after their recorded due date.
- Expiry filters: past expiry date or within the next 30, 60, or 90 days (including today). They restrict actual expiry dates even if a record is waived or otherwise already submitted.
- The watch includes materialized document compliance records and recorded expirations. It **cannot** prove that every required document record was materialized, uploaded, verified, or compliant. A missing row in this view is not an all-clear.
- An attached file reference is displayed as a boolean only; no download link is returned. All upload, waiver, verification and approval actions remain with the existing document workflow.

## Release NO-GO checks

- [ ] Exact-head CI, TypeScript, lint, Node tests, build, CodeQL, HTTP/security and payroll isolation checks pass.
- [ ] Two-employer synthetic database fixtures prove employer A search does not find employer B, even with overlapping employee names/numbers and matching document requirement codes.
- [ ] HR UAT compares a known record set against search and every status/expiry filter, including records beyond the first page, to establish that filters are source-wide.
- [ ] Validate expiring configured lead-day boundaries, Manila/UTC midnight, missing/overdue, waived/expired precedence, and exact cursor/page transitions.
- [ ] Negative-role tests: bookkeeper, manager, nonmember, scoped HR, restricted permission set, and direct API access with mismatched tenant.
- [ ] Verify employee navigation opens the matching employee in the selected employer; if the workspace has no such employee the action must fail closed.
- [ ] Mobile, keyboard, focus, screen reader, loading/error and rapid filter/tenant-switch tests; review the production flag rollback.
- [ ] Independent HR/security/DBA review and release-owner approval. Do not merge or activate merely because a source-code CI workflow succeeds.

## Out of scope

No automatic policy enforcement, statutory guarantee, auto-accepting an uploaded document, reminder dispatch, employee write, SQL migration, payroll/payout, or production-flag change.
