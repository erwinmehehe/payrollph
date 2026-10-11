import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  MONITOR_FILTERS,
  canReadHcmProcessMonitor,
  canonicalHcmId,
  monitorBusinessDate,
  monitorEnabledForEmployer,
  projectMonitorProcess,
  projectMonitorStep,
  validMonitorFilter,
} from "../src/lib/hcm-process-monitor";

test("monitor remains default off, employer-allowlisted and requires canonical positive IDs", () => {
  const flags = {
    HCM_PROCESS_MONITOR_ENABLED: "true",
    HCM_PROCESS_MONITOR_ORG_IDS: "17, 18",
  };
  assert.equal(monitorEnabledForEmployer(17, flags), true);
  assert.equal(monitorEnabledForEmployer(18, flags), true);
  for (const org of [0, 16, 19, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(monitorEnabledForEmployer(org, flags), false);
  }
  assert.equal(monitorEnabledForEmployer(17, {}), false);
  assert.equal(monitorEnabledForEmployer(17, { ...flags, HCM_PROCESS_MONITOR_ENABLED: "false" }), false);
  assert.equal(monitorEnabledForEmployer(17, { ...flags, HCM_PROCESS_MONITOR_ORG_IDS: "017, 18" }), false);

  for (const invalid of ["", "0", "-1", "001", "1.2", "1e3", "Infinity", "9007199254740992"]) {
    assert.equal(canonicalHcmId(invalid), null, invalid);
  }
  assert.equal(canonicalHcmId("17"), 17);
  assert.equal(canonicalHcmId("0", true), 0);
  assert.equal(canonicalHcmId("0"), null);
});

test("monitor role scope excludes finance, unit HR, managers, employees and checker", () => {
  for (const role of ["owner", "admin", "hr"]) {
    assert.equal(canReadHcmProcessMonitor({ role, companyWide: true }), true);
    assert.equal(canReadHcmProcessMonitor({ role, companyWide: false }), false);
  }
  for (const role of ["bookkeeper", "payroll", "checker", "employee", "manager", "auditor"]) {
    assert.equal(canReadHcmProcessMonitor({ role, companyWide: true }), false);
  }
  assert.equal(canReadHcmProcessMonitor(null), false);
});

test("status filters are enumerated and unknown labels never leak untrusted source text", () => {
  for (const filter of MONITOR_FILTERS) assert.ok(validMonitorFilter(filter));
  for (const unsafe of ["any", "APPROVED", "approved; DROP", "private note"]) {
    assert.equal(validMonitorFilter(unsafe), false);
  }
  const projected = projectMonitorProcess({
    id: 31,
    processType: "Secret worker name / compensation",
    status: "Sensitive pending",
    currentStepIndex: -2,
    effectiveDate: "2026-02-30",
    initiatedAt: new Date("2026-10-11T00:00:00Z"),
    updatedAt: null,
    completedAt: null,
  }, 7);
  assert.equal(projected.type, "other");
  assert.equal(projected.status, "unknown");
  assert.equal(projected.effectiveDate, null);
  assert.equal(projected.currentStepIndex, null);
  assert.ok(!JSON.stringify(projected).includes("Secret worker"));
  assert.ok(!JSON.stringify(projected).includes("Sensitive pending"));
  assert.equal(monitorBusinessDate("2026-02-29"), null);
  assert.equal(monitorBusinessDate("2024-02-29"), "2024-02-29");
});

test("SLA logic uses valid timed deadlines, not PH business dates", () => {
  const observed = new Date("2026-10-11T00:00:00Z");
  const base = {
    id: 8, stepIndex: 0, stepType: "approval",
    status: "pending", assignee: "privateemployee@example.test",
    dueAt: new Date("2026-10-10T23:00:00Z"),
    completedAt: null,
  };
  const overdue = projectMonitorStep(base, observed);
  assert.equal(overdue.dueEvidence, "recorded");
  assert.equal(overdue.overdue, true);
  assert.equal(overdue.assignmentKind, "named_or_other");
  assert.ok(!JSON.stringify(overdue).includes("privateemployee"));
  const role = projectMonitorStep({ ...base, assignee: "role:hr" }, observed);
  assert.equal(role.assignmentKind, "role");
  assert.equal(projectMonitorStep({ ...base, status: "completed" }, observed).overdue, false);
  assert.equal(projectMonitorStep({ ...base, status: "waiting" }, observed).overdue, false);
  assert.equal(projectMonitorStep({ ...base, dueAt: null }, observed).dueEvidence, "missing");
  assert.equal(projectMonitorStep({ ...base, dueAt: null }, observed).overdue, false);
  assert.equal(projectMonitorStep({ ...base, dueAt: "not a date" }, observed).dueEvidence, "unverified");
  assert.equal(projectMonitorStep({ ...base, dueAt: "not a date" }, observed).overdue, false);
  assert.equal(projectMonitorStep({ ...base, dueAt: "2026-10-11T00:00:00Z" }, observed).overdue, false);
  assert.equal(projectMonitorStep({ ...base, dueAt: "2026-10-11T01:00:00Z" }, observed).overdue, false);
});

test("page and API independently enforce the read-only employer feature and People authorization", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  const api = read("src/app/api/hcm/process-monitor/route.ts");
  const page = read("src/app/hcm/process-monitor/page.tsx");
  const loader = read("src/lib/hcm-process-monitor-server.ts");
  const inbox = read("src/components/hcm-business-process-inbox.tsx");

  for (const content of [api, page]) {
    assert.ok(content.includes("monitorEnabledForEmployer(organizationId)"));
    assert.ok(content.includes("getSessionUser()"));
    assert.ok(content.includes("assertOrganizationRole("));
    assert.ok(content.includes("PEOPLE_ADMIN_ROLES"));
    assert.ok(content.includes("canReadHcmProcessMonitor(access)"));
    assert.ok(!content.includes("primaryCompanyOrganizationId("));
  }
  assert.ok(api.includes("private, no-store"));
  assert.ok(!api.includes("export async function POST("));
  assert.ok(!api.includes("export async function PATCH("));
  assert.ok(!api.includes("export async function DELETE("));
  assert.ok(!loader.includes("db.insert("));
  assert.ok(!loader.includes("db.update("));
  assert.ok(!loader.includes("db.delete("));
  assert.ok(!loader.includes("db.select().from"));
  assert.ok(loader.includes("eq(hcmBusinessProcessInstances.organizationId, organizationId)"));
  assert.ok(loader.includes("eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId)"));
  assert.ok(loader.includes("MONITOR_PAGE_SIZE + 1"));
  assert.ok(loader.includes("MONITOR_STEP_LIMIT + 1"));
  assert.ok(loader.includes("lt(hcmBusinessProcessInstances.id, cursor)"));
  assert.ok(loader.includes("stepsPartial: stepRows.length > MONITOR_STEP_LIMIT"));
  assert.ok(!loader.includes("definitionSnapshot:"));
  assert.ok(!loader.includes("decisionNote:"));
  assert.ok(!loader.includes("sourceKey:"));
  assert.ok(!loader.includes("initiatedByName:"));
  assert.ok(!loader.includes("basicRate:"));
  assert.ok(!loader.includes("bankAccount:"));
  assert.ok(page.includes('aria-label="Process history pagination"'));
  assert.ok(page.includes('aria-label="Recorded process steps"'));
  assert.ok(page.includes("No timed SLA recorded"));
  assert.ok(page.includes("Source timestamp needs verification"));
  assert.ok(page.includes("source records. Do not treat this as an empty queue"));
  assert.ok(inbox.includes("NEXT_PUBLIC_HCM_PROCESS_MONITOR_ENABLED"));
  assert.ok(inbox.includes("NEXT_PUBLIC_HCM_PROCESS_MONITOR_ORG_IDS"));
  assert.ok(!inbox.includes("Monitor workflows</button>"));
});
