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
  assert.match(client, /data\.tenantId !== organizationId/);
  assert.match(client, /data\.positionId !== selectedPositionId/);
  assert.match(client, /graph\?\.scope === graphScope/);
  assert.match(client, /history\?\.scope === positionScope/);
  assert.match(people, /NEXT_PUBLIC_HCM_ORG_EXPLORER_ENABLED === "true"/);
  assert.match(people, /\/hcm\/org-explorer\?organizationId=\$\{data\.selectedOrganization\.id\}/);
  assert.ok(!client.includes('method: "POST"'));
  assert.ok(!client.includes('method: "PATCH"'));
});
