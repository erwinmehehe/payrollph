import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LinawWorkspace } from "../src/components/linaw-workspace";

const initialData = {
  user: { id: 1, email: "demo@example.com", name: "Celine Yao", role: "bookkeeper", totpEnabled: false },
  organizations: [{ id: 1, name: "Mantra Studio", legalName: "Mantra Studio Co.", accountType: "business", plan: "Core", payrollAnnualDivisor: "365", employeeCount: 2, color: "#0073ea" }],
  selectedOrganization: { id: 1, name: "Mantra Studio", legalName: "Mantra Studio Co.", accountType: "business", plan: "Core", payrollAnnualDivisor: "365", employeeCount: 2, color: "#0073ea" },
  employees: [
    { id: 1, employeeNo: "E-001", firstName: "Aira", lastName: "Villanueva", title: "Engineer", employmentType: "Regular", status: "Active", avatarInitials: "AV", basicRate: "36500", mwe: false },
    { id: 2, employeeNo: "E-002", firstName: "Jonas", lastName: "Reyes", title: "Analyst", employmentType: "Regular", status: "Active", avatarInitials: "JR", basicRate: "30000", mwe: false },
  ],
  payrollRuns: [
    { id: 3, periodLabel: "Sep 16–30", scopeLabel: "Company", status: "Needs review", payDate: "2026-09-30", employeeCount: 2, grossPay: "66500", netPay: "58900", exceptions: 1, ruleVersion: "PH-2026.09", processedChunks: 3, totalChunks: 4 },
    { id: 2, periodLabel: "Sep 1–15", scopeLabel: "Company", status: "Released", payDate: "2026-09-15", employeeCount: 2, grossPay: "65000", netPay: "57700", exceptions: 0, ruleVersion: "PH-2026.09", processedChunks: 4, totalChunks: 4 },
    { id: 1, periodLabel: "Aug 16–31", scopeLabel: "Company", status: "Released", payDate: "2026-08-31", employeeCount: 2, grossPay: "64000", netPay: "56800", exceptions: 0, ruleVersion: "PH-2026.08", processedChunks: 4, totalChunks: 4 },
  ],
  payrollEntries: [
    { id: 1, employeeId: 1, grossPay: "36500", deductions: "4200", netPay: "32300", status: "Ready", trace: {} },
    { id: 2, employeeId: 2, grossPay: "30000", deductions: "3400", netPay: "26600", status: "Ready", trace: {} },
  ],
  payrollJobs: [{ id: 1, status: "processed", chunkIndex: 1 }],
  tasks: [],
  auditEvents: [],
  plans: [],
  templates: [],
  advisories: [],
  punches: [],
  delegations: [],
  leaveRequests: [],
  orgUnits: [],
  capabilities: { orgStructure: true, payroll: true, approvals: true, multiBranch: true, developer: true },
  provisioning: [],
  freelancer: null,
};

test("dashboard renders modern operational cockpit with interactive SVG visualizations", () => {
  const html = renderToStaticMarkup(React.createElement(LinawWorkspace, { initialData: initialData as any }));
  assert.match(html, /Operational cockpit/);
  assert.match(html, /Search or jump to/);
  assert.match(html, /aria-label="Net pay trend"/);
  assert.match(html, /aria-label="Net pay versus deductions"/);
  assert.match(html, /Payroll signal/);
});
