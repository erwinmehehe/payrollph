import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, subscriptions, userOrganizations, users } from "../src/db/schema";
import { getAccess } from "../src/lib/access";

const require = createRequire(import.meta.url);

/** Actual route handlers + real fictional memberships/subscriptions on disposable CI PostgreSQL. */
test("opted-in Enterprise HTTP planning/compensation checks protect direct API and Core approvals", async () => {
  const suffix = randomUUID().slice(0, 9);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Plan HTTP A " + suffix, legalName: "Plan HTTP A " + suffix },
    { name: "Plan HTTP B " + suffix, legalName: "Plan HTTP B " + suffix },
  ]).returning();
  const oldEnabled = process.env.HCM_ENTERPRISE_PLAN_GATE_ENABLED;
  const oldIds = process.env.HCM_ENTERPRISE_PLAN_GATE_ORG_IDS;
  const restores: Array<() => void> = [];
  let caller: { id: number; name: string; email: string } | null = null;
  const email = (person: string) => "plan-" + person + "-" + suffix + "@example.test";
  const patch = (path: string, overrides: Record<string, unknown>) => {
    const key = require.resolve(path);
    const previous = require(key);
    require.cache[key]!.exports = { ...previous, ...overrides };
    restores.push(() => { require.cache[key]!.exports = previous; });
  };
  try {
    const [hrA, hrB, outside] = await db.insert(users).values([
      { email: email("a"), name: "Fictional HR A", role: "hr", passwordHash: "synthetic-no-login" },
      { email: email("b"), name: "Fictional HR B", role: "hr", passwordHash: "synthetic-no-login" },
      { email: email("outside"), name: "No membership", role: "hr", passwordHash: "synthetic-no-login" },
    ]).returning();
    await db.insert(userOrganizations).values([
      { userId: hrA.id, organizationId: alpha.id, role: "hr", orgUnitId: null },
      { userId: hrB.id, organizationId: beta.id, role: "hr", orgUnitId: null },
    ]);
    // Two employers deliberately share the same fictional employee number.
    // A paid plan or response from A must never authorize or expose B's worker.
    const sameEmployeeNumber = "E-" + suffix;
    await db.insert(employees).values([
      { organizationId: alpha.id, employeeNo: sameEmployeeNumber,
        firstName: "PLAN_ALPHA_ONLY", lastName: "Worker", title: "Staff",
        avatarInitials: "PA", basicRate: "24500.00", startDate: "2026-01-01" },
      { organizationId: beta.id, employeeNo: sameEmployeeNumber,
        firstName: "PLAN_BETA_ONLY", lastName: "Worker", title: "Staff",
        avatarInitials: "PB", basicRate: "74500.00", startDate: "2026-01-01" },
    ]);
    process.env.HCM_ENTERPRISE_PLAN_GATE_ENABLED = "true";
    process.env.HCM_ENTERPRISE_PLAN_GATE_ORG_IDS = [alpha.id, beta.id].join(",");
    patch("../src/lib/auth", { getSessionUser: async () => caller });
    patch("../src/lib/access", {
      assertOrganizationRole: async (userId: number, orgId: number, roles: readonly string[]) => {
        const access = await getAccess(userId, orgId);
        return access && roles.includes(access.role)
          ? null : Response.json({ error: "Role or employer denied" }, { status: 403 });
      },
    });
    const planning = await import("../src/app/api/workforce-planning/route");
    const compensation = await import("../src/app/api/compensation/route");
    const get = (route: string, org: number) =>
      new Request("https://example.test/api/" + route + "?organizationId=" + org);
    const post = (route: string, body: Record<string, unknown>) =>
      new Request("https://example.test/api/" + route, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    caller = null;
    assert.equal((await planning.GET(get("workforce-planning", alpha.id))).status, 401);
    caller = { id: outside.id, name: "No membership", email: email("outside") };
    assert.equal((await planning.GET(get("workforce-planning", alpha.id))).status, 403);
    assert.equal((await compensation.GET(get("compensation", alpha.id))).status, 403);
    caller = { id: hrA.id, name: "Fictional HR A", email: email("a") };

    // The inferred account type alone cannot bypass a missing real subscription.
    const missing = await planning.GET(get("workforce-planning", alpha.id));
    assert.equal(missing.status, 402);
    assert.equal(missing.headers.get("cache-control"), "private, no-store");
    assert.equal((await planning.POST(post("workforce-planning", {
      organizationId: alpha.id, entityType: "plan",
    })))?.status, 402);
    assert.equal((await compensation.POST(post("compensation", {
      organizationId: alpha.id, entityType: "band",
    })))?.status, 402);
    const corePayRead = await compensation.GET(get("compensation", alpha.id));
    assert.equal(corePayRead.status, 200);
    assert.equal((await corePayRead.json()).advancedConfigurationAllowed, false);

    // Previously governed ordinary HR and pay components retain validation.
    assert.equal((await planning.POST(post("workforce-planning", {
      organizationId: alpha.id, entityType: "org_unit",
    })))?.status, 400);
    assert.equal((await planning.POST(post("workforce-planning", {
      organizationId: alpha.id, entityType: "assignment",
    })))?.status, 400);
    assert.equal((await compensation.POST(post("compensation", {
      organizationId: alpha.id, entityType: "component_assignment",
    })))?.status, 400);

    await db.insert(subscriptions).values([
      { organizationId: alpha.id, plan: "Enterprise", status: "active" },
      { organizationId: beta.id, plan: "Core", status: "active" },
    ]);
    const allowed = await planning.GET(get("workforce-planning", alpha.id));
    assert.equal(allowed.status, 200);
    const allowedPayload = await allowed.json();
    assert.ok(Array.isArray(allowedPayload.plans));
    assert.deepEqual(allowedPayload.employees.map((worker: { firstName: string }) => worker.firstName), ["PLAN_ALPHA_ONLY"]);
    assert.ok(!JSON.stringify(allowedPayload).includes("PLAN_BETA_ONLY"));
    assert.equal((await planning.POST(post("workforce-planning", {
      organizationId: alpha.id, entityType: "plan",
    })))?.status, 400);
    const paidPayRead = await compensation.GET(get("compensation", alpha.id));
    assert.equal(paidPayRead.status, 200);
    const allowedPayPayload = await paidPayRead.json();
    assert.equal(allowedPayPayload.advancedConfigurationAllowed, true);
    assert.deepEqual(allowedPayPayload.employees.map((worker: { firstName: string }) => worker.firstName), ["PLAN_ALPHA_ONLY"]);
    assert.ok(!JSON.stringify(allowedPayPayload).includes("PLAN_BETA_ONLY"));
    assert.equal((await compensation.POST(post("compensation", {
      organizationId: alpha.id, entityType: "cycle",
    })))?.status, 400);

    // Distinct subscriptions remain isolated even with a matching HR role.
    caller = { id: hrB.id, name: "Fictional HR B", email: email("b") };
    assert.equal((await planning.GET(get("workforce-planning", alpha.id))).status, 403);
    assert.equal((await planning.GET(get("workforce-planning", beta.id))).status, 402);
    const betaPay = await compensation.GET(get("compensation", beta.id));
    assert.equal(betaPay.status, 200);
    const betaPayload = await betaPay.json();
    assert.equal(betaPayload.advancedConfigurationAllowed, false);
    assert.deepEqual(betaPayload.employees.map((worker: { firstName: string }) => worker.firstName), ["PLAN_BETA_ONLY"]);
    assert.ok(!JSON.stringify(betaPayload).includes("PLAN_ALPHA_ONLY"));
    process.env.HCM_ENTERPRISE_PLAN_GATE_ORG_IDS = String(alpha.id);
    const betaCore = await planning.GET(get("workforce-planning", beta.id));
    assert.equal(betaCore.status, 200, "Non-opted employers have no new Enterprise paywall");
    const betaCorePayload = await betaCore.json();
    assert.deepEqual(betaCorePayload.employees.map((worker: { firstName: string }) => worker.firstName), ["PLAN_BETA_ONLY"]);

    // A downgraded role cannot rely on a paid Enterprise subscription.
    caller = { id: hrA.id, name: "Fictional HR A", email: email("a") };
    await db.update(userOrganizations).set({ role: "employee" }).where(eq(userOrganizations.userId, hrA.id));
    assert.equal((await planning.GET(get("workforce-planning", alpha.id))).status, 403);
    assert.equal((await compensation.GET(get("compensation", alpha.id))).status, 403);
    await db.update(userOrganizations).set({ role: "hr" }).where(eq(userOrganizations.userId, hrA.id));
    await db.update(subscriptions).set({ plan: "Core" }).where(eq(subscriptions.organizationId, alpha.id));
    assert.equal((await planning.GET(get("workforce-planning", alpha.id))).status, 402);
    const lowerTierPay = await compensation.GET(get("compensation", alpha.id));
    assert.equal(lowerTierPay.status, 200);
    assert.equal((await lowerTierPay.json()).advancedConfigurationAllowed, false);
  } finally {
    for (const restore of restores.reverse()) restore();
    if (oldEnabled === undefined) delete process.env.HCM_ENTERPRISE_PLAN_GATE_ENABLED;
    else process.env.HCM_ENTERPRISE_PLAN_GATE_ENABLED = oldEnabled;
    if (oldIds === undefined) delete process.env.HCM_ENTERPRISE_PLAN_GATE_ORG_IDS;
    else process.env.HCM_ENTERPRISE_PLAN_GATE_ORG_IDS = oldIds;
    await db.delete(users).where(inArray(users.email, [email("a"), email("b"), email("outside")]));
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
