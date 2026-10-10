import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coverageApi = readFileSync("src/app/api/workforce/coverage/route.ts", "utf8");
const coverageUi = readFileSync("src/components/workspace/workforce-coverage-panel.tsx", "utf8");
const previewUi = readFileSync("src/components/workspace/workforce-planning-preview-panel.tsx", "utf8");
const projection = readFileSync("src/lib/workforce-planning-preview.ts", "utf8");

test("planning preview consumes the established tenant/role-scoped coverage endpoint", () => {
  assert.ok(coverageUi.includes("/api/workforce/coverage?"));
  assert.ok(coverageApi.includes("assertOrganizationRole("));
  assert.ok(coverageApi.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(coverageApi.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(coverageApi.includes("costVisible: canViewLaborCosts"));
  assert.ok(coverageApi.includes("benchmarkHourlyRate: null"));
  assert.ok(coverageUi.includes("<WorkforcePlanningPreviewPanel"));
  assert.ok(coverageUi.includes("recommendations={payload.proactiveSuggestions}"));
});

test("the planned staffing comparison cannot create shifts or release payroll", () => {
  assert.ok(coverageUi.includes("planSmartRecoveryDraft("));
  assert.ok(coverageUi.includes("previewWorkforceRecovery("));
  assert.ok(previewUi.includes("data-wfm-planning-preview"));
  assert.ok(previewUi.includes("This comparison does not create or publish shifts."));
  assert.ok(!previewUi.includes("fetch("));
  assert.ok(!previewUi.includes('method: "POST"'));
  assert.ok(!projection.includes("db."));
  assert.ok(!projection.includes("insert("));
});

test("date guard and cost withholding are wired into the planning engine", () => {
  assert.ok(coverageUi.includes("row.workDate >= planningToday"));
  assert.ok(coverageUi.includes("futureCoverage"));
  assert.ok(projection.includes('costStatus: "estimated" | "restricted" | "incomplete"'));
  assert.ok(projection.includes('const showMoney = costStatus === "estimated"'));
  assert.ok(previewUi.includes('if (preview.costStatus === "restricted")'));
  assert.ok(previewUi.includes('if (preview.costStatus === "incomplete")'));
  assert.ok(previewUi.includes("not each proposed employee"));
});
