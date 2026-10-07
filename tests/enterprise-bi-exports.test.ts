import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("enterprise BI exports expose versioned payroll and workforce datasets", () => {
  const source = read("src/lib/bi-exports.ts");
  assert.ok(source.includes('BI_EXPORT_SCHEMA_VERSION = "2026-10-07.1"'));
  assert.ok(source.includes('"payroll_runs"'));
  assert.ok(source.includes('"payroll_entries"'));
  assert.ok(source.includes('"workforce_timesheets"'));
  assert.ok(source.includes("BI_EXPORT_MAX_ROWS = 50_000"));
  assert.ok(source.includes("BI_EXPORT_MAX_DAYS = 366"));
  assert.ok(source.includes("validIsoDate"));
  assert.ok(source.includes("toISOString().slice(0, 10) === value"));
});

test("BI payroll entry dimensions use authoritative payroll-run scope", () => {
  const source = read("src/lib/bi-exports.ts");
  const start = source.indexOf("async function payrollEntryRows");
  const end = source.indexOf("async function timesheetRows", start);
  const payrollEntries = source.slice(start, end);
  assert.ok(payrollEntries.includes("eq(payrollRuns.legalEntityId, filters.legalEntityId)"));
  assert.ok(payrollEntries.includes("eq(payrollRuns.scopeOrgUnitId, filters.orgUnitId)"));
  assert.ok(payrollEntries.includes("eq(payrollRuns.legalEntityId, legalEntities.id)"));
  assert.ok(payrollEntries.includes("eq(payrollRuns.scopeOrgUnitId, orgUnits.id)"));
  assert.equal(payrollEntries.includes("eq(employees.legalEntityId, legalEntities.id)"), false);
});

test("timesheet current org dimensions are labeled as current instead of historical evidence", () => {
  const source = read("src/lib/bi-exports.ts");
  assert.ok(source.includes('"currentLegalEntityCode"'));
  assert.ok(source.includes('"currentOrgUnitCode"'));
  assert.ok(source.includes("not a historical timesheet snapshot"));
  assert.ok(source.includes("snapshotHash"));
  assert.equal(source.includes("snapshot: workforceTimesheets.snapshot"), false);
});

test("BI export API is company-wide, MFA protected, bounded and tenant-scoped", () => {
  const route = read("src/app/api/bi-exports/route.ts");
  assert.ok(route.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(route.includes("companyWide"));
  assert.ok(route.includes("requireSensitiveActionMfa"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes("legalEntities.organizationId"));
  assert.ok(route.includes("orgUnits.organizationId"));
  assert.ok(route.includes("validateBiExportFilters"));
  assert.ok(route.includes("scopes: { legalEntities: entities, orgUnits: units }"));
  assert.ok(route.includes("The selected organization unit belongs to a different legal entity."));
});

test("BI exports carry integrity and audit evidence", () => {
  const source = read("src/lib/bi-exports.ts");
  const route = read("src/app/api/bi-exports/route.ts");
  assert.ok(source.includes('createHash("sha256")'));
  assert.ok(route.includes('"Enterprise BI export generated"'));
  assert.ok(route.includes('"X-Linaw-BI-SHA256"'));
  assert.ok(route.includes('"X-Linaw-BI-Schema-Version"'));
  assert.ok(route.includes('"X-Linaw-BI-Row-Count"'));
  assert.ok(route.includes("excludedSensitiveIdentifiers: true"));
});

test("BI metadata explicitly excludes high-risk identifiers", () => {
  const route = read("src/app/api/bi-exports/route.ts");
  for (const label of ["bank account", "TIN", "SSS number", "PhilHealth number", "Pag-IBIG number"]) {
    assert.ok(route.includes(label), `missing privacy exclusion: ${label}`);
  }
  const source = read("src/lib/bi-exports.ts");
  assert.equal(source.includes("employees.bankAccount"), false);
  assert.equal(source.includes("employees.tin"), false);
  assert.equal(source.includes("employees.sssNo"), false);
  assert.equal(source.includes("employees.philHealthNo"), false);
  assert.equal(source.includes("employees.pagIbigNo"), false);
});

test("Analytics exposes governed CSV NDJSON and JSON BI downloads", () => {
  const panel = read("src/components/enterprise-bi-export-panel.tsx");
  const analytics = read("src/components/workspace/analytics.tsx");
  assert.ok(analytics.includes("EnterpriseBiExportPanel"));
  assert.ok(panel.includes("BI exports"));
  assert.ok(panel.includes('value="csv"'));
  assert.ok(panel.includes('value="ndjson"'));
  assert.ok(panel.includes('value="json"'));
  assert.ok(panel.includes("X-Linaw-BI-Row-Count"));
  assert.ok(panel.includes("X-Linaw-BI-SHA256"));
  assert.ok(panel.includes("recent MFA"));
  assert.ok(panel.includes("All legal entities"));
  assert.ok(panel.includes("All organization units"));
});
