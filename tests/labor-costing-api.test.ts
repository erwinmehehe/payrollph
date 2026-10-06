import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/workforce/labor-costing/route.ts", "utf8");

test("labor-costing mutations use standard sensitive-action security gates", () => {
  assert.ok(source.includes("enforceSameOriginMutation(request)"));
  assert.ok(source.includes("requireSensitiveActionMfa(user)"));
  assert.ok(source.includes("enforceSensitiveActionRateLimit(request"));
});

test("labor-costing API enforces tenant and employee organization-unit scope", () => {
  assert.ok(source.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(source.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(source.includes("eq(costCenters.organizationId, organizationId)"));
  assert.ok(source.includes("active and belong to this organization"));
});

test("cost-center creation requires company-wide organization administration", () => {
  assert.ok(source.includes("ORG_ADMIN_ROLES"));
  assert.ok(source.includes("Organization-wide cost centers require company-wide access."));
});

test("allocation batches are validated to 100 percent before persistence", () => {
  assert.ok(source.includes("resolveLaborAllocation({ employeeId, asOf: effectiveFrom, rows: normalized })"));
  assert.ok(source.includes("allocationInput.length > 20"));
});

test("new effective-dated allocations close prior overlapping rows atomically", () => {
  assert.ok(source.includes("rowsToClose"));
  assert.ok(source.includes("dayBefore(effectiveFrom)"));
  assert.ok(source.includes("db.transaction"));
  assert.ok(source.includes("effectiveUntil: closeDate"));
});

test("future overlapping allocation plans fail closed", () => {
  assert.ok(source.includes("futureOrSameStartConflict"));
  assert.ok(source.includes("Adjust that future allocation before adding another set."));
});


test("labor-costing API accepts hours-based allocation evidence", () => {
  assert.ok(source.includes('body.allocationBasis === "hours"'));
  assert.ok(source.includes("allocationHours"));
  assert.ok(source.includes("resolvedAllocation.percent.toFixed(3)"));
});

test("GL mapping changes are company-wide, tenant-scoped, and auditable", () => {
  assert.ok(source.includes('"set_gl_mapping"'));
  assert.ok(source.includes("GL mappings require company-wide access."));
  assert.ok(source.includes("eq(legalEntities.organizationId, organizationId)"));
  assert.ok(source.includes("eq(costCenters.organizationId, organizationId)"));
  assert.ok(source.includes('action: "Labor GL mapping set"'));
});
