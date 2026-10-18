import assert from "node:assert/strict";
import test from "node:test";
import { PLAN_FEATURES } from "../src/lib/billing-matrix";
import { evaluateAdvancedHcmPlan, resolveAdvancedHcmPlan } from "../src/lib/enterprise-advanced-plan-policy";

const env = {
  HCM_ENTERPRISE_PLAN_GATE_ENABLED: "true",
  HCM_ENTERPRISE_PLAN_GATE_ORG_IDS: "17, 19",
};
const active = { plan: "Enterprise", status: "active", active: true, features: PLAN_FEATURES.Enterprise };

test("only exact-opted-in employers can trigger advanced billing checks", async () => {
  let lookups = 0;
  const lookup = async () => { lookups++; return active; };
  assert.equal(await resolveAdvancedHcmPlan(17, "planning", {}, lookup), "not-enforced");
  assert.equal(await resolveAdvancedHcmPlan(18, "compensation", env, lookup), "not-enforced");
  assert.equal(lookups, 0);
  assert.equal(await resolveAdvancedHcmPlan(17, "planning", env, lookup), "allowed");
  assert.equal(await resolveAdvancedHcmPlan(19, "compensation", env, lookup), "allowed");
  assert.equal(lookups, 2);
  assert.equal(await resolveAdvancedHcmPlan(17, "planning", env, async () => {throw new Error("Sensitive provider error")}), "entitlements-unavailable");
});

test("two advanced products require their own active Enterprise entitlement", () => {
  for (const featureKind of ["planning", "compensation"] as const) {
    assert.equal(evaluateAdvancedHcmPlan(17, featureKind, active, env), "allowed");
    assert.equal(evaluateAdvancedHcmPlan(17, featureKind, null, env), "entitlements-unavailable");
    assert.equal(evaluateAdvancedHcmPlan(17, featureKind, { ...active, status: "none" }, env), "missing-subscription");
    assert.equal(evaluateAdvancedHcmPlan(17, featureKind, { ...active, active: false }, env), "inactive-subscription");
    assert.equal(evaluateAdvancedHcmPlan(17, featureKind, { ...active, status: "trialing", active: false }, env), "inactive-subscription");
    for (const plan of ["Core", "Scale", "Solo", "enterprise", "unknown"]) {
      assert.equal(evaluateAdvancedHcmPlan(17, featureKind, { ...active, plan }, env), "enterprise-required");
    }
    assert.equal(evaluateAdvancedHcmPlan(17, featureKind, { ...active, features: [] }, env), "enterprise-required");
    assert.equal(evaluateAdvancedHcmPlan(18, featureKind, { ...active, plan: "Core" }, env), "not-enforced");
  }
});

test("advanced planning and compensation are distinct from discovery and baseline Core payroll", () => {
  assert.ok(PLAN_FEATURES.Enterprise.includes("advanced-workforce-planning"));
  assert.ok(PLAN_FEATURES.Enterprise.includes("advanced-compensation-configuration"));
  for (const plan of ["Solo", "Core", "Scale"] as const) {
    assert.ok(!PLAN_FEATURES[plan].includes("advanced-workforce-planning"));
    assert.ok(!PLAN_FEATURES[plan].includes("advanced-compensation-configuration"));
    assert.ok(PLAN_FEATURES[plan].includes(plan === "Solo" ? "self-service" : "payroll"));
  }
});
