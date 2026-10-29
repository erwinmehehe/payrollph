import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildWhitelistedReport, validateReportSpecification } from "../src/lib/hcm-report-builder";

test("whitelisted payroll cost grouping sums authorized rows and emits escaped CSV", () => {
  const report = buildWhitelistedReport(
    { dataset: "payroll", fields: ["department", "grossPay", "overtimeCost"], groupBy: "department" },
    "payroll",
    [
      { department: "Operations", grossPay: 2500.20, overtimeCost: 123.45 },
      { department: "Operations", grossPay: 1000.10, overtimeCost: 20.05 },
      { department: 'HR, "People"', grossPay: 700, overtimeCost: 0 },
    ],
  );
  assert.deepEqual(report.columns, ["department", "grossPay", "overtimeCost"]);
  assert.deepEqual(report.rows, [
    { department: 'HR, "People"', grossPay: 700, overtimeCost: 0 },
    { department: "Operations", grossPay: 3500.3, overtimeCost: 143.5 },
  ]);
  assert.match(report.csv, /"HR, ""People"""/);
});

test("salary fields are denied to checker, bookkeeper, manager and employee", () => {
  for (const role of ["owner", "checker", "bookkeeper", "manager", "employee"] as const) {
    assert.throws(
      () => buildWhitelistedReport(
        { dataset: "payroll", fields: ["grossPay"] }, role,
        [{ department: "A", grossPay: 120_000 }],
      ),
      /Salary fields require/,
    );
  }
});

test("report builder rejects arbitrary field names, filters and grouping", () => {
  assert.throws(
    () => validateReportSpecification({ dataset: "people", fields: ["tin"] }, "admin"),
    /Field is not available/,
  );
  assert.throws(
    () => validateReportSpecification({ dataset: "time", fields: ["overtimeHours"], groupBy: "overtimeHours" }, "hr"),
    /Invalid grouping/,
  );
  assert.throws(
    () => validateReportSpecification({ dataset: "people", fields: ["headcount"], filters: { basicRate: "1" } }, "hr"),
    /Invalid filter/,
  );
  assert.throws(
    () => validateReportSpecification({ dataset: "people", fields: ["status", "status"] }, "hr"),
    /Duplicate/,
  );
});

test("report builder does not include excluded groups and neutralizes formula injection", () => {
  const report = buildWhitelistedReport(
    { dataset: "people", fields: ["department", "headcount"], groupBy: "department", filters: { department: "=HYPERLINK(1)" } },
    "hr",
    [
      { department: "=HYPERLINK(1)", headcount: 1 },
      { department: "Other", headcount: 9 },
    ],
  );
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0]?.headcount, 1);
  assert.match(report.csv, /"'=HYPERLINK\(1\)"/);
});

test("grouping by status never aliases department to the status string", () => {
  const report = buildWhitelistedReport(
    { dataset: "people", fields: ["department", "headcount"], groupBy: "status" },
    "hr", [
      { department: "Operations", status: "Active", headcount: 1 },
      { department: "Finance", status: "Active", headcount: 1 },
    ],
  );
  assert.deepEqual(report.rows, [{ status: "Active", department: "Mixed", headcount: 2 }]);
});

test("payroll totals use centavo-safe aggregation without floating point drift", () => {
  const spec = { dataset: "payroll" as const, fields: ["grossPay"] };
  const report = buildWhitelistedReport(spec, "payroll", [
    { grossPay: 0.01 }, { grossPay: 0.02 }, { grossPay: 0.03 },
  ]);
  assert.equal(report.rows[0]?.grossPay, 0.06);
  assert.throws(
    () => buildWhitelistedReport(spec, "payroll", [{ grossPay: Number.MAX_SAFE_INTEGER }]),
    /centavo-unsafe/,
  );
});

test("large department cohort aggregates in bounded linear grouping work", () => {
  const people = Array.from({ length: 20_000 }, () => ({
    department: "Operations", status: "Active", headcount: 1,
  }));
  const report = buildWhitelistedReport(
    { dataset: "people", fields: ["headcount"], groupBy: "department" },
    "hr", people,
  );
  assert.deepEqual(report.rows, [{ department: "Operations", headcount: 20_000 }]);
});

test("HCM report route blocks unassigned or foreign legal-employer history before GET and POST", () => {
  const route = readFileSync(new URL("../src/app/api/hcm-report-builder/route.ts", import.meta.url), "utf8");
  assert.match(route, /entities\[0\]\.active !== true/);
  for (const table of ["employees", "payrollRuns", "orgUnits"]) {
    assert.ok(route.includes("isNull(" + table + ".legalEntityId)"), table + " null check");
    assert.ok(route.includes("ne(" + table + ".legalEntityId, employerId)"), table + " foreign check");
    assert.ok(route.includes("eq(" + table + ".organizationId, organizationId)"), table + " tenant check");
  }
  assert.match(route, /HCM_REPORT_ENTITY_ATTRIBUTION_REQUIRED/);
  assert.equal((route.match(/await authorize\(session\.id, organizationId\)/g) ?? []).length, 2,
    "both metadata GET and data POST must share the same attribution guard");
  assert.match(route, /Cache-Control": "no-store"/);
});
