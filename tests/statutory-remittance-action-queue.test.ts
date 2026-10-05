import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const route = readFileSync("src/app/api/compliance/remittance-actions/route.ts", "utf8");
const state = readFileSync("src/lib/statutory-remittance-state.ts", "utf8");
const remittanceRoute = readFileSync("src/app/api/compliance/statutory-remittances/route.ts", "utf8");
const panel = readFileSync("src/components/workspace/statutory-remittance-panel.tsx", "utf8");
const queue = readFileSync("src/components/workspace/statutory-remittance-action-queue.tsx", "utf8");
const payroll = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");

test("compliance actions are first-class persistent records, not approval tasks", () => {
  assert.ok(schema.includes('export const complianceActionTasks = pgTable('));
  assert.ok(schema.includes('"compliance_action_tasks"'));
  assert.ok(schema.includes('uniqueIndex("compliance_action_source_unique")'));
  assert.ok(schema.includes('assignedToUserId: integer("assigned_to_user_id")'));
  assert.ok(schema.includes('resolvedAt: timestamp("resolved_at"'));
});

test("dashboard alerts and action queue share one remittance state loader", () => {
  assert.ok(state.includes("buildStatutoryRemittanceAlerts"));
  assert.ok(remittanceRoute.includes("loadStatutoryRemittanceState"));
  assert.ok(route.includes("loadStatutoryRemittanceState"));
});

test("queue sync creates, reopens and auto-resolves from underlying evidence", () => {
  assert.ok(route.includes("activeKeys"));
  assert.ok(route.includes('status: wasResolved ? "open" : current.status'));
  assert.ok(route.includes('status: "resolved"'));
  assert.ok(route.includes("resolved += 1"));
  assert.ok(route.includes("reopened += 1"));
});

test("operators cannot manually resolve a statutory compliance action", () => {
  assert.ok(route.includes("Compliance actions resolve only from underlying evidence."));
  assert.ok(!route.includes('action === "resolve"'));
  assert.ok(route.includes("Resolved compliance actions are read-only."));
});

test("assignment is restricted to authorized payroll operators in the same organization", () => {
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes("roleAllowed(membership.role, PAYROLL_OPERATOR_ROLES)"));
  assert.ok(route.includes("eq(userOrganizations.organizationId, organizationId)"));
  assert.ok(route.includes("eq(userOrganizations.userId, assignedToUserId)"));
});

test("queue mutations use same-origin protection, rate limits and audit events", () => {
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes("recordAuditEvent"));
});

test("remittance changes trigger queue resynchronization and payroll exposes the queue", () => {
  assert.ok(panel.includes('window.dispatchEvent(new Event("statutory-remittance-changed"))'));
  assert.ok(queue.includes('window.addEventListener("statutory-remittance-changed"'));
  assert.ok(queue.includes('action: "sync"'));
  assert.ok(queue.includes("cannot be manually closed"));
  assert.ok(payroll.includes("<StatutoryRemittanceActionQueue"));
});
