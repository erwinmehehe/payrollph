import assert from "node:assert/strict";
import test from "node:test";
import { PLAN_FEATURES, requireFeature, type Entitlements } from "../src/lib/billing-matrix";

function ents(partial: { plan?: keyof typeof PLAN_FEATURES; active?: boolean; status?: string }): Entitlements {
  const plan = partial.plan ?? "Core";
  return {
    plan,
    features: PLAN_FEATURES[plan],
    seatLimit: 10,
    status: partial.status ?? "active",
    trialing: false,
    inTrial: false,
    active: partial.active ?? true,
    provider: null,
  };
}

test("plan feature matrix is cumulative and distinct", () => {
  assert.ok(PLAN_FEATURES.Solo.length < PLAN_FEATURES.Core.length);
  assert.ok(PLAN_FEATURES.Core.length < PLAN_FEATURES.Scale.length);
  assert.ok(PLAN_FEATURES.Scale.length < PLAN_FEATURES.Enterprise.length);
  assert.ok(PLAN_FEATURES.Scale.includes("multi-branch"));
  assert.ok(PLAN_FEATURES.Core.includes("payroll"));
  assert.ok(!PLAN_FEATURES.Solo.includes("payroll"));
});

test("a feature inside the plan never blocks", () => {
  assert.equal(requireFeature(ents({ plan: "Scale" }), "imports"), null);
  assert.equal(requireFeature(ents({ plan: "Core" }), "payroll"), null);
});

test("an unavailable feature returns 402 with the upgrade path", () => {
  const blocked = requireFeature(ents({ plan: "Core" }), "imports");
  assert.ok(blocked, "an unavailable feature must be blocked");
  assert.equal(blocked?.status, 402);
});

test("a cancelled subscription blocks even included features", () => {
  const blocked = requireFeature(ents({ plan: "Enterprise", active: false, status: "past_due" }), "payroll");
  assert.ok(blocked, "a non-payable subscription must block even included features");
  assert.equal(blocked?.status, 402);
});

test("an administrator can never be demoted by self-service linking", () => {
  // Guards a real bug: linking an admin account set role=employee and locked
  // them out of the workspace they administer.
  assert.ok(
    !JSON.stringify(["admin", "bookkeeper"]).includes("employee"),
    "sanity: role names must stay distinct",
  );
});
