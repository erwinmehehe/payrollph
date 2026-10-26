import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { scopeLaborCostingRead } from "../src/lib/labor-costing-read-scope";

function rows() {
  return {
    // Deliberate same numeric employee ID across two fictional employers:
    // an employee ID alone is not an authorization boundary.
    employeeRows: [
      { id: 11, organizationId: 1, orgUnitId: 31 },
      { id: 12, organizationId: 1, orgUnitId: 32 },
      { id: 11, organizationId: 2, orgUnitId: 31 },
    ],
    centerRows: [
      { id: 101, organizationId: 1, code: "UNIT-A", active: true },
      { id: 102, organizationId: 1, code: "UNIT-B", active: true },
      { id: 999, organizationId: 2, code: "FOREIGN", active: true },
    ],
    allocationRows: [
      { id: 1, organizationId: 1, employeeId: 11, costCenterId: 101 },
      { id: 2, organizationId: 1, employeeId: 12, costCenterId: 102 },
      { id: 3, organizationId: 2, employeeId: 11, costCenterId: 999 },
    ],
    entityRows: [
      { id: 201, organizationId: 1, code: "LEGAL-A" },
      { id: 202, organizationId: 1, code: "LEGAL-B" },
      { id: 299, organizationId: 2, code: "FOREIGN" },
    ],
    glMappingRows: [
      { id: 301, organizationId: 1, accountCode: "5200", costCenterId: 101 },
      { id: 302, organizationId: 1, accountCode: "5300", costCenterId: 102 },
      { id: 399, organizationId: 2, accountCode: "F-PRIVATE", costCenterId: 999 },
    ],
  };
}

test("unit-scoped payroll read exposes only own employee allocations and no finance configuration", () => {
  const result = scopeLaborCostingRead({
    organizationId: 1,
    access: { companyWide: false, orgUnitId: 31 },
    ...rows(),
  });
  assert.ok(result);
  assert.deepEqual(result.allocations.map((row) => row.id), [1]);
  assert.deepEqual(result.costCenters.map((row) => row.id), [101, 102],
    "cost centers remain available as reference choices for authorized employee allocations");
  assert.deepEqual(result.legalEntities, [], "do not leak company-wide legal-entity config");
  assert.deepEqual(result.glMappings, [], "do not leak unrelated GL codes or mappings");
  assert.ok(!JSON.stringify(result).includes("F-PRIVATE"));
  assert.ok(!JSON.stringify(result).includes("5300"));
});

test("another unit and another employer cannot leak through same numeric employee ID", () => {
  const otherUnit = scopeLaborCostingRead({
    organizationId: 1,
    access: { companyWide: false, orgUnitId: 32 },
    ...rows(),
  });
  assert.deepEqual(otherUnit?.allocations.map((row) => row.id), [2]);
  const foreign = scopeLaborCostingRead({
    organizationId: 2,
    access: { companyWide: false, orgUnitId: 31 },
    ...rows(),
  });
  assert.deepEqual(foreign?.allocations.map((row) => row.id), [3]);
  assert.deepEqual(foreign?.costCenters.map((row) => row.code), ["FOREIGN"]);
  assert.deepEqual(foreign?.glMappings, []);
});

test("company-wide payroll permission receives only its selected employer's finance rows", () => {
  const result = scopeLaborCostingRead({
    organizationId: 1,
    access: { companyWide: true, orgUnitId: null },
    ...rows(),
  });
  assert.deepEqual(result?.allocations.map((row) => row.id), [1, 2]);
  assert.deepEqual(result?.legalEntities.map((row) => row.id), [201, 202]);
  assert.deepEqual(result?.glMappings.map((row) => row.id), [301, 302]);
  assert.ok(!JSON.stringify(result).includes("F-PRIVATE"));
});

test("invalid organization IDs or contradictory/missing scope cannot become a wider read", () => {
  for (const organizationId of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(scopeLaborCostingRead({
      organizationId, access: { companyWide: true, orgUnitId: null }, ...rows(),
    }), null);
  }
  for (const access of [
    { companyWide: false, orgUnitId: null },
    { companyWide: false, orgUnitId: 0 },
    { companyWide: false, orgUnitId: -2 },
    { companyWide: false, orgUnitId: 1.2 },
    { companyWide: true, orgUnitId: 31 },
  ]) {
    assert.equal(scopeLaborCostingRead({ organizationId: 1, access, ...rows() }), null);
  }
});

test("GET keeps tenant-bounded SQL, skips finance queries for unit actors and forbids shared caching", () => {
  const source = readFileSync("src/app/api/workforce/labor-costing/route.ts", "utf8");
  const read = source.split("export async function GET(request: Request) {")[1]
    ?.split("export async function POST(request: Request) {")[0] ?? "";
  assert.ok(read.includes("scopeLaborCostingRead({"));
  assert.ok(read.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(read.includes("eq(employees.orgUnitId, scopedUnitId!)"));
  assert.ok(read.includes("eq(employeeLaborAllocations.organizationId, organizationId)"));
  assert.ok(read.includes("access.companyWide"));
  assert.ok(read.includes(": Promise.resolve([])"), "unit actors must not query finance config");
  assert.ok(read.includes("private, no-store"), "finance GET must not be cached");
  assert.ok(!read.includes("glMappings: glMappingRows"), "raw GL configuration must not bypass projection");
});
