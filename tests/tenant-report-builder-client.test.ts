import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizedReportBuilderSelection, tenantReportPreviewKey,
  type ReportBuilderCapabilities,
} from "../src/lib/tenant-report-builder-client";

const cap: ReportBuilderCapabilities = {
  organizationId: 101,
  fields: { people: ["department", "headcount", "status"], time: ["department"], payroll: [] },
};
test("no field permissions carry across an employer switch", () => {
  const a = authorizedReportBuilderSelection(101, "people", ["department", "headcount"], "department", cap);
  assert.deepEqual(a.fields, ["department", "headcount"]);
  const b = authorizedReportBuilderSelection(102, "people", ["department", "headcount"], "department", cap);
  assert.deepEqual(b.fields, []);
  assert.equal(b.groupBy, null);
  const disallowed = authorizedReportBuilderSelection(101, "payroll", ["payrollCost"], "", cap);
  assert.deepEqual(disallowed.fields, []);
});
test("preview and export signatures isolate employer, period, dataset and field scope", () => {
  const base = { organizationId: 101, dataset: "people" as const, fields: ["department","headcount"],
    groupBy: "department", startDate: "2026-10-01", endDate: "2026-10-31" };
  const prior = tenantReportPreviewKey(base);
  for (const changed of [
    { ...base, organizationId: 102 },
    { ...base, dataset: "time" as const },
    { ...base, fields: ["headcount", "department"] },
    { ...base, groupBy: null },
    { ...base, startDate: "2026-09-01" },
    { ...base, endDate: "2026-11-01" },
  ]) assert.notEqual(prior, tenantReportPreviewKey(changed));
  assert.equal(tenantReportPreviewKey({ ...base }), prior);
});
