# HR case queue GET tenant isolation — independent family (2026-11-10)

This draft PR is separate from #1886 (workspace readiness) and #1887 (Worker 360 SSR). Scope is the HR-case **GET** handler, its tenant selector/SQL helper, focused regression tests, this note and a source-hash reconciliation in the existing tenant manifest. The **HR-case SSR page is unchanged**: it remains a GAP pending independent authenticated page proof.

## Change

- Staff GET requires exactly one canonical positive `organizationId`. Duplicates, missing employer, coercible numeric strings and unsafe IDs are refused before the staff/case read.
- Employee self-service GET preserves the no-selector behavior, bound to the employee linked to the authenticated session. Malformed/duplicated selectors fail with 400; an explicit foreign employer selector returns generic 404.
- After the existing employer membership, People/payroll role, session policy and custom-deny gates, the staff roster is loaded with **employer and authorized org-unit restrictions in SQL**. It no longer reads all employer employees before filtering in JavaScript. Company-wide HR/admin users retain company-wide access to their own employer; invalid unit scope fails closed.
- Protected GET and new refusals use private/no-store. POST, PATCH, approval, COE issuance and payroll behavior are unchanged.
- The manifest pins the revised route SHA and source method lines. All three existing HR-case API methods retain their **previous provisional COVERED classification**; this work grants **zero additional methods or page credits**. The unchanged SSR page retains GAP status.

## Acceptance and evidence

Focused `tests/hr-case-tenant-scope.test.ts` checks canonical selectors, SQL predicates, gate ordering and that the unchanged SSR page continues to reject invalid selectors. Source and unit assertions alone are not HTTP security acceptance.

Before merging or interpreting the route's latest source as independently accepted, review **the exact final branch head** in a dedicated fictional PostgreSQL 16 + actual production-mode HTTP run. Exercise two independently authenticated employer accounts, an existing higher-ID populated victim employer, nonempty own records, foreign employer/forged/duplicate selector denial, assigned-unit and unassigned/revoked permission denials, employee no-selector positive and foreign-selector refusal, and SQL snapshots preserving the victim's employee, case, message and audit rows. The repository's existing second-pass own/foreign checks are useful regression gates, but do not by themselves demonstrate every newly added selector/unit case.

Independent HR privacy/security review and maintainer merge approval remain mandatory. No production database, feature flag, provider, payment, employee data or deployment is changed by this draft.

**DRAFT / NO NEW TENANT COVERAGE CREDITS / NO MERGE OR DEPLOY UNTIL REVIEW.**
