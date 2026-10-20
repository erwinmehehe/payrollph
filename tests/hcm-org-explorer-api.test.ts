import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const graphApi = read("src/app/api/hcm/org-explorer/route.ts");
const historyApi = read("src/app/api/hcm/position-history/route.ts");
const page = read("src/app/hcm/org-explorer/page.tsx");
const access = read("src/lib/hcm-org-explorer-access.ts");
const server = read("src/lib/hcm-org-explorer-server.ts");
const client = read("src/components/hcm-org-explorer.tsx");
const people = read("src/components/workspace/people.tsx");
import {
  hcmOrgExplorerEnabledForEmployer, hcmOrgExplorerPositiveId,
} from "../src/lib/hcm-org-explorer-access";


test("both read-only APIs fail closed behind the same disabled-by-default gate", () => {
  for (const content of [graphApi, historyApi]) {
    assert.match(content, /HCM_ORG_EXPLORER_ENABLED !== "true"/);
    assert.match(content, /getSessionUser\(\)/);
    assert.match(content, /denyHcmOrgExplorer\(user\.id, organizationId\)/);
    assert.ok(!content.includes("export async function POST"));
    assert.ok(!content.includes("export async function PATCH"));
  }
  assert.match(page, /HCM_ORG_EXPLORER_ENABLED !== "true"/);
  assert.match(page, /denyHcmOrgExplorer/);
  assert.ok(!page.includes("primaryCompanyOrganizationId"));
});

test("pilot flags fail closed without exact server employer allowlist", () => {
  const enabled = {
    HCM_ORG_EXPLORER_ENABLED: "true",
    HCM_ORG_EXPLORER_ORG_IDS: "7, 12, 19",
  };
  assert.equal(hcmOrgExplorerEnabledForEmployer(7, enabled), true);
  assert.equal(hcmOrgExplorerEnabledForEmployer(12, enabled), true);
  assert.equal(hcmOrgExplorerEnabledForEmployer(8, enabled), false);
  assert.equal(hcmOrgExplorerEnabledForEmployer(0, enabled), false);
  assert.equal(hcmOrgExplorerEnabledForEmployer(Number.MAX_SAFE_INTEGER + 1, enabled), false);
  assert.equal(hcmOrgExplorerEnabledForEmployer(7, {
    ...enabled, HCM_ORG_EXPLORER_ENABLED: "false",
  }), false);
  assert.equal(hcmOrgExplorerEnabledForEmployer(7, {
    HCM_ORG_EXPLORER_ENABLED: "true",
  }), false);
  assert.equal(hcmOrgExplorerPositiveId("007"), null);
  assert.equal(hcmOrgExplorerPositiveId("7"), 7);
  assert.equal(hcmOrgExplorerPositiveId("7.0"), null);
});

test("server flag and organization allowlist authorize before any read", () => {
  for (const content of [graphApi, historyApi]) {
    assert.ok(content.includes("hcmOrgExplorerEnabledForEmployer(organizationId)"));
    assert.ok(content.indexOf("hcmOrgExplorerEnabledForEmployer(organizationId)") <
      content.indexOf("denyHcmOrgExplorer(user.id, organizationId)"));
  }
  assert.ok(page.includes("hcmOrgExplorerEnabledForEmployer(organizationId)"));
  assert.ok(people.includes("NEXT_PUBLIC_HCM_ORG_EXPLORER_ORG_IDS"));
  assert.ok(page.includes("HcmContextNavigation"));
  assert.ok(page.includes('current="orgExplorer"'));
  assert.ok(client.includes("/app?organizationId=${organizationId}&workspacePage=People"));

});
test("access gate enforces membership, role, custom deny overlay and company-wide scope", () => {
  assert.match(access, /assertOrganizationRole/);
  assert.match(access, /PEOPLE_ADMIN_ROLES/);
  assert.match(access, /companyWide/);
  assert.match(access, /"owner", "admin", "hr"/);
  assert.match(access, /private, no-store/);
  assert.match(access, /Number\.isSafeInteger\(id\)/);
  assert.ok(!access.includes("primaryOrganizationId"));
});

test("source queries are bounded, tenant restricted and field minimized", () => {
  for (const source of ["orgUnits", "positions", "positionAssignments"]) {
    assert.match(server, new RegExp("eq\\(" + source + "\\.organizationId, organizationId\\)"));
  }
  assert.match(server, /eq\(positions\.id, positionId\)/);
  assert.match(server, /eq\(positionAssignments\.positionId, positionId\)/);
  assert.match(server, /eq\(positionAssignments\.employeeId, employees\.id\)/);
  assert.match(server, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(server, /HCM_ORG_EXPLORER_UNIT_LIMIT \+ 1/);
  assert.match(server, /HCM_ORG_EXPLORER_POSITION_LIMIT \+ 1/);
  assert.match(server, /HCM_POSITION_HISTORY_LIMIT \+ 1/);
  assert.match(server, /unitRows\.length > HCM_ORG_EXPLORER_UNIT_LIMIT/);
  assert.match(server, /positionRows\.length > HCM_ORG_EXPLORER_POSITION_LIMIT/);
  assert.match(server, /projectPositionHistory\(rows, HCM_POSITION_HISTORY_LIMIT\)/);
  for (const field of ["annualBudget", "basicRate", "bankAccount", "tin:", "reason:", "metadata:", "decisionNote:"]) {
    assert.ok(!server.includes(field), "sensitive field must not enter API: " + field);
  }
  assert.ok(!server.includes("SELECT *"));
  assert.ok(!server.includes("db.select().from"));
});

test("UI never uses stale employer/position response or performs mutations", () => {
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /controller\.abort\(\)/);
  assert.match(client, /validOrgExplorerResponse\(payload, organizationId\)/);
  assert.match(client, /validPositionHistoryResponse\(payload, organizationId, selectedPositionId\)/);
  assert.match(client, /graph\?\.scope === graphScope/);
  assert.match(client, /history\?\.scope === positionScope/);
  assert.ok(client.includes("selectedUnitChoice?.scope === graphScope"));
  assert.ok(client.includes("selectedPositionChoice?.scope === unitScope"));
  assert.ok(client.includes("const showingUnlinked ="));
  assert.ok(client.includes("position.reportingUnitId === null"));
  assert.ok(client.includes("current.unlinkedPositionRecords > 0"));
  assert.ok(client.includes("relationships are not inferred"));

  assert.ok(!client.includes('setGraph({ scope: graphScope, status: "loading"'));
  assert.ok(!client.includes('setHistory({ scope: positionScope, status: "loading"'));

  assert.match(people, /NEXT_PUBLIC_HCM_ORG_EXPLORER_ENABLED === "true"/);
  assert.match(people, /\/hcm\/org-explorer\?organizationId=\$\{data\.selectedOrganization\.id\}/);
  assert.ok(!client.includes('method: "POST"'));
  assert.ok(!client.includes('method: "PATCH"'));
});
