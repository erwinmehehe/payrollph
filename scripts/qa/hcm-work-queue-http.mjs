/**
 * Real synthetic HTTP/PG16 three-organization HCM work/notification proof.
 * No real employees, payroll, provider calls, feature flags or money movement.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps,
  hcmLifecycleNotificationTasks,
} from "../../src/db/schema";

export async function verifyHcmWorkQueueIsolation(f, { request, expectStatus }) {
  if (process.env.CI !== "true" ||
      process.env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      !/^(postgresql:\/\/)([^/]+@)(127\.0\.0\.1|localhost):5432\/app_db$/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("HCM queue tenant proof requires disposable localhost PG16.");
  }
  const instances = await db.insert(hcmBusinessProcessInstances).values(f.orgs.map((org,idx)=>({
    organizationId:org.id,definitionCode:"QA-FICTIONAL",definitionVersion:1,
    processType:"hire",sourceType:"synthetic_ci_only",sourceKey:"fictional-"+org.id,
    employeeId:idx===0?f.victimEmployee.id:f.ownedEmployees[idx-1].id,
    effectiveDate:"2026-10-10",status:"in_progress",currentStepIndex:0,
    definitionSnapshot:{name:"Fictional hiring check"},
    initiatedByUserId:f.owners[idx].id,initiatedByName:f.owners[idx].name,
  }))).returning({id:hcmBusinessProcessInstances.id});
  const steps = await db.insert(hcmBusinessProcessInstanceSteps).values(f.orgs.map((org,idx)=>({
    organizationId:org.id,instanceId:instances[idx].id,stepIndex:0,
    stepType:"to_do",label:"Fictional policy check",
    assignee:"role:owner",status:"pending",
  }))).returning({id:hcmBusinessProcessInstanceSteps.id});
  const tasks = await db.insert(hcmLifecycleNotificationTasks).values(f.orgs.map((org,idx)=>({
    organizationId:org.id,employeeId:idx===0?f.victimEmployee.id:f.ownedEmployees[idx-1].id,
    sourceType:"employment_decision",sourceKey:"qa-notification-"+org.id,
    sourceId:null,action:"review_decision",stage:"probation",
    escalationStage:0,severity:"warning",title:"Fictional HR review",
    detail:"Fictional synthetic HCM evidence only",
    dueDate:"2026-10-30",status:"open",
    ownerUserId:f.owners[idx].id,ownerName:f.owners[idx].name,
  }))).returning({id:hcmLifecycleNotificationTasks.id});
  const victim=f.orgs[0];
  const victimStepsBefore=await db.select().from(hcmBusinessProcessInstanceSteps)
    .where(eq(hcmBusinessProcessInstanceSteps.organizationId,victim.id));
  const victimTasksBefore=await db.select().from(hcmLifecycleNotificationTasks)
    .where(eq(hcmLifecycleNotificationTasks.organizationId,victim.id));
  for (const idx of [1,2]) {
    const org=f.orgs[idx],cookie=f.ownerSessions[idx].cookie;
    const ownHcmInbox = expectStatus(await request("/api/hcm/business-processes/inbox?organizationId=" +
      org.id, {cookie}), 200, "Own employer HCM queue returns real pending task");
    assert.equal(ownHcmInbox.json?.organizationId,org.id);
    assert.ok(ownHcmInbox.json?.myWork?.some(row=>row.id===steps[idx].id));
    assert.ok(!ownHcmInbox.json?.myWork?.some(row=>row.id===steps[0].id));
    expectStatus(await request("/api/hcm/business-processes/inbox?organizationId=" +
      victim.id, {cookie}), 403, "Other employer HCM work queue must deny real victim");
    const ownHcmAction = expectStatus(await request("/api/hcm/business-processes/inbox", {
      method:"POST",cookie,body:{organizationId:org.id,stepId:steps[idx].id,action:"complete"},
    }), 200, "Own HCM synthetic to-do completion succeeds");
    assert.equal(ownHcmAction.json?.result?.instanceId,instances[idx].id);
    expectStatus(await request("/api/hcm/business-processes/inbox", {
      method:"POST",cookie,body:{organizationId:victim.id,stepId:steps[0].id,action:"complete"},
    }), 403, "Foreign HCM approval completion must fail");
    const ownLifecycleRead = expectStatus(await request("/api/hcm/lifecycle-notifications?organizationId=" +
      org.id, {cookie}), 200, "Own HCM lifecycle inbox reads real task");
    assert.equal(ownLifecycleRead.json?.organizationId,org.id);
    assert.ok(ownLifecycleRead.json?.tasks?.some(task=>task.id===tasks[idx].id));
    assert.ok(!ownLifecycleRead.json?.tasks?.some(task=>task.id===tasks[0].id));
    expectStatus(await request("/api/hcm/lifecycle-notifications?organizationId=" +
      victim.id, {cookie}), 403, "Foreign HCM lifecycle queue denied");
    const ownLifecycleMutation = expectStatus(await request("/api/hcm/lifecycle-notifications", {
      method:"PATCH",cookie,
      body:{organizationId:org.id,taskId:tasks[idx].id,action:"acknowledge"},
    }), 200, "Own HCM lifecycle task acknowledgement succeeds");
    assert.equal(ownLifecycleMutation.json?.task?.organizationId,org.id);
    assert.equal(ownLifecycleMutation.json?.task?.status,"acknowledged");
    expectStatus(await request("/api/hcm/lifecycle-notifications", {
      method:"PATCH",cookie,
      body:{organizationId:victim.id,taskId:tasks[0].id,action:"acknowledge"},
    }), 403, "Foreign HCM lifecycle PATCH denied");
  }
  const victimStepsAfter=await db.select().from(hcmBusinessProcessInstanceSteps)
    .where(eq(hcmBusinessProcessInstanceSteps.organizationId,victim.id));
  const victimTasksAfter=await db.select().from(hcmLifecycleNotificationTasks)
    .where(eq(hcmLifecycleNotificationTasks.organizationId,victim.id));
  assert.deepEqual(victimStepsAfter,victimStepsBefore,"Victim HCM work items stay unchanged");
  assert.deepEqual(victimTasksAfter,victimTasksBefore,"Victim lifecycle tasks stay unchanged");
}
