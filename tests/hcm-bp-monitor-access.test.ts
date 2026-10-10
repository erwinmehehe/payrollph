import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) { return readFileSync(path, "utf8"); }
const route = read("src/app/api/hcm/bp-monitor/route.ts");
const loader = read("src/lib/hcm-bp-monitor-server.ts");
const page = read("src/app/hcm/bp-monitor/page.tsx");
const client = read("src/components/hcm-bp-monitor.tsx");
const command = read("src/app/hcm/command-center/page.tsx");

test("monitor API and page default OFF, require explicit tenant and company-wide People admin", () => {
  for (const content of [route, page]) {
    assert.match(content, /HCM_BP_MONITOR_ENABLED !== "true"/);
    assert.match(content, /getSessionUser/);
    assert.match(content, /assertOrganizationRole/);
    assert.match(content, /PEOPLE_ADMIN_ROLES/);
    assert.match(content, /companyWide/);
    assert.match(content, /"owner", "admin", "hr"/);
    assert.ok(!content.includes("primaryCompanyOrganizationId"));
  }
  assert.match(route, /Number.isSafeInteger\(id\)/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.ok(!route.includes("export async function POST"));
  assert.ok(!route.includes("export async function PATCH"));
  assert.ok(!route.includes("export async function DELETE"));
});

test("monitor SQL scopes BOTH instances and steps to tenant before bounded limits", () => {
  assert.match(loader, /eq\(hcmBusinessProcessInstances\.organizationId, organizationId\)/);
  assert.match(loader, /eq\(hcmBusinessProcessInstanceSteps\.organizationId, organizationId\)/);
  assert.match(loader, /inArray\(hcmBusinessProcessInstanceSteps\.instanceId, ids\)/);
  assert.match(loader, /lt\(hcmBusinessProcessInstances\.id, beforeId\)/);
  assert.match(loader, /HCM_BP_MONITOR_PAGE_SIZE \+ 1/);
  assert.match(loader, /HCM_BP_MONITOR_STEP_CEILING \+ 1/);
  assert.match(loader, /stepRows\.length > HCM_BP_MONITOR_STEP_CEILING/);
  assert.match(loader, /throw new HcmMonitorSourceCapError/);
  assert.ok(!loader.includes("db.select().from"));
  assert.ok(!loader.includes("decisionNote:"));
  assert.ok(!loader.includes("assignee:"));
  assert.ok(!loader.includes("definitionSnapshot:"));
  assert.ok(!loader.includes("employeeNo:"));
  assert.ok(!loader.includes("basicRate:"));
  assert.ok(!loader.includes("bankAccount:"));
});

test("display is read-only, scoped to employer/cursor, and does not expose decisions", () => {
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /controller\.abort\(\)/);
  assert.match(client, /payload\.tenantId !== organizationId/);
  assert.match(client, /load\?\.key === key/);
  assert.match(client, /page\.hasMore/);
  assert.match(client, /page\.nextCursor/);
  assert.match(client, /effective business date is not an SLA deadline/);
  assert.match(command, /NEXT_PUBLIC_HCM_BP_MONITOR_ENABLED === "true"/);
  assert.match(command, /\/hcm\/bp-monitor\?organizationId=/);
  assert.ok(!client.includes('method: "POST"'));
  assert.ok(!client.includes('method: "PATCH"'));
  assert.ok(!client.includes('method: "DELETE"'));
});
