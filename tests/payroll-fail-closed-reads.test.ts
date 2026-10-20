import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseManagedPayrollRead } from "../src/lib/managed-payroll-read";
import { parseExplainPayRead } from "../src/lib/explain-pay-read";

const managedScope = { organizationId: 41, viewerUserId: 71 };
const managed = () => ({
  organizationId: 41, viewerUserId: 71,
  engagement: {
    id: 9, organizationId: 41, status: "pilot", serviceTier: "Managed payroll",
    slaHours: 24, targetGoLive: null, clientApproverUserId: 71,
  },
  gates: [{
    id: 101, engagementId: 9, gateKey: "parallel-run",
    label: "Parallel payroll", status: "verified", evidenceRef: "QA-100",
    completedBy: "Fictional reviewer", completedAt: "2026-10-19T00:00:00.000Z",
  }],
  runs: [{
    id: 17, organizationId: 41, periodLabel: "October 2026",
    status: "Ready for release", payDate: "2026-10-20", employeeCount: 1,
    grossPay: "10000.00", netPay: "8300.00",
    clientApproval: { approvedBy: "Fictional reviewer", approvedAt: "2026-10-19T00:00:00.000Z", valid: true },
  }],
  designatedApprover: { id: 71, name: "Fictional approver", email: "fictional@example.invalid" },
  currentUserIsApprover: true,
});
const explainScope = { organizationId: 41, legalEntityId: 7, runId: 17, employeeId: 108 };
const explain = () => ({
  organizationId: 41, legalEntityId: 7, employeeId: 108,
  run: { id: 17, periodLabel: "October 2026" },
  previousRun: { id: 11, periodLabel: "September 2026" },
  explanation: {
    currentGross: 1000, currentDeductions: 100, currentNet: 900,
    previousNet: 800, netDelta: 100, netPercent: 12.5,
    ruleVersion: "PH-FICTIONAL", context: { payBasis: "monthly", basicRate: 1000, region: null },
    lines: [{ code: "BASIC", label: "Basic pay", direction: "earning",
      previous: 900, current: 1000, delta: 100, netEffectDelta: 100,
      reason: "Stored payroll salary", notes: ["synthetic only"] }],
  },
});

test("managed payroll accepts only a complete matching employer, user, approver and verified gate", () => {
  assert.ok(parseManagedPayrollRead(managed(), managedScope));
  assert.deepEqual(parseManagedPayrollRead({
    organizationId: 41, viewerUserId: 71, engagement: null, gates: [], runs: [],
    designatedApprover: null, currentUserIsApprover: false,
  }, managedScope)?.runs, []);
  for (const change of [
    { organizationId: 99 }, { viewerUserId: 72 }, { engagement: null },
    { engagement: { ...managed().engagement, organizationId: 99 } },
    { engagement: { ...managed().engagement, clientApproverUserId: 72 } },
    { currentUserIsApprover: false },
    { gates: [{ ...managed().gates[0], engagementId: 99 }] },
    { gates: [{ ...managed().gates[0], status: "verified", evidenceRef: "" }] },
    { gates: [...managed().gates, managed().gates[0]] },
    { runs: [{ ...managed().runs[0], organizationId: 99 }] },
    { runs: [{ ...managed().runs[0], netPay: "NaN" }] },
    { runs: [{ ...managed().runs[0], clientApproval: { approvedBy: "X", approvedAt: "", valid: true } }] },
    { designatedApprover: { ...managed().designatedApprover, id: 99 } },
  ]) {
    assert.equal(parseManagedPayrollRead({ ...managed(), ...change }, managedScope), null, JSON.stringify(change));
  }
  assert.equal(parseManagedPayrollRead({}, managedScope), null);
  assert.equal(parseManagedPayrollRead(managed(), { ...managedScope, viewerUserId: null }), null);
});

test("pay explanation demands the exact tenant, legal employer, run and employee with finite money", () => {
  assert.ok(parseExplainPayRead(explain(), explainScope));
  for (const change of [
    { organizationId: 99 }, { legalEntityId: 99 }, { employeeId: 109 },
    { run: { id: 19, periodLabel: "wrong run" } }, { run: null },
    { explanation: { ...explain().explanation, currentNet: Infinity } },
    { explanation: { ...explain().explanation, netDelta: 1 } },
    { explanation: { ...explain().explanation, netDelta: null } },
    { explanation: { ...explain().explanation, previousNet: null, netDelta: 100 } },
    { explanation: { ...explain().explanation, context: { taxableCompensation: NaN } } },
    { explanation: { ...explain().explanation, lines: [{ ...explain().explanation.lines[0], current: NaN }] } },
    { explanation: { ...explain().explanation, lines: [...explain().explanation.lines, explain().explanation.lines[0]] } },
  ]) {
    assert.equal(parseExplainPayRead({ ...explain(), ...change }, explainScope), null, JSON.stringify(change));
  }
  assert.equal(parseExplainPayRead({}, explainScope), null);
  assert.equal(parseExplainPayRead({ ...explain(), legalEntityId: undefined }, explainScope), null);
  assert.equal(parseExplainPayRead({ ...explain(), previousRun: null }, explainScope), null);
});

test("server-owned scope assertions and UI stale-read withdrawal cannot regress", () => {
  const managedRoute = readFileSync("src/app/api/managed-payroll/route.ts", "utf8");
  const explainRoute = readFileSync("src/app/api/payroll-runs/[id]/explain/[employeeId]/route.ts", "utf8");
  const controlRoom = readFileSync("src/components/workspace/managed-payroll-control-room.tsx", "utf8");
  const drawer = readFileSync("src/components/workspace/explain-pay-drawer.tsx", "utf8");
  const payroll = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
  assert.match(managedRoute, /viewerUserId: userId/);
  assert.match(managedRoute, /organizationId: run\.organizationId/);
  assert.match(explainRoute, /legalEntityId: run\.legalEntityId \?\? null/);
  assert.match(explainRoute, /employeeId,\s*run:/);
  assert.match(explainRoute, /isNull\(payrollRuns\.legalEntityId\)/);
  assert.match(explainRoute, /isNull\(payrollRuns\.scopeOrgUnitId\)/);
  assert.match(controlRoom, /parseManagedPayrollRead\(body, \{ organizationId, viewerUserId \}\)/);
  assert.match(controlRoom, /setPayload\(null\)/);
  assert.match(controlRoom, /const verified = await load\(\)/);
  assert.doesNotMatch(controlRoom, /setPayload\(body as ManagedPayload\)/);
  assert.match(drawer, /parseExplainPayRead\(body, \{ organizationId, legalEntityId, runId, employeeId \}\)/);
  assert.match(drawer, /observed\?\.scope === scope/);
  assert.match(drawer, /controller\.abort\(\)/);
  assert.match(payroll, /legalEntityId=\{run\.legalEntityId \?\? null\}/);
});
