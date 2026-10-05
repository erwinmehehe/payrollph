import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildInspectionDrill } from "../src/lib/labor-inspection-drill";

function sample() {
  return {
    evidencePackSha256: "a".repeat(64),
    schemaVersion: "labor-inspection-pack-v2",
    rangeLabel: "Calendar year 2026",
    findings: [
      {
        key: "FINAL_PAY_OVERDUE:1",
        ruleCode: "FINAL_PAY_OVERDUE",
        category: "Final pay",
        severity: "high" as const,
        title: "Final pay is overdue",
        employeeNo: "EMP-001",
        periodLabel: null,
        exposureAmount: 12500,
        exposureConfidence: "recorded-liability" as const,
        remediation: { owner: "Payroll", status: "acknowledged" },
        defaultOwner: "Payroll",
      },
      {
        key: "SIL_POLICY_REVIEW",
        ruleCode: "SIL_POLICY_REVIEW",
        category: "Leave",
        severity: "medium" as const,
        title: "Review SIL coverage",
        employeeNo: null,
        periodLabel: null,
        exposureAmount: null,
        exposureConfidence: null,
        remediation: null,
        defaultOwner: "People Ops",
      },
    ],
    readyToCloseCount: 1,
    sectionRowCounts: {
      workerRoster: 20,
      payrollRegister: 40,
      payslipIndex: 40,
      statutoryRemittances: 6,
    },
  };
}

test("high-severity findings make a drill blocked and preserve recorded exposure", () => {
  const drill = buildInspectionDrill(sample());
  assert.equal(drill.status, "blocked");
  assert.equal(drill.summary.high, 1);
  assert.equal(drill.summary.medium, 1);
  assert.equal(drill.summary.recordedExposure, 12500);
  assert.equal(drill.actionPlan[0].priority, "P0");
  assert.equal(drill.actionPlan[0].owner, "Payroll");
});

test("medium-only drill is needs-work and zero-actionable drill is evidence-ready", () => {
  const medium = sample();
  medium.findings = [medium.findings[1]];
  medium.readyToCloseCount = 0;
  assert.equal(buildInspectionDrill(medium).status, "needs-work");

  const ready = sample();
  ready.findings = [];
  ready.readyToCloseCount = 0;
  assert.equal(buildInspectionDrill(ready).status, "evidence-ready");
});

test("snapshot hash is deterministic for the same evidence and findings", () => {
  const first = buildInspectionDrill(sample());
  const second = buildInspectionDrill(sample());
  assert.equal(first.snapshotSha256, second.snapshotSha256);
  assert.equal(first.evidencePackSha256, second.evidencePackSha256);
});

test("changing evidence pack hash changes the drill snapshot", () => {
  const first = buildInspectionDrill(sample());
  const changed = sample();
  changed.evidencePackSha256 = "b".repeat(64);
  const second = buildInspectionDrill(changed);
  assert.notEqual(first.snapshotSha256, second.snapshotSha256);
});

test("drill API requires company-wide access, MFA, rate limiting and audit hashes", () => {
  const route = readFileSync("src/app/api/compliance/labor-inspection/drills/route.ts", "utf8");
  assert.ok(route.includes("company-wide"));
  assert.ok(route.includes("requireSensitiveActionMfa"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes("buildLaborInspectionEvidencePackForOrganization"));
  assert.ok(route.includes("buildLaborInspectionReadiness"));
  assert.ok(route.includes("evidencePackSha256"));
  assert.ok(route.includes("snapshotSha256"));
  assert.ok(route.includes("Labor inspection drill completed"));
});

test("drill persistence stores summary and hashes, not duplicate evidence rows", () => {
  for (const path of [
    "drizzle/0030_labor_inspection_drills.sql",
    "drizzle/baseline.sql",
    "src/db/schema.ts",
    "src/lib/core-schema-compat.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("labor_inspection_drills"), path);
  }
  const migration = readFileSync("drizzle/0030_labor_inspection_drills.sql", "utf8");
  assert.ok(migration.includes("evidence_pack_sha256"));
  assert.ok(migration.includes("snapshot_sha256"));
  assert.ok(migration.includes("blocker_summary"));
  assert.equal(migration.includes("payroll_entries"), false);
  assert.equal(migration.includes("time_punches"), false);
  assert.equal(migration.includes("payslips"), false);
});

test("Compliance Center exposes run, trend and action-plan UI", () => {
  const panel = readFileSync("src/components/workspace/labor-inspection-drill-panel.tsx", "utf8");
  const compliance = readFileSync("src/components/workspace/panels.tsx", "utf8");
  assert.ok(panel.includes("Run inspection drill"));
  assert.ok(panel.includes("Drill history"));
  assert.ok(panel.includes("Highest-priority pre-inspection work"));
  assert.ok(panel.includes("does not claim DOLE approval"));
  assert.ok(compliance.includes("LaborInspectionDrillPanel"));
});
