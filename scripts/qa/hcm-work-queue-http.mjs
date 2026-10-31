/**
 * Real synthetic HTTP/PG16 three-organization HCM work/notification proof.
 * No real employees, payroll, provider calls, feature flags or money movement.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps,
  hcmLifecycleNotificationTasks, automationOperationalCases,
  employees, payrollRuns, auditEvents,
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
  await verifyHcmWorkItemsPageTenantBoundary(f, { request, expectStatus });
}


/**
 * Uncredited page candidate. A client-only /hcm/work-items HTML shell may
 * return 200 for either employer selector; it must contain no private employer
 * rows. Actual data are loaded ONLY via the separately authenticated, scoped
 * /api/hcm/work-items GET. Never treat a 200 shell as tenant authorization.
 *
 * Executed by the immutable tenant-second-pass runner on real localhost HTTP
 * and a disposable PG16 fixture; no browser mock, production credential, flag
 * change, payroll mutation, coverage promotion or review credit.
 */
export async function verifyHcmWorkItemsPageTenantBoundary(f, { request, expectStatus }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  assert.equal(process.env.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.equal(f.orgs.length, 3);
  assert.ok(f.victimEmployee.id > 6, "Real higher-ID victim must be populated");

  // Three real, distinct persisted cases prevent an empty-list false pass.
  const cases = await db.insert(automationOperationalCases).values(f.orgs.map((org, idx) => ({
    organizationId: org.id,
    caseType: "coverage_recovery",
    sourceType: "synthetic_ci_only",
    sourceId: idx === 0 ? f.victimEmployee.id : f.ownedEmployees[idx - 1].id,
    ownerTeam: "HR Operations",
    assignedOwnerUserId: idx === 1 ? null : f.owners[idx].id,
    title: idx === 0 ? "VICTIM-ONLY-WORK-QUEUE-CASE" : "Attacker-owned queue " + idx,
    detail: "Fictional HR work item for scoped read proof",
    slaDueAt: new Date("2026-10-01T00:00:00.000Z"),
    status: "open",
  }))).returning({ id: automationOperationalCases.id, organizationId: automationOperationalCases.organizationId });
  assert.equal(new Set(cases.map(item => item.id)).size, 3);

  const victim = f.orgs[0];
  const victimCaseSnapshot = () => db.select().from(automationOperationalCases)
    .where(eq(automationOperationalCases.organizationId, victim.id)).orderBy(automationOperationalCases.id);
  const victimWorkerSnapshot = () => db.select().from(employees)
    .where(eq(employees.organizationId, victim.id)).orderBy(employees.id);
  const victimPayrollSnapshot = () => db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, victim.id)).orderBy(payrollRuns.id);
  const victimAuditSnapshot = () => db.select().from(auditEvents)
    .where(eq(auditEvents.organizationId, victim.id)).orderBy(auditEvents.id);
  const beforeCases = await victimCaseSnapshot();
  const beforeWorkers = await victimWorkerSnapshot();
  const beforePayroll = await victimPayrollSnapshot();
  const beforeAudit = await victimAuditSnapshot();
  assert.ok(beforeCases.some(row => row.id === cases[0].id), "Victim-only case is persisted");

  let ownPositives = 0;
  let foreignDenials = 0;
  for (const idx of [1, 2]) {
    const actor = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    const ownPage = expectStatus(await request("/hcm/work-items?organizationId=" + actor.id, { cookie }),
      200, "Own authenticated work queue page must render");
    assert.match(ownPage.headers.get("content-type") ?? "", /text\/html/i);
    assert.ok(ownPage.text.includes("HR Work Queue"), "Page must be real work queue, not empty placeholder");
    assert.ok(!ownPage.text.includes("VICTIM-ONLY-WORK-QUEUE-CASE"), "Own SSR cannot contain victim PII");

    // The client-rendered HTML shell is not an authorization receipt. The API
    // must independently reject a forged foreign employer selector.
    const foreignPage = await request("/hcm/work-items?organizationId=" + victim.id, { cookie });
    assert.ok([200, 403, 404].includes(foreignPage.status), "Foreign HTML must not produce server error");
    assert.ok(!foreignPage.text.includes("VICTIM-ONLY-WORK-QUEUE-CASE"),
      "Foreign selector cannot serialize victim work item into HTML/RSC");

    const ownApi = expectStatus(await request("/api/hcm/work-items?organizationId=" + actor.id + "&status=open", { cookie }),
      200, "Own HCM work items GET must return populated organization-scoped records");
    assert.ok(Array.isArray(ownApi.json?.items) && Array.isArray(ownApi.json?.owners),
      "A 200 response without work items and owner arrays cannot count as positive");
    assert.ok(ownApi.json.items.some(row => row.id === cases[idx].id && row.organizationId === actor.id),
      "Owned persisted HR case must appear in own API response");
    assert.ok(ownApi.json.items.every(row => row.organizationId === actor.id),
      "Owned response may never include another employer");
    assert.ok(!ownApi.text.includes("VICTIM-ONLY-WORK-QUEUE-CASE"),
      "Own API response must not contain the victim-only case marker");
    ownPositives += 1;

    const foreignApi = expectStatus(await request("/api/hcm/work-items?organizationId=" + victim.id + "&status=open", { cookie }),
      403, "Foreign employer HCM work queue must deny authorized attacker");
    assert.ok(!foreignApi.text.includes("VICTIM-ONLY-WORK-QUEUE-CASE"),
      "Foreign denied response cannot expose case data");
    foreignDenials += 1;
    const other = f.orgs[idx === 1 ? 2 : 1];
    expectStatus(await request("/api/hcm/work-items?organizationId=" + other.id + "&status=open", { cookie }),
      403, "Cross-attacker company selector must also be denied");
    foreignDenials += 1;
  }
  assert.equal(ownPositives, 2);
  assert.equal(foreignDenials, 4);
  assert.deepEqual(await victimCaseSnapshot(), beforeCases,
    "Denied page and API reads cannot modify victim cases");
  assert.deepEqual(await victimWorkerSnapshot(), beforeWorkers,
    "Denied page and API reads cannot modify victim employees");
  assert.deepEqual(await victimPayrollSnapshot(), beforePayroll,
    "Denied page and API reads cannot modify victim payroll");
  assert.deepEqual(await victimAuditSnapshot(), beforeAudit,
    "Denied page and API reads cannot modify victim audit events");
}
