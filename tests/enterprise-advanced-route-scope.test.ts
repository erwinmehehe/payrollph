import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = (name: string) => readFileSync(name, "utf8");
const route = (name: string) => src("src/app/api/workforce-planning/" + name + "/route.ts");
const planGate = 'denyOptInEnterpriseAdvancedPlan(';

test("all standalone premium planning GET/POST/PATCH entrypoints gate direct API bypass", () => {
  const methods: Record<string, readonly string[]> = {
    allocations: ["GET", "POST", "PATCH"],
    baselines: ["GET", "POST"],
    scenarios: ["GET", "POST", "PATCH"],
    forecast: ["GET"],
    "forecast-plan": ["POST"],
    "demand-handoff": ["POST"],
    "position-executions": ["GET", "POST", "PATCH"],
  };
  for (const [endpoint, expected] of Object.entries(methods)) {
    const code = route(endpoint);
    const matches = [...code.matchAll(/export async function (GET|POST|PATCH)\(/g)];
    assert.deepEqual(matches.map(m => m[1]), expected, endpoint + " unexpected method list");
    matches.forEach((method, index) => {
      const body = code.slice(method.index, matches[index + 1]?.index ?? code.length);
      assert.ok(body.includes(planGate), endpoint + " " + method[1] + " missed billing guard");
      const auth = Math.max(body.indexOf("assertOrganizationRole"), body.indexOf("getAccess"), body.indexOf("workforceAccess"), body.indexOf("planningAccess"), body.indexOf("companyWidePeopleAdmin"));
      assert.ok(auth >= 0 && body.indexOf(planGate) > auth,
        endpoint + " " + method[1] + " billed before authenticated scoped access");
    });
  }
});

test("mixed Planning API guards reads/configuration but preserves ordinary source-governed HR actions", () => {
  const code = src("src/app/api/workforce-planning/route.ts");
  const get = code.slice(code.indexOf("export async function GET"), code.indexOf("export async function POST"));
  const post = code.slice(code.indexOf("export async function POST"), code.indexOf("export async function PATCH"));
  const patch = code.slice(code.indexOf("export async function PATCH"));
  assert.ok(get.indexOf(planGate) > get.indexOf("assertOrganizationRole("));
  assert.match(post, /entityType !== "org_unit"/);
  assert.match(post, /if \(entityType === "profile"\)/);
  assert.match(post, /if \(entityType === "plan"\)/);
  assert.match(post, /if \(planId !== null\)/);
  assert.match(post, /if \(entityType === "assignment"\)/);
  assert.ok(!post.slice(post.indexOf('if (entityType === "assignment")')).includes(planGate),
    "Already-governed assigned worker changes must not be paywalled");
  assert.ok(!patch.includes(planGate), "Original governed position lifecycle remains separate");
  assert.equal(code.match(/denyOptInEnterpriseAdvancedPlan\(/g)?.length, 5);
});

test("compensation separates premium band/cycle creation from Core pay proposals and approvals", () => {
  const api = src("src/app/api/compensation/route.ts");
  const ui = src("src/components/compensation-panel.tsx");
  const get = api.slice(api.indexOf("export async function GET"), api.indexOf("export async function POST"));
  const post = api.slice(api.indexOf("export async function POST"), api.indexOf("export async function PATCH"));
  const patch = api.slice(api.indexOf("export async function PATCH"));
  assert.ok(get.indexOf(planGate) > get.indexOf("getAccess(user.id, organizationId)"));
  const access = src("src/lib/access.ts");
  assert.ok(access.includes('if (allowedRoles === COMPENSATION_MANAGER_ROLES) return "people.admin"'),
    "Compensation must honor custom deny-only People permissions before billing");
  assert.ok(api.includes("assertScope, COMPENSATION_MANAGER_ROLES, getAccess"),
    "Compensation routes must use the canonical identity-mapped role list");
  assert.ok(get.includes("advancedConfigurationAllowed: access.companyWide && advancedConfigurationDenied === null"));
  assert.ok(post.includes('entityType === "band" || entityType === "cycle"'));
  assert.ok(post.indexOf(planGate) > post.indexOf("getAccess(user.id, organizationId)"));
  assert.ok(!patch.includes(planGate), "Salary/recurring component checker decisions must not be paywalled");
  assert.ok(ui.includes("typeof body.advancedConfigurationAllowed !== \"boolean\""));
  assert.ok(ui.includes("advancedConfigurationAllowed ? <>"));
  assert.ok(ui.includes("Advanced compensation configuration unavailable"));
  assert.ok(ui.indexOf('>PAY PROPOSAL</div>') > ui.indexOf("Advanced compensation configuration unavailable"),
    "Existing proposal source/actions remain visible when new config is restricted");
});

test("authenticated workspace navigation hides paid Planning without blocking Core People and Payroll", () => {
  const source = src("src/lib/dashboard-data.ts");
  const workspace = src("src/components/linaw-workspace.tsx");
  const types = src("src/components/workspace/types.ts");
  assert.ok(source.indexOf("resolveAdvancedHcmPlan(") > source.indexOf("const access = await getAccess("));
  assert.ok(source.includes("advancedPlanningAllowed,"));
  assert.ok(workspace.includes("if (data.advancedPlanningAllowed === false)"));
  assert.ok(workspace.includes('pages.indexOf("Planning")'));
  assert.ok(workspace.includes("data.advancedPlanningAllowed]"));
  assert.ok(!workspace.includes('pages.indexOf("People")'));
  assert.ok(!workspace.includes('pages.indexOf("Payroll")'));
  assert.ok(types.includes("advancedPlanningAllowed?: boolean"));
});

test("opt-in features preserve the default-off exact employer control and support a safe rollback", () => {
  const policy = src("src/lib/enterprise-advanced-plan-policy.ts");
  const server = src("src/lib/enterprise-advanced-plan-server.ts");
  const docs = src("docs/hcm-plan-entitlement-route-inventory-2026-10.md");
  assert.ok(policy.includes("enterpriseHcmPlanGateEnabled(organizationId, env)"));
  assert.ok(policy.includes('snapshot.status === "none"'));
  assert.ok(policy.includes('snapshot.plan !== "Enterprise"'));
  assert.ok(server.includes('"Cache-Control": "private, no-store"'));
  assert.ok(docs.includes("HCM_ENTERPRISE_PLAN_GATE_ENABLED"));
  assert.ok(docs.includes("HCM_ENTERPRISE_PLAN_GATE_ORG_IDS"));
});
