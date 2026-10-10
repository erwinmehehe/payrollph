# Manager Team Attendance & Shift Coverage Preview — gated pilot
**Status: draft, default OFF, not deployed or independently approved.**

## Source and scope
- Current Philippine business date only. No new attendance master, payroll formulas, schedule writes, approval actions, employee mutations, or staging/live database changes.
- Server flag `HCM_TEAM_ATTENDANCE_PREVIEW_ENABLED` defaults OFF; the direct page and API return 404. There is intentionally no navigation entry until protected pilot approval. An authorized staging operator must redeploy with the server flag ON to test; OFF + redeploy + direct 404 is rollback.
- Reuse current employee, org-unit scope, effective resolved WFM daily schedule and time-punch records. Explicit tenant, active organization membership, session-policy and deny-aware workforce.manage gate. Manager requires concrete current unit; bookkeeper, payroll, checker, employee and company-wide manager excluded.
- Bounded 10-worker page, 11th sentinel, at most 500 punch source records plus overflow sentinel. Current source rows are read only. Employees and punches are constrained by organization_id and authorized employee IDs. The underlying schedule evidence helper also scopes each schedule read by organization_id and employee_id.
- Client discards stale tenant/cursor responses and aborts superseded requests; private no-store response.
- **Interpretation:** counts refer to visible page's scheduled segments and stored punch rows. Punch count is not verified physical attendance, full-shift attendance, location, compensation or payroll minutes. Missing punches do NOT prove absence or a staffing gap. Unassigned/ambiguous schedules and partial punches require source review; no demand vs supply claim is made. Shift coverage is a planning preview, not capacity certification.

## Independent protected staging UAT
- [ ] Provision protected staging per #733 (Vercel project creation currently denied by 403) with *synthetic-only* isolated database and exact commit deployment.
- [ ] Verify flags OFF: direct API and page 404. Then authorized staging-only enable/redeploy to test.
- [ ] Two employers, overlapping employee numbers and foreign-unit links: deny cross-tenant and unitless/company-wide managers, inactive unit, custom permission deny, deactivated membership, bad session policy and direct URL guessing.
- [ ] Synthetic schedule cases: regular, overnight, split shift, approved override, unassigned, invalid schedule link, current day vs Manila midnight.
- [ ] Synthetic punch cases: no punch (must NOT label absence), completed, incomplete, duplicate source rows, and 501-record overflow => 409/no partial preview.
- [ ] HR/operations validate schedule semantics and conspicuous advisory labels; security/DBA inspect source predicates, query plans and N+1 bound (10 workers/page).
- [ ] Keyboard/screen reader/mobile pagination, errors, tenant switch, direct page and API flag rollback. Record reviewer signatures, exact SHA and private evidence IDs.
- [ ] Recheck all relevant CI, CodeQL, payroll isolation, build and typecheck results after the last code change. Draft remains NO-GO until independent signoff.

This is deliberately not a complete demand-based shift coverage calculator. A future source-certified worksite/shift demand comparison needs a separately reviewed requirement ledger and precise approved leave interval treatment before any gap computation.

## Engineering safety fixes in draft PR #736

- The server now uses a locale-independent Asia/Manila business date and independently validates active **and effective** supervisory unit dates against the selected employer. The UI shell and direct API remain default OFF.
- One-sided and entirely timestamp-free punch rows are recorded as **needs review**. An effective non-rest schedule with no shift segments is also **needs review**; a planned shift with no punches never becomes a confirmed absence.
- Synthetic two-tenant PostgreSQL regression tests exercise overlapping employee numbers, a cross-tenant time-punch/employee FK mismatch, scoped vs company-wide HR reads, a foreign unit reference, disabled/future-effective units and the 500+1 punch fail-closed limit.
- The full exact-head CI and CodeQL jobs must pass after the final source/test commit. These automated tests do **not** constitute a protected staging session or independent HR/security/DBA signoff.
