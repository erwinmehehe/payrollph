import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildOperationsAttention,
  type OperationsAttentionInput,
} from "../src/lib/operations-attention";
import {
  NAVIGATION,
  PRIMARY_NAVIGATION,
  SECONDARY_NAVIGATION,
} from "../src/components/workspace/nav";

const base: OperationsAttentionInput = {
  role: "owner",
  missingBankDetails: 0,
  missingGovernmentIds: 0,
  pendingApprovals: 0,
  payrollExceptions: 0,
  failedPayrollJobs: 0,
  emailFailures: 0,
  emailDeliveryIssues: 0,
  webhookRetrying: 0,
  webhookExhausted: 0,
  payoutFailed: 0,
  payoutPending: 0,
  payoutRegressed: false,
};

test("primary workspace navigation stays payroll-first and intentionally small", () => {
  const primary = PRIMARY_NAVIGATION.flatMap((group) => group.items.map((item) => item.name));
  assert.deepEqual(primary, [
    "Overview",
    "People",
    "Payroll",
    "Time & attendance",
    "Approvals",
    "Analytics",
    "Settings",
  ]);
  assert.equal(primary.length, 7);

  const all = NAVIGATION.flatMap((group) => group.items.map((item) => item.name));
  for (const secondary of ["Migration", "Compliance", "Exports", "Recruitment", "Developer", "Audit trail"]) {
    assert.ok(all.includes(secondary), secondary + " must remain reachable");
    assert.ok(!primary.includes(secondary), secondary + " must stay out of primary navigation");
  }
  assert.ok(SECONDARY_NAVIGATION.length >= 1);
});

test("secondary navigation is exposed through one explicit More control", () => {
  const shell = readFileSync("src/components/workspace/shell.tsx", "utf8");
  assert.ok(shell.includes("SECONDARY_NAVIGATION"));
  assert.ok(shell.includes('>More</span>'));
  assert.ok(shell.includes("setMoreOpen"));
  assert.ok(shell.includes("secondaryPageActive"));
});

test("owner attention queue prioritizes money and delivery failures", () => {
  const result = buildOperationsAttention({
    ...base,
    failedPayrollJobs: 1,
    payoutFailed: 2,
    emailFailures: 1,
    webhookExhausted: 1,
    payrollExceptions: 3,
    missingBankDetails: 2,
    pendingApprovals: 4,
  });

  assert.equal(result.items[0].severity, "critical");
  assert.ok(result.items.some((item) => item.key === "payout-failed"));
  assert.ok(result.items.some((item) => item.key === "email-delivery"));
  assert.ok(result.items.some((item) => item.key === "webhook-delivery"));
  assert.ok(result.items.some((item) => item.key === "missing-bank-details"));
  assert.ok(result.critical >= 4);
});

test("HR attention queue never exposes delivery, webhook or payout operations", () => {
  const result = buildOperationsAttention({
    ...base,
    role: "hr",
    missingBankDetails: 2,
    missingGovernmentIds: 3,
    pendingApprovals: 1,
    emailFailures: 4,
    webhookExhausted: 5,
    payoutFailed: 6,
  });

  const keys = result.items.map((item) => item.key);
  assert.ok(keys.includes("missing-bank-details"));
  assert.ok(keys.includes("missing-government-ids"));
  assert.ok(keys.includes("pending-approvals"));
  assert.ok(!keys.includes("email-delivery"));
  assert.ok(!keys.includes("webhook-delivery"));
  assert.ok(!keys.includes("payout-failed"));
});

test("payroll attention queue shows payroll recovery but not owner-only payout state", () => {
  const result = buildOperationsAttention({
    ...base,
    role: "payroll",
    failedPayrollJobs: 2,
    payrollExceptions: 3,
    payoutFailed: 1,
    emailFailures: 1,
  });

  const keys = result.items.map((item) => item.key);
  assert.deepEqual(keys.sort(), ["payroll-exceptions", "payroll-jobs-failed"].sort());
});

test("dashboard operational summary uses sanitized state rows instead of exposing delivery records", () => {
  const dashboard = readFileSync("src/lib/dashboard-data.ts", "utf8");
  assert.ok(dashboard.includes("status: outbox.status"));
  assert.ok(dashboard.includes("deliveryStatus: outbox.deliveryStatus"));
  assert.ok(dashboard.includes("status: webhookDeliveries.status"));
  assert.ok(!dashboard.includes("recipient: outbox.recipient"));
  assert.ok(!dashboard.includes("url: webhook"));
  assert.ok(dashboard.includes("buildOperationsAttention"));
});

test("Overview renders one shared needs-attention center", () => {
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  assert.ok(workspace.includes("NeedsAttentionCenter"));
  assert.ok(workspace.includes("data.operationsAttention"));
  assert.ok(workspace.includes("onOpenOutbox"));
});
