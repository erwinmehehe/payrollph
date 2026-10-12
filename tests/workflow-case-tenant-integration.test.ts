import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employees, employeeServiceCases, employeeServiceCaseMessages,
  offlinePunchClaims, organizations, users,
} from "../src/db/schema";

/** Real Drizzle/PostgreSQL fixture. Skips only before the additive migration is applied. */
test("case and offline-claim storage refuses cross-tenant IDs and preserves private case scope", async t => {
  const [schema] = (await db.execute(sql`select to_regclass('public.employee_service_cases') as cases, to_regclass('public.offline_punch_claims') as punches`)).rows as Array<{ cases: string|null; punches: string|null }>;
  if (!schema?.cases || !schema?.punches) { t.skip("Run additive 0115 workflow migration on an isolated DB first."); return; }
  const suffix = randomUUID().slice(0, 10);
  const [a,b] = await db.insert(organizations).values([
    { name: "Request Tenant Alpha " + suffix, legalName: "Request Tenant Alpha " + suffix },
    { name: "Request Tenant Beta " + suffix, legalName: "Request Tenant Beta " + suffix },
  ]).returning();
  let userId: number | null = null;
  try {
    const [first, second, foreign] = await db.insert(employees).values([
      { organizationId:a.id,employeeNo:"CASE-A1-"+suffix,firstName:"Alpha",lastName:"Private",
        title:"Staff",avatarInitials:"AP",basicRate:"20000.00",startDate:"2026-01-01" },
      { organizationId:a.id,employeeNo:"CASE-A2-"+suffix,firstName:"AlphaTwo",lastName:"Private",
        title:"Staff",avatarInitials:"AT",basicRate:"20000.00",startDate:"2026-01-01" },
      { organizationId:b.id,employeeNo:"CASE-B1-"+suffix,firstName:"BetaSecret",lastName:"Private",
        title:"Staff",avatarInitials:"BP",basicRate:"99999.00",startDate:"2026-01-01" },
    ]).returning();
    const [actor] = await db.insert(users).values({
      name:"Synthetic Test User "+suffix,email:"workflow-"+suffix+"@example.test",
      passwordHash:"fixture-only",role:"employee",
    }).returning();
    userId=actor.id;
    const [own, coworkers, other] = await db.insert(employeeServiceCases).values([
      { organizationId:a.id,employeeId:first.id,category:"pay_question",subject:"Private Alpha pay",
        description:"Synthetic private alpha case" },
      { organizationId:a.id,employeeId:second.id,category:"leave",subject:"Private colleague leave",
        description:"Synthetic coworker case" },
      { organizationId:b.id,employeeId:foreign.id,category:"pay_question",subject:"Private Beta payroll",
        description:"Synthetic foreign tenant case" },
    ]).returning();
    await db.insert(employeeServiceCaseMessages).values([
      { organizationId:a.id,caseId:own.id,authorUserId:actor.id,body:"My own case reply" },
      { organizationId:b.id,caseId:other.id,authorUserId:actor.id,body:"Foreign case testing fixture" },
    ]);
    const [claim] = await db.insert(offlinePunchClaims).values({
      organizationId:a.id,employeeId:first.id,submittedByUserId:actor.id,
      clientEventId:randomUUID(),claimedAt:new Date("2026-10-12T01:00:00Z"),
      actionType:"clock_in",
    }).returning();
    // These are the same tenant-and-employee constraints used by employee case GET.
    const accessible = await db.select({ id:employeeServiceCases.id })
      .from(employeeServiceCases).where(and(
        eq(employeeServiceCases.organizationId,a.id),eq(employeeServiceCases.employeeId,first.id),
      ));
    assert.deepEqual(accessible.map(item=>item.id),[own.id]);
    assert.ok(accessible.every(row=>row.id!==coworkers.id && row.id!==other.id));
    assert.deepEqual(await db.select({ id: employeeServiceCases.id }).from(employeeServiceCases).where(and(
      eq(employeeServiceCases.organizationId,b.id),eq(employeeServiceCases.employeeId,first.id),
    )),[]);
    const messages=await db.select({ id:employeeServiceCaseMessages.id })
      .from(employeeServiceCaseMessages).where(and(
        eq(employeeServiceCaseMessages.organizationId,a.id),eq(employeeServiceCaseMessages.caseId,own.id),
      ));
    assert.equal(messages.length,1);
    const claims=await db.select({ id:offlinePunchClaims.id })
      .from(offlinePunchClaims).where(and(
        eq(offlinePunchClaims.organizationId,a.id),eq(offlinePunchClaims.employeeId,first.id),
      ));
    assert.deepEqual(claims.map(row=>row.id),[claim.id]);
    // DB constraints prevent direct writes with an otherwise-valid foreign tenant worker/case ID.
    await assert.rejects(()=>db.insert(employeeServiceCases).values({
      organizationId:a.id,employeeId:foreign.id,category:"pay_question",
      subject:"Foreign mismatch",description:"Must fail FK",
    }));
    await assert.rejects(()=>db.insert(offlinePunchClaims).values({
      organizationId:b.id,employeeId:first.id,submittedByUserId:actor.id,
      clientEventId:randomUUID(),claimedAt:new Date(),actionType:"clock_in",
    }));
    await assert.rejects(()=>db.insert(employeeServiceCaseMessages).values({
      organizationId:b.id,caseId:own.id,authorUserId:actor.id,body:"Must fail FK",
    }));
  } finally {
    await db.delete(employeeServiceCaseMessages).where(inArray(employeeServiceCaseMessages.organizationId,[a.id,b.id]));
    await db.delete(offlinePunchClaims).where(inArray(offlinePunchClaims.organizationId,[a.id,b.id]));
    await db.delete(employeeServiceCases).where(inArray(employeeServiceCases.organizationId,[a.id,b.id]));
    await db.delete(employees).where(inArray(employees.organizationId,[a.id,b.id]));
    if(userId) await db.delete(users).where(eq(users.id,userId));
    await db.delete(organizations).where(inArray(organizations.id,[a.id,b.id]));
  }
});
