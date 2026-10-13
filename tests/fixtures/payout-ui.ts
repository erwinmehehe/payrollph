import type { DashboardData } from "../../src/components/workspace/types";

export function payoutUiFixture(xenditPayoutsEnabled?: boolean, role = "owner"): DashboardData {
  const organization = { id: 1, name: "Synthetic Payroll QA", legalName: "Synthetic Payroll QA",
    accountType: "company", plan: "Core", employeeCount: 1, color: "#1677ff" };
  return { user: null, organizations: [organization], selectedOrganization: organization,
    employees: [], payrollEntries: [], payrollRuns: [{ id: 1, periodLabel: "October 1–15, 2026",
      periodStart: "2026-10-01", periodEnd: "2026-10-15", scopeLabel: "All employees",
      status: "Released", payDate: "2026-10-15", employeeCount: 1, grossPay: "10000.00",
      netPay: "8000.00", exceptions: 0, ruleVersion: "PH-2026.01" }],
    tasks: [], auditEvents: [{ id: 1, actor: "Synthetic Reviewer", action: "Payroll release receipt",
      resource: "Synthetic payroll", metadata: { runId: 1 }, createdAt: "2026-10-15T00:00:00Z" }],
    plans: [], templates: [], advisories: [], freelancer: null,
    access: { role, companyWide: true, orgUnitName: null }, xenditPayoutsEnabled };
}
