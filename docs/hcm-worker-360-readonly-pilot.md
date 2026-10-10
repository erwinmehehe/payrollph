# Linaw Worker 360 — read-only pilot and release gates

Status: **DRAFT SOURCE CODE ONLY.** No claim of protected staging acceptance, employer approval, production deployment, or payroll certification. Tracks #700 and PR #701; separate from People Home PR #694 review.

## Scope and feature switches

Both switches are **OFF when absent**. Do not activate in a live employer environment from a code merge.

- Server-only: HCM_WORKER_360_ENABLED=true exposes the authenticated page and read-only GET API.
- Client build-time: NEXT_PUBLIC_HCM_WORKER_360_ENABLED=true adds the link in the People workspace for eligible HR operators.
- Pilot activation requires the release owner to configure both in a **protected synthetic staging environment** and rebuild/redeploy; public flag alone does not expose data while the server switch is off.
- Disable the server flag (then redeploy) to shut the endpoint and page. Turning off only the public flag hides navigation but is **not** an authorization control.

No database migration, employee write, salary, benefit, loan, bank action, payroll approval, pay release, government ID display or automation is introduced.

## Read-only API contract

GET /api/hcm/worker-360?organizationId=POSITIVE_INTEGER&employeeId=POSITIVE_INTEGER&asOfDate=YYYY-MM-DD

- Organization and employee IDs are required; never infer a primary membership. Date defaults to the Philippine business date via Asia/Manila.
- Authorization: authenticated session, active requested-employer membership, session policy, people.admin custom deny-only permission overlay, company-wide owner/admin/hr role. Bookkeeper, payroll, checker, manager, employee, nonmember, inactive or org-unit-scoped HR are denied.
- Tenant scope: both organization and worker IDs apply to each database source query.
- Employee identity is labeled **current**, not a historical reconstruction. Fields: id, employeeNo, name, currentTitle, currentStatus, startedOn. No bank, salary, government identifiers, private notes or audit metadata.
- As-of primary position assignment: effective_from at or before selected date, effective_until null or at or after selected date, assignment_type primary. Fetch at most two rows; zero means not_recorded, one recorded, two ambiguous (fail closed).
- Employment-event preview: effective date at or before selected date, newest-first by date and source ID; fetch 26 for at most 25 displayed with correct hasMore. Only event ID, date, code and linked assignment ID. Not proof of complete employee history or statutory compliance.
- Responses must be private/no-store. Source-read failure is unavailable, not zero/all-clear. Aborted requests and scope-validated responses prevent stale UI after date changes.
- Data remains in original source tables. Current position metadata cannot be used to infer past job titles or organizational membership.

## Mandatory synthetic test matrix

| Scenario | Expected |
| --- | --- |
| Owner/admin/HR, active company-wide, people.admin permission | Can query specifically authorized tenant and worker |
| Custom permission set denies people.admin | Denied without employee details |
| Payroll-only, checker, employee, bookkeeper, scoped HR, manager | No Worker 360 access |
| User in Employer A requests Employer B | Denied, no source data |
| User belongs to A and B, same numeric employee ID in both | Only the explicitly requested employer's source records |
| Invalid tenant, worker or calendar date | Rejected |
| One primary assignment on requested date | Recorded source ID, inclusive boundaries |
| Two overlapping primary assignments | Ambiguous; no guessed position |
| No historical primary assignment | Not recorded; do not claim no job |
| Future events | Omitted from historical event preview |
| 26+ eligible events | At most 25 displayed with hasMore true |
| No event records | Source missing state, not complete history claim |
| Source outage, 403, delayed response followed by changed date | Unavailable, no stale employee data visible |
| Keyboard, mobile, screen-reader and zoom | Accessible date control, status messages and timeline |
| Payroll/employee write paths before and after pilot | No change to business workflow or money movement |

## Release NO-GO gates

1. Exact-head TypeScript, lint, unit tests, build, security checks and payroll regression checks.
2. Independent HCM, security/privacy and database review of source/role/field authorization, performance and as-of semantics. Static tests alone cannot certify isolation.
3. QA with synthetic two-employer staging fixtures, negative-access logs, date edge cases, mobile/keyboard testing and evidence of flag rollback. No real employee PII in screenshots.
4. HR-operator acceptance that "current" identity and as-of employment history cannot be confused.
5. Separate release-owner approval. Code merge never implies feature activation, payroll acceptance or live provider readiness.

## Follow-on; out of scope for current pull request

- Fully paginated event history and provenance links to existing authenticated source views.
- True versioned job/organization snapshots when business evidence supports them.
- Independently scoped manager/supervisor self-service.
- Employer DPO/PIA, performance and operational validation.
