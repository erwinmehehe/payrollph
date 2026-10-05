import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("analytics exposes the existing payroll assurance engine as an auditable report", () => {
  const reports = read("src/lib/reports.ts");
  const route = read("src/app/api/reports/route.ts");
  const analytics = read("src/components/workspace/analytics.tsx");

  assert.ok(reports.includes('buildPayrollAssurance'));
  assert.ok(reports.includes('key === "assurance"'));
  assert.ok(reports.includes('orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id))'));
  assert.ok(reports.includes('built.assurance.findings'));
  assert.ok(route.includes('"assurance"'));
  assert.ok(analytics.includes('name: "Payroll assurance"'));
  assert.ok(analytics.includes("material employee-level changes"));
});
