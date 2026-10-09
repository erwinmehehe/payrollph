import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read=(p:string)=>readFileSync(p,"utf8");
test("HCM queue and event endpoints use authenticated company-wide People access",()=>{
  for(const path of ["src/app/api/hcm/work-items/route.ts","src/app/api/hcm/work-items/events/route.ts"]){
    const source=read(path);
    assert.match(source,/getSessionUser\(/);
    assert.match(source,/assertOrganizationRole\(user\.id, organizationId, PEOPLE_ADMIN_ROLES\)/);
    assert.match(source,/companyWide/);
  }
});
test("HCM case writes lock and limit updates by tenant",()=>{
  const source=read("src/app/api/hcm/work-items/route.ts");
  assert.match(source,/organization_id = \$1 AND id = \$2 FOR UPDATE/);
  assert.match(source,/WHERE organization_id=\$1 AND id=\$2 RETURNING/);
  assert.match(source,/uo\.organization_id = \$2/);
  assert.match(source,/hcm_work_item_events/);
});
test("SLA escalation requires a secret, locks rows, and queues deduplicated notifications",()=>{
  const source=read("src/app/api/hcm/work-items/escalate/route.ts");
  assert.match(source,/HCM_SLA_CRON_SECRET/);
  assert.match(source,/timingSafeEqual/);
  assert.match(source,/FOR UPDATE SKIP LOCKED/);
  assert.match(source,/escalated_at IS NULL/);
  assert.match(source,/ON CONFLICT \(dedupe_key\) DO NOTHING/);
});
test("HCM command center is read-only and company-wide",()=>{
  const source=read("src/app/hcm/command-center/page.tsx");
  assert.match(source,/companyWide/);
  assert.match(source,/primaryCompanyOrganizationId/);
  assert.match(source,/hcmLifecycleNotificationTasks/);
  assert.match(source,/automationOperationalCases/);
  assert.doesNotMatch(source,/db\.(insert|update|delete)\(/);
});
test("canonical sequential migration fields exist in Drizzle schema",()=>{
  const schema=read("src/db/schema.ts");
  const migration=read("drizzle/0104_hcm_work_item_sla.sql");
  assert.ok(migration.includes("ALTER TABLE automation_operational_cases"));
  assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS hcm_work_item_events"));
  for(const [column,field] of [
    ["assigned_owner_user_id","assignedOwnerUserId"],
    ["sla_due_at","slaDueAt"],
    ["sla_escalate_at","slaEscalateAt"],
    ["escalated_at","escalatedAt"],
    ["escalation_level","escalationLevel"],
  ]){
    assert.ok(migration.includes(column));
    assert.ok(schema.includes(field+":"));
  }
});
