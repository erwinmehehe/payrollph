import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  enterpriseHcmPlanGateEnabled, evaluateEnterpriseHcmPlan, resolveEnterpriseHcmPlan,
} from "../src/lib/hcm-enterprise-plan-policy";

const optIn = {
  HCM_ENTERPRISE_PLAN_GATE_ENABLED: "true",
  HCM_ENTERPRISE_PLAN_GATE_ORG_IDS: "17, 19",
};
const enterprise = {
  plan: "Enterprise", active: true, status: "active",
  features: ["advanced-hcm-discovery", "payroll"],
};

test("default-off and exact legal-employer allowlist preserve existing pilots", () => {
  assert.equal(enterpriseHcmPlanGateEnabled(17, {}), false);
  assert.equal(enterpriseHcmPlanGateEnabled(17, { HCM_ENTERPRISE_PLAN_GATE_ENABLED: "true" }), false);
  assert.equal(enterpriseHcmPlanGateEnabled(17, optIn), true);
  assert.equal(enterpriseHcmPlanGateEnabled(19, optIn), true);
  assert.equal(enterpriseHcmPlanGateEnabled(18, optIn), false);
  for (const literal of ["170", "017", "17.0", "1e1", "", "invalid"]) {
    assert.equal(enterpriseHcmPlanGateEnabled(17, { ...optIn, HCM_ENTERPRISE_PLAN_GATE_ORG_IDS: literal }), false);
  }
  for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    assert.equal(enterpriseHcmPlanGateEnabled(invalid, optIn), false);
  }
});

test("opted-in route requires verified active Enterprise feature and subscription", () => {
  assert.equal(evaluateEnterpriseHcmPlan(17, enterprise, optIn), "allowed");
  assert.equal(evaluateEnterpriseHcmPlan(17, { ...enterprise, active: false }, optIn), "subscription-inactive");
  assert.equal(evaluateEnterpriseHcmPlan(17, { ...enterprise, status: "none" }, optIn), "subscription-missing");
  assert.equal(evaluateEnterpriseHcmPlan(17, { ...enterprise, features: [] }, optIn), "enterprise-required");
  for (const plan of ["Solo", "Core", "Scale", "enterprise", "unknown"]) {
    assert.equal(evaluateEnterpriseHcmPlan(17, { ...enterprise, plan }, optIn), "enterprise-required");
  }
  assert.equal(evaluateEnterpriseHcmPlan(17, null, optIn), "entitlements-unavailable");
  assert.equal(evaluateEnterpriseHcmPlan(18, { ...enterprise, plan: "Core" }, optIn), "not-enforced");
  // An expired trial is inactive even if its nominal plan remains Enterprise.
  assert.equal(evaluateEnterpriseHcmPlan(17, { ...enterprise, status: "trialing", active: false }, optIn), "subscription-inactive");
});

test("both read-only APIs and pages enforce the same check after actor/tenant authorization", () => {
  const sources = [
    ["src/app/api/hcm/org-explorer/route.ts", "denyHcmOrgExplorer(user.id, organizationId)"],
    ["src/app/api/hcm/process-monitor/route.ts", "assertOrganizationRole(user.id, organizationId"],
    ["src/app/hcm/org-explorer/page.tsx", "denyHcmOrgExplorer(user.id, organizationId)"],
    ["src/app/hcm/process-monitor/page.tsx", "assertOrganizationRole(user.id, organizationId"],
  ] as const;
  for (const [path, authBoundary] of sources) {
    const code = readFileSync(path, "utf8");
    const authorizes = code.indexOf(authBoundary);
    const gates = code.indexOf("denyOptInEnterpriseHcmPlan(organizationId)");
    assert.ok(authorizes >= 0, "Missing actor/tenant authorization: " + path);
    assert.ok(gates > authorizes, "Billing check must not bypass actor/tenant authorization: " + path);
    assert.equal(code.split("denyOptInEnterpriseHcmPlan(organizationId)").length - 1, 1);
  }
});

test("non-opted employers cause no billing query; billing outages fail closed for opted-in employers", async () => {
  let calls = 0;
  const failingLookup = async () => { calls++; throw new Error("synthetic billing outage - secret"); };
  assert.equal(await resolveEnterpriseHcmPlan(18, optIn, failingLookup), "not-enforced");
  assert.equal(calls, 0);
  assert.equal(await resolveEnterpriseHcmPlan(17, optIn, failingLookup), "entitlements-unavailable");
  assert.equal(calls, 1);
  assert.equal(await resolveEnterpriseHcmPlan(17, optIn, async () => enterprise), "allowed");
});
