import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { employees, offlinePunchClaims, organizations, users } from "../src/db/schema";

/** Real synthetic Postgres constraint coverage; skips only before isolated schema installation. */
test("unverified offline claims refuse foreign-employer employee IDs and retain tenant isolation", async t => {
  const [catalog] = (await db.execute(sql`select to_regclass('public.offline_punch_claims') as punches`)).rows as Array<{ punches: string | null }>;
  if (!catalog?.punches) {
    t.skip("Source-only SQL proposal has not been installed in this isolated database.");
    return;
  }
  const suffix = randomUUID().slice(0, 10);
  const [a,b] = await db.insert(organizations).values([
    { name: "Offline Claim Employer Alpha "+suffix, legalName: "Offline Claim Employer Alpha "+suffix },
    { name: "Offline Claim Employer Beta "+suffix, legalName: "Offline Claim Employer Beta "+suffix },
  ]).returning();
  let actorId: number | null = null;
  try {
    const [one, two, foreign] = await db.insert(employees).values([
      { organizationId:a.id, employeeNo:"OFF-A1-"+suffix, firstName:"Alpha", lastName:"Private",
        title:"Staff", avatarInitials:"AP", basicRate:"20000.00", startDate:"2026-01-01" },
      { organizationId:a.id, employeeNo:"OFF-A2-"+suffix, firstName:"AlphaTwo", lastName:"Private",
        title:"Staff", avatarInitials:"AT", basicRate:"20000.00", startDate:"2026-01-01" },
      { organizationId:b.id, employeeNo:"OFF-B1-"+suffix, firstName:"BetaSecret", lastName:"Private",
        title:"Staff", avatarInitials:"BP", basicRate:"99999.00", startDate:"2026-01-01" },
    ]).returning();
    const [actor] = await db.insert(users).values({
      name:"Synthetic Offline Claim User "+suffix,
      email:"offline-"+suffix+"@example.test", passwordHash:"fixture-only", role:"employee",
    }).returning();
    actorId=actor.id;
    const [own, coworker, other] = await db.insert(offlinePunchClaims).values([
      { organizationId:a.id, employeeId:one.id, submittedByUserId:actor.id,
        clientEventId:randomUUID(), claimedAt:new Date("2026-10-12T01:00:00Z"), actionType:"clock_in" },
      { organizationId:a.id, employeeId:two.id, submittedByUserId:actor.id,
        clientEventId:randomUUID(), claimedAt:new Date("2026-10-12T02:00:00Z"), actionType:"clock_out" },
      { organizationId:b.id, employeeId:foreign.id, submittedByUserId:actor.id,
        clientEventId:randomUUID(), claimedAt:new Date("2026-10-12T03:00:00Z"), actionType:"clock_in" },
    ]).returning();
    const scoped = await db.select({ id:offlinePunchClaims.id }).from(offlinePunchClaims).where(and(
      eq(offlinePunchClaims.organizationId,a.id), eq(offlinePunchClaims.employeeId,one.id),
    ));
    assert.deepEqual(scoped.map(row=>row.id), [own.id]);
    assert.ok(scoped.every(row=>row.id!==coworker.id && row.id!==other.id));
    assert.deepEqual(await db.select({ id:offlinePunchClaims.id }).from(offlinePunchClaims).where(and(
      eq(offlinePunchClaims.organizationId,b.id), eq(offlinePunchClaims.employeeId,one.id),
    )),[]);
    await assert.rejects(() => db.insert(offlinePunchClaims).values({
      organizationId:a.id, employeeId:foreign.id, submittedByUserId:actor.id,
      clientEventId:randomUUID(), claimedAt:new Date(), actionType:"clock_in",
    }));
    await assert.rejects(() => db.insert(offlinePunchClaims).values({
      organizationId:b.id, employeeId:one.id, submittedByUserId:actor.id,
      clientEventId:randomUUID(), claimedAt:new Date(), actionType:"clock_out",
    }));
  } finally {
    await db.delete(offlinePunchClaims).where(inArray(offlinePunchClaims.organizationId,[a.id,b.id]));
    await db.delete(employees).where(inArray(employees.organizationId,[a.id,b.id]));
    if(actorId!==null) await db.delete(users).where(eq(users.id,actorId));
    await db.delete(organizations).where(inArray(organizations.id,[a.id,b.id]));
  }
});
