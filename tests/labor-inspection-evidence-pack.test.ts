import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildLaborInspectionEvidencePack,
  evidenceSection,
  sha256Evidence,
  verifyLaborInspectionEvidencePack,
} from "../src/lib/labor-inspection-evidence-pack";

function samplePack(generatedAt = "2026-10-05T08:00:00.000Z", generatedBy = "Owner") {
  const empty = evidenceSection("empty", []);
  return buildLaborInspectionEvidencePack({
    generatedAt,
    generatedBy,
    organization: { id: 1, legalName: "Acme Inc." },
    range: { startDate: "2026-01-01", endDate: "2026-10-05", label: "Calendar year 2026" },
    boundaries: {
      certification: "Not a certification.",
      sensitiveData: "Sensitive identifiers excluded.",
      scope: "Payroll evidence only.",
    },
    sections: {
      workerRoster: evidenceSection("worker-roster", [{ employeeNo: "EMP-1", name: "Ana Reyes", rate: 30000 }]),
      payrollRegister: evidenceSection("payroll-register", [{ runId: 10, netPay: 13000 }]),
      timeRecords: empty,
      payslipIndex: evidenceSection("payslip-index", [{ payslipId: 5, contentSha256: sha256Evidence("pdf-bytes") }]),
      thirteenthMonth: empty,
      statutoryRemittances: empty,
      finalPay: empty,
      remediationRegister: empty,
      activeFindings: empty,
    },
  });
}

test("evidence pack hash is stable across export time and exporter identity when evidence is unchanged", () => {
  const first = samplePack("2026-10-05T08:00:00.000Z", "Owner");
  const second = samplePack("2026-10-05T09:00:00.000Z", "Checker");
  assert.equal(first.snapshot.sha256, second.snapshot.sha256);
  assert.equal(verifyLaborInspectionEvidencePack(first).valid, true);
  assert.equal(verifyLaborInspectionEvidencePack(second).valid, true);
});

test("canonical hashing ignores object key insertion order", () => {
  assert.equal(
    sha256Evidence({ b: 2, a: { d: 4, c: 3 } }),
    sha256Evidence({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("tampering with a section invalidates the pack", () => {
  const pack = samplePack();
  const tampered = structuredClone(pack);
  (tampered.sections.workerRoster.rows[0] as Record<string, unknown>).rate = 1;
  const verified = verifyLaborInspectionEvidencePack(tampered);
  assert.equal(verified.valid, false);
  assert.equal(verified.sectionsValid, false);
});

test("pack server excludes unnecessary high-risk identifiers and exports released payslips only", () => {
  const server = readFileSync("src/lib/labor-inspection-evidence-pack-server.ts", "utf8");
  assert.ok(server.includes('run.status !== "Released"'));
  assert.ok(server.includes("sensitiveData"));
  for (const prohibited of [
    "bankAccount:",
    "tin:",
    "sssNo:",
    "philHealthNo:",
    "pagIbigNo:",
    "ipAddress:",
    "deviceSerial:",
    "location:",
  ]) {
    assert.equal(server.includes(prohibited), false, `pack must not serialize ${prohibited}`);
  }
});

test("inspection evidence export requires company-wide access, MFA, rate limiting and audit hash", () => {
  const route = readFileSync("src/app/api/compliance/labor-inspection/evidence-pack/route.ts", "utf8");
  assert.ok(route.includes("company-wide"));
  assert.ok(route.includes("requireSensitiveActionMfa"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes("Labor inspection evidence pack exported"));
  assert.ok(route.includes("snapshotSha256"));
  assert.ok(route.includes("X-PayrollPH-Evidence-SHA256"));
  assert.ok(route.includes('"Cache-Control": "no-store, private"'));
});

test("inspection UI exposes an error-aware evidence pack download instead of a blind anchor", () => {
  const ui = readFileSync("src/components/workspace/labor-inspection-readiness-panel.tsx", "utf8");
  assert.ok(ui.includes("downloadEvidencePack"));
  assert.ok(ui.includes("Download evidence pack"));
  assert.ok(ui.includes("response.ok"));
  assert.ok(ui.includes("x-payrollph-evidence-sha256"));
});
