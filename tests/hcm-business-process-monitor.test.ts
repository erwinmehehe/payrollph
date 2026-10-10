import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HCM_BP_MONITOR_PAGE_SIZE,
  bpMonitorCursorFor,
  parseBpMonitorCursor,
  projectBpMonitorInstance,
  projectBpMonitorStep,
  validBpMonitorFilter,
} from "../src/lib/hcm-business-process-monitor-projection";

const read = (path: string) => readFileSync(path, "utf8");
const access = read("src/lib/hcm-business-process-monitor-access.ts");
const listApi = read("src/app/api/hcm/business-process-monitor/route.ts");
const detailApi = read("src/app/api/hcm/business-process-monitor/[instanceId]/route.ts");
const page = read("src/app/hcm/business-process-monitor/page.tsx");
const loader = read("src/lib/hcm-business-process-monitor-server.ts");
const client = read("src/components/hcm-business-process-monitor.tsx");

test("filter rejects arbitrary statuses; cursor validates timestamp/positive source ID", () => {
  assert.equal(validBpMonitorFilter("all"), true);
  assert.equal(validBpMonitorFilter("in_progress"), true);
  assert.equal(validBpMonitorFilter("approved"), true);
  assert.equal(validBpMonitorFilter("pending"), false);
  const stamp = new Date("2026-10-10T04:00:00.000Z");
  const raw = bpMonitorCursorFor({
    id: 41, definitionCode: "BP", definitionVersion: 1, processType: "change_job",
    sourceType: "worker_change", status: "in_progress", currentStepIndex: 0,
    effectiveDate: null, initiatedAt: stamp, completedAt: null,
  });
  assert.equal(parseBpMonitorCursor(raw)?.id, 41);
  assert.equal(parseBpMonitorCursor(raw)?.initiatedAt.toISOString(), stamp.toISOString());
  for (const bad of ["", "false", "2026-10-10T04:00:00Z~41", "2026-10-10T04:00:00.000Z~0",
    "2026-02-30T04:00:00.000Z~12", "2026-10-10T04:00:00.000Z~1.5", "2026-10-10T04:00:00.000Z~-1",
    "2026-10-10T04:00:00.000Z~999999999999999999"]) {
    assert.equal(parseBpMonitorCursor(bad), null);
  }
  assert.equal(HCM_BP_MONITOR_PAGE_SIZE, 20);
});

test("SLA only marks actual pending steps with real timestamps as overdue", () => {
  const now = new Date("2026-10-10T04:00:00.000Z");
  const base = {
    id: 12, stepIndex: 0, stepType: "approval", assignee: "role:hr",
    status: "pending", dueAt: null, completedAt: null,
  };
  assert.equal(projectBpMonitorStep(base, now).sla, "untracked");
  assert.equal(projectBpMonitorStep({ ...base, dueAt: new Date("2026-10-09T04:00:00.000Z") }, now).sla, "overdue");
  assert.equal(projectBpMonitorStep({ ...base, dueAt: new Date("2026-10-11T04:00:00.000Z") }, now).sla, "due_later");
  assert.equal(projectBpMonitorStep({
    ...base, status: "completed", dueAt: new Date("2026-10-09T04:00:00.000Z"),
  }, now).sla, "not_pending");
  assert.equal(projectBpMonitorStep({ ...base, stepType: "arbitrary text" }, now).stepType, "unknown");
});

test("process and step projections exclude snapshots, private decision notes and salary", () => {
  const rawInstance = {
    id: 23, definitionCode: "CHANGE_JOB", definitionVersion: 3, processType: "change_job",
    sourceType: "worker_effective_change", status: "in_progress", currentStepIndex: 1,
    effectiveDate: "2026-11-01",
    initiatedAt: new Date("2026-10-10T04:00:00Z"), completedAt: null,
    definitionSnapshot: { reason: "Do not display" },
    sourceKey: "SENSITIVE-KEY", salaryAmount: "87500",
    employeeTin: "PRIVATE-IDENTIFIER",
  };
  const projectedInstance = JSON.stringify(projectBpMonitorInstance(rawInstance));
  for (const sensitive of ["Do not display", "SENSITIVE-KEY", "87500", "PRIVATE-IDENTIFIER"]) {
    assert.ok(!projectedInstance.includes(sensitive));
  }
  const rawStep = {
    id: 24, stepIndex: 1, stepType: "review", assignee: "role:hr", status: "pending",
    dueAt: null, completedAt: null, decisionNote: "PRIVATE DECISION", bankAccount: "55555",
  };
  const projectedStep = JSON.stringify(projectBpMonitorStep(rawStep));
  assert.ok(!projectedStep.includes("PRIVATE DECISION"));
  assert.ok(!projectedStep.includes("55555"));
});

test("both endpoints and page are default-off, session-authenticated and tenant-scoped", () => {
  for (const src of [listApi, detailApi, page]) {
    assert.match(src, /HCM_BP_MONITOR_ENABLED !== "true"/);
    assert.match(src, /getSessionUser\(\)/);
    assert.match(src, /denyBpMonitor/);
    assert.ok(!src.includes("primaryCompanyOrganizationId"));
  }
  for (const src of [listApi, detailApi]) {
    assert.ok(!src.includes("export async function POST"));
    assert.ok(!src.includes("export async function PATCH"));
  }
  assert.match(access, /assertOrganizationRole/);
  assert.match(access, /PEOPLE_ADMIN_ROLES/);
  assert.match(access, /companyWide/);
  assert.match(access, /"owner", "admin", "hr"/);
  assert.match(access, /private, no-store/);
  assert.match(access, /Number\.isSafeInteger\(id\)/);
});

test("list uses bound keyset and detail queries both enforce employer + instance", () => {
  assert.match(loader, /eq\(hcmBusinessProcessInstances\.organizationId, organizationId\)/);
  assert.match(loader, /lt\(hcmBusinessProcessInstances\.initiatedAt, cursor\.initiatedAt\)/);
  assert.match(loader, /lt\(hcmBusinessProcessInstances\.id, cursor\.id\)/);
  assert.match(loader, /orderBy\(desc\(hcmBusinessProcessInstances\.initiatedAt\), desc\(hcmBusinessProcessInstances\.id\)\)/);
  assert.match(loader, /limit\(HCM_BP_MONITOR_PAGE_SIZE \+ 1\)/);
  assert.match(loader, /eq\(hcmBusinessProcessInstances\.id, instanceId\)/);
  assert.match(loader, /eq\(hcmBusinessProcessInstanceSteps\.organizationId, organizationId\)/);
  assert.match(loader, /eq\(hcmBusinessProcessInstanceSteps\.instanceId, instanceId\)/);
  assert.match(loader, /limit\(HCM_BP_MONITOR_STEP_LIMIT \+ 1\)/);
  assert.ok(!loader.includes("db.select().from"));
  for (const danger of ["decisionNote:", "definitionSnapshot:", "sourceKey:", "grossPay:", "bankAccount:"]) {
    assert.ok(!loader.includes(danger), "sensitive field must not enter API: " + danger);
  }
});

test("client aborts stale requests and verifies employer and selected workflow IDs", () => {
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /controller\.abort\(\)/);
  assert.match(client, /data\.tenantId !== organizationId/);
  assert.match(client, /data\.instance\.id !== selected\.id/);
  assert.match(client, /list\?\.scope === listScope/);
  assert.match(client, /detail\?\.scope === detailScope/);
  assert.match(client, /nextCursor/);
  assert.match(client, /"untracked"/);
  assert.ok(!client.includes('method: "POST"'));
  assert.ok(!client.includes('method: "PATCH"'));
});
