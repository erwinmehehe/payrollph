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
  assert.ok(route.includes("scopes: { legalEntities: entities, orgUnits: units, dynamicGroups:"));
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


test("legacy BI metadata and exports fail closed when multi-entity mode is enabled", () => {
  const route = read("src/app/api/bi-exports/route.ts");
  const analytics = read("src/components/workspace/analytics.tsx");
  const gate = route.indexOf('if (criticalReleaseFlagEnabled("multiEntity"))');
  const access = route.indexOf("if (!access?.companyWide)");
  const definitions = route.indexOf('const key = String(url.searchParams.get("key") ?? "")');
  const exportCall = route.indexOf("await runBiExport(");
  assert.ok(route.includes('import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags"'));
  assert.ok(access >= 0 && gate > access, "membership/role checks must still run first");
  assert.ok(gate < definitions && definitions < exportCall,
    "deny before metadata enumeration, filters, audit or export");
  assert.ok(route.includes('"ENTITY_BI_EXPORT_NOT_YET_CERTIFIED"'));
  assert.ok(route.includes('"Cache-Control": "no-store"'));
  // The normal company-wide legacy UI remains available with the feature OFF.
  assert.ok(analytics.includes('useState<ReportKey>("workforce")'));
  assert.ok(analytics.includes("!data.multiEntity?.enabled && ("));
  assert.ok(analytics.includes("<EnterpriseBiExportPanel organizationId={organizationId} notify={notify} />"));
  assert.ok(analytics.includes("<HcmReportBuilderPanel key={organizationId} organizationId={organizationId} />"));
});


test("Analytics never displays or exports a response from a previous legal employer", () => {
  const analytics = read("src/components/workspace/analytics.tsx");
  assert.ok(analytics.includes("const requestScopeKey = JSON.stringify({"));
  assert.ok(analytics.includes("organizationId,"));
  assert.ok(analytics.includes("legalEntityId: data.multiEntity?.enabled ? data.multiEntity.legalEntityId : null"));
  assert.ok(analytics.includes("role: data.multiEntity?.enabled ? data.multiEntity.role : \"legacy\""));
  assert.ok(analytics.includes("report: safeActive,"));
  assert.ok(analytics.includes("resolvedScopeKey === requestScopeKey ? result : null"));
  assert.ok(analytics.includes('resolvedScopeKey === requestScopeKey ? state : "loading"'));
  assert.ok(analytics.includes("data.multiEntity?.legalEntityId,"),
    "changing legal employer must re-run the API request");
  // Transport, JSON and scope/shape failures share the same fail-closed catch.
  // Count success plus that common failure path; the validator tests cover all
  // distinct transport/contract failures independently.
  assert.ok((analytics.match(/setResolvedScopeKey\\(requestScopeKey\\)/g) ?? []).length >= 2,
    "success and the common failure path must pin response/error to request identity");
  assert.ok(analytics.includes("readVerifiedReportPayload("),
    "a successful report must pass the selected-employer contract validator");
  assert.ok(analytics.includes('disabled={visibleState !== "ready" || !visibleResult?.rows.length}'),
    "stale report must not enable an export click");
  assert.ok(analytics.includes('visibleState === "ready" && visibleResult && ('),
    "stale report table must never render as new employer data");
});
