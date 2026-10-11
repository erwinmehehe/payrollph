import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateEnterpriseHcmPlan,
  enterpriseHcmPlanGateEnabled,
} from "../src/lib/hcm-enterprise-plan-policy";

const read = (path: string) => readFileSync(path, "utf8");
const enrolled = {
  HCM_ENTERPRISE_PLAN_GATE_ENABLED: "true",
  HCM_ENTERPRISE_PLAN_GATE_ORG_IDS: "1,2",
};
const enterprise = {
  plan: "Enterprise", active: true, status: "active",
  features: ["advanced-hcm-discovery"],
};

test("advanced Action Center and Worker 360 pages gate only AFTER same-employer HR authorization", () => {
  const cases = [
    { path: "src/app/hcm/action-center/page.tsx",
      auth: '!["owner", "admin", "hr"].includes(access.role)' },
    { path: "src/app/hcm/worker-360/page.tsx",
      auth: '!["owner", "admin", "hr"].includes(access.role)' },
  ];
  for (const { path, auth } of cases) {
    const source = read(path);
    const actor = source.indexOf("getSessionUser()");
    const org = source.indexOf("assertOrganizationRole(");
    const role = source.indexOf(auth);
    const paid = source.indexOf("denyOptInEnterpriseHcmPlan(organizationId)");
    assert.ok(actor >= 0 && org > actor && role > org && paid > role,
      "Actor/tenant/permission checks must happen before billing: " + path);
    assert.equal(source.split("denyOptInEnterpriseHcmPlan(organizationId)").length - 1, 1);
    assert.ok(source.slice(paid).includes("if (planDenied) notFound()"));
  }
});

test("Worker 360 JSON API must enforce paid depth before reading worker history", () => {
  const path = "src/app/api/hcm/worker-360/route.ts";
  const route = read(path);
  const authorize = route.indexOf("assertOrganizationRole(");
  const scope = route.indexOf('!["owner", "admin", "hr"].includes(access.role)');
  const paid = route.indexOf("denyOptInEnterpriseHcmPlan(organizationId)");
  const source = route.indexOf("loadWorker360Summary(organizationId, employeeId, asOfDate)");
  assert.ok(authorize >= 0 && scope > authorize && paid > scope && source > paid);
  assert.equal(route.split("denyOptInEnterpriseHcmPlan(organizationId)").length - 1, 1);
  assert.ok(route.includes("if (planDenied) return planDenied;"));
  assert.ok(route.includes('if (process.env.HCM_WORKER_360_ENABLED !== "true")'));
});

test("assigned inbox GET and governed POST remain accessible under existing source-bound RBAC", () => {
  const source = read("src/app/api/hcm/business-processes/inbox/route.ts");
  assert.ok(source.includes("export async function GET"));
  assert.ok(source.includes("export async function POST"));
  assert.ok(source.includes("loadPeopleHomeAssigneePermissions("));
  assert.ok(source.includes("canDecide("));
  assert.ok(source.includes("completeHcmBusinessProcessWorkItemTx("));
  assert.ok(!source.includes("denyOptInEnterpriseHcmPlan"),
    "Do not accidentally paywall assigned reviews/approvals needed by ordinary HR users");
  const app = read("src/components/workspace/people.tsx");
  assert.ok(app.includes("HcmBusinessProcessInbox"));
});

test("plan/role checks add no subscription query for non-enrolled employers", () => {
  assert.equal(enterpriseHcmPlanGateEnabled(1, {}), false);
  assert.equal(evaluateEnterpriseHcmPlan(1, enterprise, {}), "not-enforced");
  assert.equal(evaluateEnterpriseHcmPlan(1, enterprise, enrolled), "allowed");
  assert.equal(evaluateEnterpriseHcmPlan(2,
    { ...enterprise, plan: "Core", features: [] }, enrolled), "enterprise-required");
  assert.equal(evaluateEnterpriseHcmPlan(1,
    { ...enterprise, status: "none" }, enrolled), "subscription-missing");
  assert.equal(evaluateEnterpriseHcmPlan(3, null, enrolled), "not-enforced");
});
