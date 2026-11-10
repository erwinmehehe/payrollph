import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("HCM Process Monitor enforces selected source employer before rendering any timeline", () => {
  const page = readFileSync("src/app/hcm/process-monitor/page.tsx", "utf8");
  const parsed = page.indexOf("canonicalHcmId(one(query.organizationId))");
  const session = page.indexOf("await getSessionUser()");
  const role = page.indexOf("await assertOrganizationRole(");
  const access = page.indexOf("await getAccess(");
  const policy = page.indexOf("canReadHcmProcessMonitor(access)");
  const plan = page.indexOf("await denyOptInEnterpriseHcmPlan(");
  const selected = page.indexOf("if (selectedProcessId !== null) {");
  const lookup = page.indexOf("const [ownedProcess] = await db.select");
  const employer = page.indexOf("eq(hcmBusinessProcessInstances.organizationId, organizationId)");
  const id = page.indexOf("eq(hcmBusinessProcessInstances.id, selectedProcessId)");
  const deny = page.indexOf("if (!ownedProcess) notFound()");
  const load = page.indexOf("source = await loadHcmProcessMonitor(");
  const render = page.indexOf("const view = source;");
  assert.ok(parsed >= 0 && session > parsed && role > session &&
    access > role && policy > access && plan > policy && selected > plan &&
    lookup > selected && employer > lookup && id > employer &&
    deny > id && load > deny && render > load,
    "Full employer, role, process ownership must precede SSR");
  assert.ok(page.includes("if (Object.values(query).some(Array.isArray)) notFound()"),
    "Duplicated status/cursor/process/employer selectors must not fall back");
  assert.ok(page.includes("selectedProcessId !== null && source?.detail.state"),
    "Raced deletion cannot downgrade foreign/missing selection to 200");
  assert.ok(!page.slice(lookup, load).includes("catch"),
    "A failed ownership SQL read may not downgrade into an empty list");
  assert.ok(!page.includes("primaryCompanyOrganizationId("));
  assert.ok(!page.includes('"use client"'));
  assert.ok(!page.includes("db.update(") && !page.includes("db.insert("));
});

test("monitor data source joins steps to selected employer and selected real instance", () => {
  const loader = readFileSync("src/lib/hcm-process-monitor-server.ts", "utf8");
  for (const marker of [
    "eq(hcmBusinessProcessInstances.organizationId, organizationId)",
    "eq(hcmBusinessProcessInstances.id, selectedProcessId)",
    "eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId)",
    "eq(hcmBusinessProcessInstanceSteps.instanceId, selectedProcessId)",
    "eq(hcmBusinessProcessInstanceSteps.instanceId, hcmBusinessProcessInstances.id)",
    "MONITOR_PAGE_SIZE + 1", "MONITOR_STEP_LIMIT + 1",
  ]) assert.ok(loader.includes(marker), "Missing employer-bound SQL " + marker);
  assert.ok(!loader.includes("db.select().from("));
  assert.ok(!loader.includes("db.delete("));
  assert.ok(!loader.includes("db.insert("));
  assert.ok(!loader.includes("db.update("));
  assert.ok(!loader.includes("decisionNote:"));
  assert.ok(!loader.includes("sourceKey:"));
});
