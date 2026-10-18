import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isValidRemittanceQueuePayload } from "../src/lib/statutory-remittance-queue-payload";

const fixture = () => ({
  organizationId: 51, currentUserId: 7,
  tasks: [{
    id: 10, organizationId: 51, sourceKey: "synthetic:sss",
    agency: "SSS", applicableMonth: "2026-10", severity: "warning",
    title: "Fictional remittance alert", detail: "Synthetic missing receipt",
    dueDate: "2026-10-31", status: "open", assignedToUserId: null,
    assignedToName: null, acknowledgedByName: null,
    acknowledgedAt: null, resolvedAt: null,
    ageHours: 2, severityAgeHours: 1, escalationStage: 0,
  }],
  assignees: [{userId: 7, role: "payroll", name: "Test Operator"}],
});

test("verified empty and nonempty queues preserve truthful read status", () => {
  assert.equal(isValidRemittanceQueuePayload(fixture(), 51), true);
  assert.equal(isValidRemittanceQueuePayload({ ...fixture(), tasks: [], assignees: [] }, 51), true);
});

test("partial, corrupt, duplicate and wrong-tenant records fail closed", () => {
  const f = fixture();
  for (const value of [
    null, {}, { currentUserId: 7 }, { ...f, tasks: undefined },
    { ...f, tasks: null }, { ...f, assignees: null },
    { ...f, assignees: "unavailable" }, { ...f, organizationId: 52 },
    { ...f, currentUserId: 0 },
    { ...f, tasks: [{ ...f.tasks[0], organizationId: 52 }] },
    { ...f, tasks: [{ ...f.tasks[0], id: "10" }] },
    { ...f, tasks: [{ ...f.tasks[0], status: "unknown" }] },
    { ...f, tasks: [{ ...f.tasks[0], severity: "all clear" }] },
    { ...f, tasks: [{ ...f.tasks[0], ageHours: Number.NaN }] },
    { ...f, tasks: [{ ...f.tasks[0], escalationStage: 4 }] },
    { ...f, tasks: [{ ...f.tasks[0], title: null }] },
    { ...f, tasks: [f.tasks[0], f.tasks[0]] },
    { ...f, assignees: [{userId: 7, name: null, role: "payroll"}] },
  ]) assert.equal(isValidRemittanceQueuePayload(value, 51), false);
  assert.equal(isValidRemittanceQueuePayload(f, 52), false);
});

test("API returns current employer, and GET/sync and retry block false green success", () => {
  const api = readFileSync("src/app/api/compliance/remittance-actions/route.ts", "utf8");
  const ui = readFileSync("src/components/workspace/statutory-remittance-action-queue.tsx", "utf8");
  assert.match(api, /return \{\s*organizationId,\s*currentUserId,\s*tasks:/);
  assert.match(api, /eq\(complianceActionTasks.organizationId, organizationId\)/);
  assert.equal((ui.match(/if \(!isValidRemittanceQueuePayload\(body, organizationId\)\)/g) ?? []).length, 2);
  assert.match(ui, /\(reading \|\| payload === null \|\| readError\)/);
  assert.ok(!ui.includes("readOnlyOnOpen && (reading || payload === null || readError)"));
  assert.match(ui, /Retry reading actions/);
  assert.match(ui, /Retry synchronizing actions/);
  assert.match(ui, /if \(readOnlyOnOpen\) read\(\);\s*else void sync\(true\)/);
  assert.match(ui, /setReadError\(message\)/);
  assert.match(ui, /No unresolved statutory remittance actions/);
  const browser = readFileSync("scripts/qa/first-payroll-connected-browser.mjs", "utf8");
  assert.ok(browser.includes("json:{organizationId,currentUserId:1"));
  assert.ok(browser.includes("{id:organizationId,organizationId,sourceKey:"));
  assert.ok(browser.includes("json:{organizationId:1,currentUserId:1"));
  assert.ok(browser.includes("Loading or verifying statutory compliance actions…"));
});
