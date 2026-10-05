import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildStatutoryRemittanceAlerts } from "../src/lib/statutory-remittance-alerts";
import { statutoryRemittanceSnapshotHash } from "../src/lib/statutory-remittance";

const route = readFileSync("src/app/api/compliance/statutory-remittances/route.ts", "utf8");
const state = readFileSync("src/lib/statutory-remittance-state.ts", "utf8");

test("batch cannot reconcile while employer payment evidence is below revised liability", () => {
  assert.ok(route.includes("paymentShortfall"));
  assert.ok(route.includes("paymentCoversLiability"));
  assert.ok(route.includes("remaining.length === 0 && exceptions.length === 0 && paymentCoversLiability"));
  assert.ok(route.includes('status: "exception"'));
});

test("payment shortfall becomes an explicit danger alert", () => {
  const alerts = buildStatutoryRemittanceAlerts({
    today: "2026-10-20",
    coverageGaps: [],
    batches: [{
      id: 9,
      agency: "SSS",
      applicableMonth: "2026-09",
      dueDate: "2026-10-31",
      status: "exception",
      pendingPostingCount: 0,
      exceptionCount: 0,
      paymentShortfall: 525.5,
    }],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].tone, "danger");
  assert.match(alerts[0].title, /payment evidence is short/i);
  assert.match(alerts[0].detail, /525\.50/);
  assert.ok(state.includes("paymentShortfall"));
});

test("remittance membership hash is deterministic regardless of member order", () => {
  const a = statutoryRemittanceSnapshotHash({
    agency: "PhilHealth",
    applicableMonth: "2026-09",
    members: [
      { employeeId: 2, employeeNo: "E-2", employeeShare: 100, employerShare: 100, totalContribution: 200 },
      { employeeId: 1, employeeNo: "E-1", employeeShare: 150, employerShare: 150, totalContribution: 300 },
    ],
  });
  const b = statutoryRemittanceSnapshotHash({
    agency: "PhilHealth",
    applicableMonth: "2026-09",
    members: [
      { employeeId: 1, employeeNo: "E-1", employeeShare: 150, employerShare: 150, totalContribution: 300 },
      { employeeId: 2, employeeNo: "E-2", employeeShare: 100, employerShare: 100, totalContribution: 200 },
    ],
  });
  assert.equal(a, b);
});
