import assert from "node:assert/strict";
import test from "node:test";
import {
  currentReportPreview, reportPreviewKey, selectedAuthorizedReportFields,
  type ReportPreviewSelection,
} from "../src/lib/hcm-report-builder-client";

const base: ReportPreviewSelection = {
  organizationId: 1,
  dataset: "people",
  fields: ["department", "headcount"],
  groupBy: "department",
  departmentFilter: "Finance",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
};

test("report preview becomes invalid after each query-affecting edit", () => {
  const key = reportPreviewKey(base);
  const response = { key, result: { rows: [{ department: "Finance", headcount: 5 }] } };
  assert.deepEqual(currentReportPreview(response, key), response.result);
  const changes: ReportPreviewSelection[] = [
    { ...base, organizationId: 2 },
    { ...base, dataset: "time" },
    { ...base, fields: ["department", "turnover"] },
    { ...base, groupBy: null },
    { ...base, departmentFilter: "Operations" },
    { ...base, startDate: "2026-09-01" },
    { ...base, endDate: "2026-11-01" },
  ];
  for (const change of changes) {
    assert.equal(currentReportPreview(response, reportPreviewKey(change)), null);
  }
  assert.equal(currentReportPreview(null, key), null);
});

test("unauthorized salary fields never enter the client request even if selected", () => {
  const fields = [
    { dataset: "people", key: "department" },
    { dataset: "payroll", key: "department" },
    { dataset: "payroll", key: "grossPay" },
  ];
  assert.deepEqual(
    selectedAuthorizedReportFields("payroll", ["grossPay", "department", "grossPay", "tin"], fields.slice(0, 2)),
    ["department"],
  );
  assert.deepEqual(
    selectedAuthorizedReportFields("payroll", ["department", "grossPay"], fields),
    ["department", "grossPay"],
  );
  assert.deepEqual(selectedAuthorizedReportFields("time", ["department"], fields), []);
});

test("query key uses the same trimmed department filter that the API receives", () => {
  assert.equal(reportPreviewKey(base), reportPreviewKey({ ...base, departmentFilter: "  Finance  " }));
  assert.notEqual(reportPreviewKey(base), reportPreviewKey({ ...base, fields: ["headcount", "department"] }));
});
