import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/self/contribution-evidence/route.ts", "utf8");
const portal = readFileSync("src/components/self-service-portal.tsx", "utf8");

test("employee evidence export is scoped to the signed-in employee", () => {
  assert.ok(route.includes('user.role !== "employee" || !user.employeeId'));
  assert.ok(route.includes("eq(payrollEntries.employeeId, employee.id)"));
  assert.ok(route.includes("eq(payslips.employeeId, employee.id)"));
  assert.ok(route.includes("eq(statutoryRemittanceMembers.employeeId, employee.id)"));
  assert.ok(route.includes("eq(statutoryContributionIssueCases.employeeId, employee.id)"));
});

test("payroll evidence only uses released payroll for the requested month", () => {
  assert.ok(route.includes('eq(payrollRuns.status, "Released")'));
  assert.ok(route.includes("gte(payrollRuns.periodEnd, start)"));
  assert.ok(route.includes("lte(payrollRuns.periodEnd, end)"));
});

test("evidence pack cross-checks employee payroll deductions against remittance", () => {
  assert.ok(route.includes("employeeShareMatchesRemittance"));
  assert.ok(route.includes("employerShareMatchesRemittance"));
  assert.ok(route.includes("statutorySharesForEntry"));
});

test("filing evidence exposes hashes and match status without employer-wide totals", () => {
  assert.ok(route.includes("fileSha256: filing.fileSha256"));
  assert.ok(route.includes("matchedToRemittance"));
  assert.ok(!route.includes("reportedTotal: filing.reportedTotal"));
  assert.ok(!route.includes("employeeCount: filing.employeeCount"));
});

test("export is attachment-only, private and tamper-evident", () => {
  assert.ok(route.includes('schemaVersion: "linaw-statutory-contribution-evidence-v1"'));
  assert.ok(route.includes("buildContributionEvidencePack(payload)"));
  assert.ok(route.includes('"Content-Disposition"'));
  assert.ok(route.includes('"Cache-Control": "no-store, private"'));
  assert.ok(route.includes('"X-Content-Type-Options": "nosniff"'));
  assert.ok(route.includes("Employee statutory contribution evidence exported"));
});

test("employee portal exposes evidence downloads for contribution rows and reported cases", () => {
  assert.ok(portal.includes("/api/self/contribution-evidence?agency="));
  assert.ok(portal.includes("Download evidence"));
  assert.ok(portal.includes("Download case evidence"));
});
