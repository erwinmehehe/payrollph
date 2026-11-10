# Independent tenant-isolation batch: HCM payroll report employee binding (2026-11-10)

**Status: review candidate, no coverage credit, no deployment or merge authorization.**

## Boundary and source

The HCM report builder's payroll data loader joins released `payroll_entries` to an employer-qualified `payroll_runs` record and to an employee. Previously the employee LEFT JOIN matched only `payroll_entries.employee_id = employees.id`, then rejected mismatched employee employer IDs **after** the query. The final response already failed closed; this batch moves the employer condition into the employee JOIN so the database does not select a foreign employer's employee record when a corrupted or legacy entry points to it.

The join now requires **both** the employee ID and `employees.organization_id = organizationId`. Missing or foreign employee joins yield NULL; the existing post-query employee-employer and legal-employer attribution checks reject the **entire** report. They are not relaxed and no foreign wages or zero-filled fallback may be returned.

## Scope / independence

- Change: `src/lib/hcm-report-source.ts` employee LEFT JOIN only, plus a source-order regression assertion in `tests/hcm-report-source-db.test.ts`.
- The existing PG16 test already builds **two fictional employers**, distinct workers, legal entities, units and payroll runs, verifies one positive own-employer report, inserts a cross-employer worker link and requires an entire-report rejection. It also exercises wrong legal-employer references, restores the fixture, and verifies own results remain unchanged.
- Separate from the currently open HCM Process Monitor SSR (#1899), hire-to-payroll SSR (#1888), SSO discovery (#1894), disabled SAML (#1896), and filing evidence credit (#1893) batches.
- No shared tenant manifest or inventory guard edited, **zero new API-method or page/action coverage credits**; all existing classifications remain unchanged.
- No route signature, payment calculation, schema, release flag, scheduled worker, SAML/OIDC provider, money movement, customer record or external API changed.

## Verification before squash merge

- [ ] Exact-head `HCM Gaps Focused Acceptance` fictional PostgreSQL 16 behavioral test job passes (including `tests/hcm-report-source-db.test.ts`).
- [ ] Exact-head typecheck / build / standard CI and CodeQL security checks pass, with any source-pin or inventory drift addressed without credit inflation.
- [ ] Independent tenant-security and payroll privacy reviewer accepts the changed join semantics and the tested synthetic denial/own-success paths.
- [ ] Re-check up-to-date `main`, conflict-free squash eligibility and exact final commit SHA.

No claim of a production leak or global tenant-isolation certification. The prior post-query check already prevented a successful foreign-wage report; the improvement minimizes the foreign row selected by the database before refusal.
