import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { bindTenantPath, validateTenantPathBinding, selectTenantPathRows } from "../scripts/qa/tenant-table-path.mjs";
import { bindTenantReadRequests, validateTenantRow } from "../scripts/qa/tenant-table-loader.mjs";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";
import { createRows } from "../scripts/qa/tenant-table-rows/read/path-id.mjs";

const definition = { key: "GET employees/[id]/mwe-classifications", pathIds: { id: "employeeId" } };
const ctx = { seeded: { employeeId: 11 }, victimSeeded: { employeeId: 91 } };
test("explicit genuine path binding preserves legacy URLs and separates own/victim objects", () => {
  assert.equal(bindTenantPath(definition, ctx, "own"), "/api/employees/11/mwe-classifications");
  assert.equal(bindTenantPath(definition, ctx, "foreign"), "/api/employees/91/mwe-classifications");
  assert.equal(bindTenantPath(definition, ctx, "forged"), "/api/employees/91/mwe-classifications");
  const requests = bindTenantReadRequests(definition, 3, 9, "&asOf=2026-07-01", ctx);
  assert.equal(requests.own, "/api/employees/11/mwe-classifications?organizationId=3&asOf=2026-07-01");
  assert.equal(requests.foreign, "/api/employees/91/mwe-classifications?organizationId=9&asOf=2026-07-01");
  assert.equal(bindTenantReadRequests({ key: "GET employees" }, 3, 9).own, "/api/employees?organizationId=3");
  const nested = { key: "PATCH employees/[id]/mwe-classifications/[classificationId]", pathIds: { id: "employeeId", classificationId: "id" } };
  assert.equal(bindTenantPath(nested, { seeded: { employeeId: 11, id: 2 }, victimSeeded: { employeeId: 91, id: 4 } }, "foreign"), "/api/employees/91/mwe-classifications/4");
});
test("missing, extra, dynamic and repeated path bindings fail closed", () => {
  for (const binding of [undefined, {}, { other: "id" }, { id: "employeeId", extra: "id" }, { id: "nested.id" }, { id: () => 1 }]) assert.throws(() => validateTenantPathBinding(definition.key, binding));
  assert.throws(() => validateTenantPathBinding("GET employees", { id: "id" }));
  assert.throws(() => validateTenantPathBinding("GET employees/[id]/[id]", { id: "id" }));
});
test("invented, missing, noninteger, equal and lower victim IDs cannot create a URL", () => {
  for (const value of [undefined, null, 0, -1, 11, 10, 91.5, "91", NaN, Infinity]) assert.throws(() => bindTenantPath(definition, { ...ctx, victimSeeded: { employeeId: value } }, "foreign"));
  assert.throws(() => bindTenantPath(definition, { victimSeeded: ctx.victimSeeded }, "own"));
  assert.throws(() => bindTenantPath(definition, ctx, "external"));
});
test("source/runtime path metadata must agree and a path-only run never silently becomes the full table", () => {
  const spec = tenantFamilyCatalog("read").find(row => row.key === definition.key);
  const row = { ...definition, prove: () => {} };
  assert.equal(validateTenantRow(row, spec), row);
  assert.throws(() => validateTenantRow({ ...row, pathIds: { id: "id" } }, spec));
  const rows = [row, { key: "GET employees" }];
  assert.equal(selectTenantPathRows(rows, undefined), rows); assert.deepEqual(selectTenantPathRows(rows, "1"), [row]);
  assert.throws(() => selectTenantPathRows(rows, "true")); assert.throws(() => selectTenantPathRows([], "1"));
});
test("new GET proofs bind nonempty exact worker/classification and run/finding identities", () => {
  const [history, impact] = createRows({ assert });
  const c = { orgId: 3, workerId: 11, marker: "Fictional-own", rank: 1, owner: { id: 7 }, seeded: { id: 41, changeId: 81 } };
  const response = { json: { employee: { id: 11, employeeNo: c.marker }, classifications: [{ id: 41, organizationId: 3, employeeId: 11, evidenceReference: c.marker,
    wageOrderReference: "FICTIONAL-" + c.marker, status: "rejected", isMwe: false, requestedByUserId: 7, employeeDailyWage: "1001.00" }] } };
  history.prove(response, c); assert.throws(() => history.prove(response, { ...c, orgId: 9 }));
  assert.throws(() => history.prove({ json: { ...response.json, classifications: [] } }, c));
  const report = { json: { runId: 41, runStatus: "Draft", periodStart: "2026-06-01", periodEnd: "2026-06-15", advisoryOnly: true,
    total: 1, summary: { HRIS: 1 }, incomplete: false, findings: [{ sourceId: 81, employeeId: 11, code: "HRIS_CHANGE_NOT_APPLIED", date: "2026-06-02" }] } };
  impact.prove(report, c); assert.throws(() => impact.prove(report, { ...c, seeded: { id: 42, changeId: 82 } }));
  assert.throws(() => impact.prove({ json: { ...report.json, findings: [] } }, c));
});
test("path-only credit dry-run selects no unrelated pending methods and never edits the ledger", () => {
  const file = "scripts/qa/tenant-isolation-coverage-manifest.json", before = readFileSync(file, "utf8"), manifest = JSON.parse(before);
  const methods = [...tenantFamilyCatalog("read"), ...tenantFamilyCatalog("write")].filter(row => row.pathIds);
  const expected = methods.filter(row => { const [verb, route] = row.key.split(" "); return manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"].methods.find(method => method.name === verb).status === "GAP"; }).length;
  const report = JSON.parse(execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--only-path-ids", "--check"], { encoding: "utf8" }));
  assert.equal(report.newlyCredited, expected); assert.equal(readFileSync(file, "utf8"), before);
});
