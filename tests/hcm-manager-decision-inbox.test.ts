import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveManagerDecisionScope, projectDueState, summarizeDecisionPage,
} from "../src/lib/hcm-manager-decision-contract";

const read = (path: string) => readFileSync(path, "utf8");

test("manager inbox denies company-wide manager and unrelated or unitless roles", () => {
  for (const access of [
    null,
    { role: "manager", companyWide: true, orgUnitId: null },
    { role: "manager", companyWide: false, orgUnitId: null },
    { role: "manager", companyWide: false, orgUnitId: -1 },
    { role: "bookkeeper", companyWide: true, orgUnitId: null },
    { role: "payroll", companyWide: false, orgUnitId: 7 },
    { role: "checker", companyWide: false, orgUnitId: 7 },
    { role: "employee", companyWide: false, orgUnitId: 7 },
  ]) assert.equal(deriveManagerDecisionScope(access), null);
  assert.deepEqual(deriveManagerDecisionScope({
    role: "manager", companyWide: false, orgUnitId: 8,
  }), { kind: "unit", orgUnitId: 8 });
  assert.deepEqual(deriveManagerDecisionScope({
    role: "hr", companyWide: true, orgUnitId: null,
  }), { kind: "company", orgUnitId: null });
  assert.deepEqual(deriveManagerDecisionScope({
    role: "owner", companyWide: false, orgUnitId: 12,
  }), { kind: "unit", orgUnitId: 12 });
});

test("deadline states depend on source dueAt, not effective or leave date", () => {
  const now = new Date("2026-10-10T05:00:00Z");
  assert.deepEqual(projectDueState(null, now), {
    dueAt: null, dueState: "unscheduled",
  });
  assert.deepEqual(projectDueState("malformed", now), {
    dueAt: null, dueState: "unscheduled",
  });
  assert.deepEqual(projectDueState("2026-10-09T11:00:00Z", now), {
    dueAt: "2026-10-09T11:00:00.000Z", dueState: "overdue",
  });
  assert.equal(projectDueState("2026-10-10T05:00:00Z", now).dueState, "upcoming");
  assert.equal(projectDueState("2026-10-11T00:00:00Z", now).dueState, "upcoming");
});

test("page-local indicators never imply tenant-wide approval totals", () => {
  assert.deepEqual(summarizeDecisionPage([
    { dueState: "overdue" } as never,
    { dueState: "upcoming" } as never,
    { dueState: "unscheduled" } as never,
  ]), {
    assignedItemsThisPage: 3, overdueItemsThisPage: 1,
  });
});

test("API and page require explicit tenant, default-off flag and workforce role", () => {
  const route = read("src/app/api/hcm/manager-decision-inbox/route.ts");
  const page = read("src/app/hcm/manager-decision-inbox/page.tsx");
  for (const source of [route, page]) {
    assert.match(source, /HCM_MANAGER_DECISION_INBOX_ENABLED !== "true"/);
    assert.match(source, /getSessionUser/);
    assert.match(source, /assertOrganizationRole/);
    assert.match(source, /WORKFORCE_MANAGER_ROLES/);
    assert.match(source, /deriveManagerDecisionScope/);
    assert.ok(!source.includes("primaryCompanyOrganizationId"));
  }
  assert.match(route, /getAccess\(user\.id, organizationId\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /positiveId/);
  assert.ok(!route.includes("export async function POST"));
  assert.ok(!route.includes("export async function PATCH"));
  assert.ok(!route.includes("export async function DELETE"));
  assert.match(page, /key=\{organizationId\}/);
});

test("all decision source reads constrain BOTH sides of joins to the tenant", () => {
  const source = read("src/lib/hcm-manager-decision-server.ts");
  for (const field of [
    "eq(step.organizationId, organizationId)",
    "eq(instance.organizationId, organizationId)",
    "eq(worker.organizationId, organizationId)",
    "eq(task.organizationId, organizationId)",
    "eq(request.organizationId, organizationId)",
    "eq(approvalDelegations.organizationId, organizationId)",
    "eq(userOrganizations.organizationId, organizationId)",
  ]) assert.ok(source.includes(field), "Missing tenant predicate " + field);
  assert.match(source, /eq\(worker\.orgUnitId, scope\.orgUnitId\)/);
  assert.match(source, /eq\(orgUnits\.active, true\)/);
  assert.match(source, /eq\(orgUnits\.organizationId, organizationId\)/);
  assert.match(source, /MAX_DELEGATIONS \+ 1/);
  assert.match(source, /PAGE_SIZE \+ 1/g);
  assert.match(source, /lt\(step\.id, before\)/);
  assert.match(source, /lt\(request\.id, before\)/);
  assert.match(source, /canDecide\(organizationId, assignee, userName, userId\)/);
  assert.match(source, /if \(!nameUnique\) return null/);
  assert.match(source, /row\.makerId === userId/);
  assert.ok(!source.includes("db.update("));
  assert.ok(!source.includes("db.insert("));
  assert.ok(!source.includes("db.delete("));
  for (const rawField of [
    "bankAccount:", "basicRate:", "reason:", "decisionNote:", "payrollGross:",
    "payrollNet:", "tin:", "sssNo:", "hcmBusinessProcessInstanceSteps.label",
    "approvalTasks.detail",
  ]) assert.ok(!source.includes(rawField), "Unexpected raw sensitive field " + rawField);
});

test("client is read-only and rejects stale source/tenant responses", () => {
  const ui = read("src/components/hcm-manager-decision-inbox.tsx");
  const navigation = read("src/components/workspace/approvals.tsx");
  assert.match(ui, /new AbortController\(\)/);
  assert.match(ui, /controller\.abort\(\)/);
  assert.match(ui, /payload\.organizationId !== organizationId/);
  assert.match(ui, /payload\.source !== source/);
  assert.match(ui, /loaded\?\.key === requestKey/);
  assert.match(ui, /page\.page\.nextCursor/);
  assert.match(navigation, /NEXT_PUBLIC_HCM_MANAGER_DECISION_INBOX_ENABLED === "true"/);
  assert.match(navigation, /data\.selectedOrganization\.id/);
  assert.match(navigation, /data\.access\.role === "manager" && !data\.access\.companyWide/);
  for (const method of ['method: "POST"', 'method: "PATCH"', 'method: "DELETE"']) {
    assert.ok(!ui.includes(method));
  }
  assert.ok(!ui.includes("bankAccount"));
});
