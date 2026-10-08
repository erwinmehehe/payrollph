import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  freezeSeparationIntent,
  separationEvidenceFromDefinition,
  separationIntentFingerprint,
  type HcmSeparationIntent,
} from "../src/lib/hcm-separation-business-process";

const intent: HcmSeparationIntent = {
  organizationId: 8,
  employeeId: 43,
  employeeStatus: "Active",
  employeeOrgUnitId: 2,
  employeeStartDate: "2025-04-01",
  employmentTermDecisionId: null,
  separationType: "resignation",
  noticeDate: "2026-10-08",
  lastDay: "2026-11-08",
};

test("separation HCM approval binds employee identity and exact exit facts", () => {
  const fingerprint = separationIntentFingerprint(intent);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  const changed: Partial<HcmSeparationIntent>[] = [
    { employeeId: 99 },
    { employeeOrgUnitId: 5 },
    { employeeStatus: "Separating" },
    { employmentTermDecisionId: 100 },
    { separationType: "authorized_cause" },
    { noticeDate: "2026-10-09" },
    { lastDay: "2026-11-09" },
  ];
  for (const part of changed) assert.notEqual(separationIntentFingerprint({ ...intent, ...part }), fingerprint);
  assert.throws(() => separationIntentFingerprint({ ...intent, lastDay: "2025-03-01" }), /invalid worker/);
  assert.throws(() => separationIntentFingerprint({ ...intent, employeeId: 0 }), /invalid worker/);
});

test("separation evidence does not store final pay or bank details", () => {
  const frozen = freezeSeparationIntent(intent);
  assert.deepEqual(Object.keys(frozen).sort(), ["employeeId", "fingerprint", "organizationId"]);
  assert.deepEqual(separationEvidenceFromDefinition({ sourceEvidence: frozen }), frozen);
  assert.equal(separationEvidenceFromDefinition({ sourceEvidence: { ...frozen, employeeId: "43" } }), null);
  assert.equal(separationEvidenceFromDefinition({ sourceEvidence: { ...frozen, fingerprint: "bad" } }), null);
  assert.equal(separationEvidenceFromDefinition({}), null);
});

test("separation does not mark worker separating before HCM approval", () => {
  const api = readFileSync("src/app/api/separation/route.ts", "utf8");
  const processStart = api.indexOf("const separationIntent: HcmSeparationIntent");
  const processGate = api.indexOf("if (separationProcess.status !== \"approved\")");
  const financialWrite = api.indexOf("const created = await db.transaction", processStart);
  const workerMutation = api.indexOf('.set({ status: "Separating" })', processStart);
  assert.ok(processStart > 0 && processGate > processStart);
  assert.ok(financialWrite > processGate);
  assert.ok(workerMutation > financialWrite);
  assert.match(api.slice(processStart, financialWrite), /processType: "termination"/);
  assert.match(api.slice(processStart, financialWrite), /sourceType: "separation_initiation"/);
  assert.match(api.slice(processStart, financialWrite), /status: 202/);
  assert.match(api.slice(financialWrite, workerMutation), /eq\(hcmBusinessProcessInstances.status, "approved"\)/);
  assert.match(api, /Separation approval changed before it could be applied/);
});

test("approved exit dates cannot be silently rewritten by final-pay recalculation", () => {
  const api = readFileSync("src/app/api/separation/route.ts", "utf8");
  assert.match(api, /An open Separation package cannot change its approved dates or category/);
  assert.match(api, /pg_advisory_xact_lock\(4106/);
  assert.match(api, /separationIntentFingerprint/);
  assert.match(api, /status: "applied", updatedAt: new Date\(\)/);
  const ui = readFileSync("src/components/separation-panel.tsx", "utf8");
  assert.match(ui, /if \(data.approvalRequired\)/);
  assert.match(ui, /No Separation package was created/);
});
