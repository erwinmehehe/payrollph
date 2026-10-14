import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { roleAllowed, PEOPLE_PAYROLL_ROLES } from "../src/lib/access";
import { benefitPlans, employees } from "../src/db/schema";

const require = createRequire(import.meta.url);

test("canonical benefits POST denies anonymous, disallowed-role, foreign-employer, wrong-unit and cross-site calls", async () => {
  const savedEnv = { ...process.env };
  process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic";
  const restorers: Array<() => void> = [];
  function patch(path: string, overrides: Record<string, unknown>) {
    const id = require.resolve(path);
    const original = require(id);
    const entry = require.cache[id]!;
    entry.exports = { ...original, ...overrides };
    restorers.push(() => { entry.exports = original; });
  }
  let actor: { id: number; name: string } | null = null;
  let roleDenied = false;
  let access: {
    organizationId: number; role: string; orgUnitId: number | null;
    orgUnitName: string | null; companyWide: boolean;
  } | null = null;
  let reads = 0, writes = 0, audits = 0;
  const employee = { id: 42, organizationId: 9, orgUnitId: 3, basicRate: "45000.00",
    firstName: "Synthetic", lastName: "Employee" };
  const plan = { id: 7, organizationId: 9, active: true, name: "Synthetic plan",
    category: "hmo", employeeShare: "500.00", employerShare: "800.00", cap: null, provider: null };
  patch("../src/db", {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => {
              reads++;
              if (table === benefitPlans) return [plan];
              if (table === employees) return [employee];
              return [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          returning: async () => {
            writes++;
            return [{ id: 99, status: "active", ...values }];
          },
        }),
      }),
    },
  });
  patch("../src/lib/auth", { getSessionUser: async () => actor });
  patch("../src/lib/access", {
    assertOrganizationRole: async () => roleDenied ? Response.json({ error: "Role denied" }, { status: 403 }) : null,
    getAccess: async () => access,
  });
  patch("../src/lib/audit", { recordAuditEvent: async () => { audits++; } });
  patch("../src/lib/automation", { runAutomationEventSafely: async () => undefined });

  const request = (origin = "https://app.example.test", organizationId = 9) =>
    new Request("https://app.example.test/api/benefits", {
      method: "POST",
      headers: { "content-type": "application/json", origin,
        "sec-fetch-site": origin === "https://app.example.test" ? "same-origin" : "cross-site" },
      body: JSON.stringify({
        organizationId, employeeId: 42, planId: 7, monthlyContribution: 500,
        startedOn: "2026-10-13",
      }),
    });
  try {
    const { POST } = await import("../src/app/api/benefits/route");
    assert.equal(roleAllowed("employee", PEOPLE_PAYROLL_ROLES), false);
    assert.equal(roleAllowed("manager", PEOPLE_PAYROLL_ROLES), false);
    assert.equal(roleAllowed("hr", PEOPLE_PAYROLL_ROLES), true);

    assert.equal((await POST(request("https://foreign.test"))).status, 403);
    assert.equal((await POST(request())).status, 401);
    actor = { id: 15, name: "Synthetic payroll operator" };
    roleDenied = true;
    assert.equal((await POST(request())).status, 403);
    roleDenied = false;
    assert.equal((await POST(request())).status, 403, "no active employer membership");
    assert.equal(reads, 0, "denial must occur before table reads");
    access = { organizationId: 9, role: "hr", orgUnitId: 8, orgUnitName: "Another unit", companyWide: false };
    assert.equal((await POST(request())).status, 403, "wrong-unit employee");
    assert.equal(writes, 0);
    access = { organizationId: 9, role: "hr", orgUnitId: 3, orgUnitName: "HR unit", companyWide: false };
    assert.equal((await POST(request())).status, 201, "correct unit / employer operator");
    assert.equal(writes, 1);
    assert.equal(audits, 1);
    // This is a legacy API contract, NOT proof of employee consent. Its lack
    // of an employee election record is a separate release blocker for #978.
  } finally {
    for (const restore of restorers.reverse()) restore();
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }
});
