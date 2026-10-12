import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../src/db";
import { organizations, employees, schedulePatterns, employeeScheduleAssignments } from "../src/db/schema";
import { scanActiveRosterAssignments } from "../src/lib/workforce-roster-scale";

/** Actual disposable PostgreSQL seed, not a source-text grep. */
test("WFM-12: 1000 real assignment rows page without skipping or including another tenant", {timeout:120_000}, async()=>{
  const seed=randomUUID().slice(0,10);
  const [a,b]=await db.insert(organizations).values([
    {name:"WFM-12 Synthetic A "+seed,legalName:"WFM-12 Synthetic A "+seed},
    {name:"WFM-12 Synthetic B "+seed,legalName:"WFM-12 Synthetic B "+seed},
  ]).returning();
  try{
    const [patternA,patternB]=await db.insert(schedulePatterns).values([
      {organizationId:a.id,code:"S-"+seed,name:"Synthetic A",cycleDays:7},
      {organizationId:b.id,code:"S-"+seed,name:"Synthetic B",cycleDays:7},
    ]).returning();
    const employeeIds:number[]=[];
    for(let start=0;start<1000;start+=100){
      const workers=await db.insert(employees).values(
        Array.from({length:100},(_,index)=>{
          const number=start+index+1;
          return {organizationId:a.id,employeeNo:"WFM12-"+seed+"-"+number,
            firstName:"Synthetic",lastName:"Employee"+number,title:"Operator",
            avatarInitials:"SE",basicRate:"21000.00",startDate:"2026-01-01"};
        })
      ).returning({id:employees.id});
      employeeIds.push(...workers.map(row=>row.id));
    }
    const [tenantBEmployee]=await db.insert(employees).values({
      organizationId:b.id,employeeNo:"WFM12B-"+seed,firstName:"Other",lastName:"Tenant",
      title:"Operator",avatarInitials:"OT",basicRate:"21000.00",startDate:"2026-01-01",
    }).returning({id:employees.id});
    for(let start=0;start<employeeIds.length;start+=100){
      await db.insert(employeeScheduleAssignments).values(
        employeeIds.slice(start,start+100).map(employeeId=>({
          organizationId:a.id,employeeId,patternId:patternA.id,
          effectiveFrom:"2026-01-01",anchorDate:"2026-01-01",reason:"Synthetic WFM-12 page test",
        }))
      );
    }
    await db.insert(employeeScheduleAssignments).values({
      organizationId:b.id,employeeId:tenantBEmployee.id,patternId:patternB.id,
      effectiveFrom:"2026-01-01",anchorDate:"2026-01-01",reason:"Synthetic tenant-isolation sentinel",
    });
    const result=await scanActiveRosterAssignments({
      fetchPage:async(afterId,limit)=>db.select({
        id:employeeScheduleAssignments.id,employeeId:employeeScheduleAssignments.employeeId,
        organizationId:employeeScheduleAssignments.organizationId,
      }).from(employeeScheduleAssignments).where(and(
        eq(employeeScheduleAssignments.organizationId,a.id),
        gt(employeeScheduleAssignments.id,afterId),
        lte(employeeScheduleAssignments.effectiveFrom,"2026-10-12"),
        or(isNull(employeeScheduleAssignments.effectiveUntil),
          gte(employeeScheduleAssignments.effectiveUntil,"2026-10-11")),
      )).orderBy(asc(employeeScheduleAssignments.id)).limit(limit),
    });
    assert.equal(result.complete,true);
    if(!result.complete)return;
    assert.equal(result.assignmentsScanned,1000);
    assert.equal(result.pages,6);
    assert.equal(result.workers.length,1000);
    assert.ok(result.workers.every(row=>row.organizationId===a.id));
    assert.equal(new Set(result.workers.map(row=>row.employeeId)).size,1000);
  }finally{
    // The test owns only these fictional tenants. Deleting the organizations
    // also deletes their synthetic employees and associated schedule rows.
    await db.delete(organizations).where(eq(organizations.id,a.id));
    await db.delete(organizations).where(eq(organizations.id,b.id));
  }
});
