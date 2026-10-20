import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  authorizedReportBuilderSelection, tenantReportPreviewKey,
  verifyReportBuilderCapabilities, verifyReportBuilderPreview, verifyReportBuilderCsvResponse,
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


test("capability reads require a complete authorized dataset envelope", () => {
  const verified = verifyReportBuilderCapabilities({
    fields: { people: ["department", "headcount"], time: [], payroll: [] },
  }, 101);
  assert.deepEqual(verified, { organizationId: 101,
    fields: { people: ["department", "headcount"], time: [], payroll: [] } });
  for (const invalid of [
    null, {}, { fields: null }, { fields: { people: [], time: [] } },
    { fields: { people: ["department", "department"], time: [], payroll: [] } },
    { fields: { people: ["headcount", 4], time: [], payroll: [] } },
    { fields: { people: Array.from({ length: 13 }, (_, i) => "field-" + i), time: [], payroll: [] } },
    { fields: { people: [""], time: [], payroll: [] } },
  ]) assert.throws(() => verifyReportBuilderCapabilities(invalid, 101));
});

test("a malformed or different-dataset 200 response never becomes an exportable preview", () => {
  const valid = { source: "people", columns: ["department", "headcount"],
    rows: [["HR", "3"], ["Operations", "0"]] };
  assert.deepEqual(verifyReportBuilderPreview(valid, "people", valid.columns),
    { columns: valid.columns, rows: valid.rows });
  assert.deepEqual(verifyReportBuilderPreview({ ...valid, rows: [] }, "people", valid.columns).rows, []);
  for (const invalid of [
    null, {}, { ...valid, source: "payroll" },
    { ...valid, source: undefined }, { ...valid, columns: ["headcount", "department"] },
    { ...valid, columns: ["department"] }, { ...valid, rows: [["HR"]] },
    { ...valid, rows: [["HR", 3]] }, { ...valid, rows: null },
    { ...valid, rows: Array.from({ length: 5_001 }, () => ["HR", "1"]) },
  ]) assert.throws(() => verifyReportBuilderPreview(invalid, "people", valid.columns));
});

test("a successful HTML or JSON error page must never be downloaded as a CSV", () => {
  verifyReportBuilderCsvResponse(new Response("department,headcount\\nHR,3", {
    status: 200, headers: { "Content-Type": "text/csv; charset=utf-8" },
  }));
  for (const contentType of ["text/html", "application/json", "application/pdf", ""]) {
    assert.throws(() => verifyReportBuilderCsvResponse(new Response("error", {
      status: 200, headers: contentType ? { "Content-Type": contentType } : {},
    })));
  }
});

test("the report component remounts on employer switch, including A-B-A return", () => {
  const view = readFileSync("src/components/workspace/tenant-report-builder.tsx", "utf8");
  // This is a source regression, not a browser test: the keyed child must own
  // the fetch generation, authorization capabilities, preview and selected period.
  assert.match(view, /return <ScopedTenantReportBuilder key=\{organizationId\} organizationId=\{organizationId\} \/>;/);
  assert.match(view, /function ScopedTenantReportBuilder\(/);
  assert.ok(view.indexOf("const [preview, setPreview]") > view.indexOf("function ScopedTenantReportBuilder("));
  assert.ok(view.indexOf("const [capabilities, setCapabilities]") > view.indexOf("function ScopedTenantReportBuilder("));
});
