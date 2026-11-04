import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { companyExportSources, parseCompanyExportOrganizationId } from "../src/lib/company-export-kind";

const route = readFileSync(new URL("../src/app/api/exports/route.ts", import.meta.url), "utf8");

test("only one explicit canonical positive safe-integer employer may be selected", () => {
  for (const id of [1, 42, Number.MAX_SAFE_INTEGER]) {
    assert.equal(parseCompanyExportOrganizationId(String(id)), id);
  }
  for (const value of [null, "", "0", "-1", "+1", "01", " 1", "1 ", "1.0", "1e3",
    "Infinity", "NaN", "99999999999999999999999", "1 OR 1=1"]) {
    assert.equal(parseCompanyExportOrganizationId(value), null, String(value));
  }
  assert.match(route, /organizationSelectors = searchParams\.getAll\("organizationId"\)/);
  assert.match(route, /organizationSelectors\.length === 1/);
  assert.doesNotMatch(route, /organizationId"\) \?\? "1"/);
});

test("each export selects only its required database families", () => {
  assert.deepEqual(companyExportSources("employees"), { employees: true, payrollRuns: false, auditEvents: false });
  assert.deepEqual(companyExportSources("payroll"), { employees: false, payrollRuns: true, auditEvents: false });
  assert.deepEqual(companyExportSources("audit"), { employees: false, payrollRuns: false, auditEvents: true });
  assert.deepEqual(companyExportSources("all"), { employees: true, payrollRuns: true, auditEvents: true });
  for (const key of ["employees", "payrollRuns", "auditEvents"]) {
    assert.ok(route.includes("requested." + key), "conditional query missing: " + key);
  }
  assert.doesNotMatch(route, /allEmployeeRows/);
});

test("authentication and membership precede all employer-data selection and audits", () => {
  const a = route.indexOf("const user = await getSessionUser();");
  const b = route.indexOf('const organizationSelectors = searchParams.getAll("organizationId");');
  const c = route.indexOf("if (organizationId === null)");
  const d = route.indexOf("const deniedOrg = await assertOrganizationRole(");
  const e = route.indexOf("const access = await getAccess(");
  const f = route.indexOf("const [organization] = await db.select()");
  const g = route.indexOf("await recordAuditEvent(");
  assert.ok(a >= 0 && a < b && b < c && c < d && d < e && e < f && f < g);
  assert.doesNotMatch(route, /ensureSeedData/, "no pre-auth seed writes in exports");
});

test("unit-scoped roster and legal employer filters are enforced by SQL", () => {
  assert.match(route, /!access\.companyWide \? eq\(employees\.orgUnitId, access\.orgUnitId!\)/);
  assert.match(route, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(route, /eq\(payrollRuns\.organizationId, organizationId\)/);
  assert.match(route, /eq\(auditEvents\.organizationId, organizationId\)/);
  assert.match(route, /eq\(employees\.legalEntityId, scope\.legalEntityId\)/);
  assert.match(route, /eq\(payrollRuns\.legalEntityId, scope\.legalEntityId\)/);
  const p = route.indexOf('if (kind !== "employees" && !access.companyWide)');
  const q = route.indexOf("const resolved = await resolveMultiEntityContext(");
  assert.ok(p >= 0 && p < q && q < route.indexOf("const [organization] = await db.select()"));
});

test("CSV and full JSON exports stay private and uncacheable", () => {
  assert.match(route, /"Cache-Control": "no-store, private"/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
  assert.equal(route.split("...PRIVATE_EXPORT_HEADERS").length - 1, 4);
});
