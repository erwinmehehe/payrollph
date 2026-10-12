# Tenant report builder: engineering candidate

Status: **draft; feature OFF and no release acceptance implied**.

- Set `TENANT_REPORT_BUILDER_ENABLED=true` only after scoped role, export audit, and synthetic approval evidence. Migrations: none.
- UI: `/workspace/report-builder?organizationId=<authorized employer>`.
- Sources: current employee snapshot and tenant-scoped recorded departures; approved workforce timesheets and leave; **released** payroll entries. All source queries enforce `organization_id`.
- Dimensions: exact-match department/status/employment type. No user-supplied SQL. Max 366 days and 5,000 result rows.
- Salary/payroll costs are available **only** for `hr` and `payroll` roles, on top of membership, role gate, company-wide scope, and MFA.
- Payroll cost department means frozen payroll run scope (which may be unallocated). Current-unit historical time data is separately labelled; no false historical department attribution. Approved leave totals are used only when the entire leave interval fits inside the selected report window; partial overlap returns an explicit error rather than overstating absence days.
- `separatedCount` is a current employment-state snapshot. `turnoverCount` counts distinct employees currently marked Separated with a recorded last working day inside the selected date window, not an HR turnover percentage. Departures without a formal separation record are excluded; reconcile to HR records. `otLineCost` is only the saved `OT` payslip line, not a full reconciled OT premium cost. Independently reconcile before marketing those as complete measures.
- Every CSV export has an auditable SHA-256 receipt.
- No cross-entity group HR scoping is implied before multi-entity RFC approval.

Run `TZ=Asia/Manila npx tsx --test tests/tenant-report-builder.test.ts`, `npx tsc --noEmit`, `npm run lint`, all golden payroll suites and the full Asia/Manila suite prior to merge. Human security and payroll UAT are independent gates.
