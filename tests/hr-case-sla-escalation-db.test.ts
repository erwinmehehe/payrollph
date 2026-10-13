import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, employeeHrCases, employees, organizations, users } from "../src/db/schema";
import { runDueHrCaseSlaEscalations } from "../src/lib/hr-case-sla-escalation";

test("internal HR case SLA signal is flagged, idempotent, role-only and employer-bound", async () => {
  const prev = process.env.EMPLOYEE_HR_CASES_ENABLED;
  const orgIds: number[] = [];
  let actorId: number | null = null;
  const suffix = randomUUID().slice(0, 11);
  try {
    const [alpha, beta] = await db.insert(organizations).values([
      { name: "SLA alpha " + suffix, legalName: "SLA alpha " + suffix },
      { name: "SLA beta " + suffix, legalName: "SLA beta " + suffix },
    ]).returning();
    orgIds.push(alpha.id, beta.id);
    const [actor] = await db.insert(users).values({
      email: "case-sla-" + suffix + "@example.test", name: "Synthetic worker",
      role: "employee", passwordHash: "never-valid",
    }).returning();
    actorId = actor.id;
    const [wa, wb] = await db.insert(employees).values([
      {organizationId: alpha.id, employeeNo: "A" + suffix, firstName: "Synthetic",
        lastName: "Alpha", title: "Staff", avatarInitials: "SA", basicRate: "10000", startDate: "2026-01-01"},
      {organizationId: beta.id, employeeNo: "B" + suffix, firstName: "Synthetic",
        lastName: "Beta", title: "Staff", avatarInitials: "SB", basicRate: "10000", startDate: "2026-01-01"},
    ]).returning();
    const now = new Date();
    const past = new Date(now.getTime() - 2 * 86_400_000);
    const future = new Date(now.getTime() + 2 * 86_400_000);
    const base = { createdByUserId: actor.id, caseType: "general",
      subject: "Synthetic support", description: "No employee details outside private table",
      assignedRole: "hr" };
    const [activeA, activeB, resolved, scheduled] = await db.insert(employeeHrCases).values([
      {...base,organizationId:alpha.id,employeeId:wa.id,slaDueAt:past,status:"open"},
      {...base,organizationId:beta.id,employeeId:wb.id,slaDueAt:past,status:"in_progress"},
      {...base,organizationId:alpha.id,employeeId:wa.id,slaDueAt:past,status:"resolved"},
      {...base,organizationId:alpha.id,employeeId:wa.id,slaDueAt:future,status:"open"},
    ]).returning();
    process.env.EMPLOYEE_HR_CASES_ENABLED = "false";
    assert.deepEqual(await runDueHrCaseSlaEscalations(now), {skipped:true,overdueRecorded:0});
    process.env.EMPLOYEE_HR_CASES_ENABLED = "true";
    const ticks = await Promise.all([
      runDueHrCaseSlaEscalations(now), runDueHrCaseSlaEscalations(now),
    ]);
    assert.equal(ticks.reduce((a,x)=>a+x.overdueRecorded,0),2);
    const scoped = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId,alpha.id),
      eq(auditEvents.action,"HR case internal SLA overdue"),
    ));
    assert.equal(scoped.length,1);
    const metadata = scoped[0].metadata as Record<string,unknown>;
    assert.equal(metadata.hrCaseId,activeA.id);
    assert.equal(metadata.assignedRole,"hr");
    assert.equal(metadata.internalTargetOnly,true);
    assert.equal(JSON.stringify(metadata).includes("Synthetic support"),false);
    const foreign = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId,beta.id),
      eq(auditEvents.action,"HR case internal SLA overdue"),
    ));
    assert.equal(foreign.length,1);
    assert.equal((foreign[0].metadata as Record<string,unknown>).hrCaseId,activeB.id);
    assert.ok(![resolved.id,scheduled.id].includes(Number(metadata.hrCaseId)));
    assert.equal((await runDueHrCaseSlaEscalations(new Date(now.getTime()+30000))).overdueRecorded,0);
  } finally {
    if(prev===undefined)delete process.env.EMPLOYEE_HR_CASES_ENABLED;
    else process.env.EMPLOYEE_HR_CASES_ENABLED=prev;
    if(orgIds.length)await db.delete(organizations).where(inArray(organizations.id,orgIds));
    if(actorId!==null)await db.delete(users).where(eq(users.id,actorId));
  }
});
