import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateEnterpriseHcmPlan, resolveEnterpriseHcmPlan,
} from "../src/lib/hcm-enterprise-plan-policy";

const source = (name: string) => readFileSync(name, "utf8");
const route = source("src/app/api/hcm/business-processes/definitions/route.ts");
const enrolled = {
  HCM_ENTERPRISE_PLAN_GATE_ENABLED: "true",
  HCM_ENTERPRISE_PLAN_GATE_ORG_IDS: "17",
};
const active = {
  plan: "Enterprise", active: true, status: "active",
  features: ["advanced-hcm-discovery"],
};

test("definition reads check authenticated company-wide People admin before the plan or any source data", () => {
  const read = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  const login = read.indexOf("getSessionUser()");
  const role = read.indexOf("assertBusinessProcessAdmin(user.id, organizationId)");
  const paid = read.indexOf("denyOptInEnterpriseHcmPlan(organizationId)");
  const query = read.indexOf("db.select().from(hcmBusinessProcessDefinitions)");
  assert.ok(login >= 0 && role > login && paid > role && query > paid);
  assert.ok(read.includes("if (planDenied) return planDenied;"));
  assert.ok(route.includes('enrolledForPaidDesign && !["owner", "admin", "hr"].includes(access.role)'),
    "A company-wide bookkeeper cannot edit enrolled Enterprise workflow definitions");
});

test("every definition write, enable/disable and version change checks MFA/rate then plan before SQL", () => {
  const post = route.slice(route.indexOf("export async function POST"));
  const sameOrigin = post.indexOf("enforceSameOriginMutation(request)");
  const login = post.indexOf("getSessionUser()");
  const role = post.indexOf("assertBusinessProcessAdmin(user.id, organizationId)");
  const mfa = post.indexOf("requireSensitiveActionMfa(user)");
  const rate = post.indexOf("enforceSensitiveActionRateLimit(request");
  const paid = post.indexOf("denyOptInEnterpriseHcmPlan(organizationId)");
  const action = post.indexOf('String(body.action ?? "save")');
  const firstWrite = post.indexOf("await db.transaction(");
  assert.ok(sameOrigin >= 0 && login > sameOrigin && role > login &&
    mfa > role && rate > mfa && paid > rate && action > paid &&
    firstWrite > action);
  assert.equal(post.split("denyOptInEnterpriseHcmPlan(organizationId)").length - 1, 1);
  assert.ok(post.includes('action === "set-active"'));
  assert.ok(post.includes('action !== "save"'));
  assert.ok(post.includes("pg_advisory_xact_lock("));
});

test("client editor is hidden until authorized response; employer switch clears its state", () => {
  const admin = source("src/components/hcm-business-process-admin.tsx");
  const people = source("src/components/workspace/people.tsx");
  assert.ok(admin.includes('"checking" | "ready" | "restricted" | "error"'));
  assert.ok(admin.includes('response.status === 402 && data.code === "HCM_ENTERPRISE_PLAN_REQUIRED"'));
  assert.ok(admin.includes('response.status === 503 && data.code === "HCM_ENTITLEMENTS_UNAVAILABLE"'));
  assert.ok(admin.includes('view === "checking" || view === "restricted"'));
  assert.ok(admin.includes('if (view === "error" && !payload)'));
  assert.equal(admin.split('setView("restricted")').length - 1, 3,
    "Read, save, and enable/disable must all close on subscription revocation");
  assert.ok(people.includes('<HcmBusinessProcessAdmin key={`hcm-bp-admin:${data.selectedOrganization.id}`} organizationId={data.selectedOrganization.id} />'));
  assert.ok(people.includes('key={`hcm-bp-inbox:${data.selectedOrganization.id}`}'),
    'Admin and inbox retain separate React identities across employer switches');
});

test("assigned inbox and review decisions are not plan-gated by the workflow designer", () => {
  const inbox = source("src/app/api/hcm/business-processes/inbox/route.ts");
  assert.ok(inbox.includes("export async function GET"));
  assert.ok(inbox.includes("export async function POST"));
  assert.ok(inbox.includes("canDecide("));
  assert.ok(inbox.includes("completeHcmBusinessProcessWorkItemTx("));
  assert.ok(!inbox.includes("denyOptInEnterpriseHcmPlan"));
});

test("opt-in billing policy is exact-employer, active Enterprise and fails closed only when enrolled", async () => {
  assert.equal(evaluateEnterpriseHcmPlan(17, active, {}), "not-enforced");
  assert.equal(evaluateEnterpriseHcmPlan(18, null, enrolled), "not-enforced");
  assert.equal(evaluateEnterpriseHcmPlan(17, active, enrolled), "allowed");
  assert.equal(evaluateEnterpriseHcmPlan(17, { ...active, plan: "Core" }, enrolled), "enterprise-required");
  assert.equal(evaluateEnterpriseHcmPlan(17, { ...active, active: false }, enrolled), "subscription-inactive");
  assert.equal(evaluateEnterpriseHcmPlan(17, { ...active, status: "none" }, enrolled), "subscription-missing");
  let lookups = 0;
  const query = async () => { lookups++; throw Error("fictional billing outage"); };
  assert.equal(await resolveEnterpriseHcmPlan(18, enrolled, query), "not-enforced");
  assert.equal(lookups, 0);
  assert.equal(await resolveEnterpriseHcmPlan(17, enrolled, query), "entitlements-unavailable");
  assert.equal(lookups, 1);
});
