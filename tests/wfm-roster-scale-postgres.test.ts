import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../src/db";
import { organizations, employees, schedulePatterns, schedulePatternDays, schedulePatternSegments, shiftDefinitions, employeeScheduleAssignments } from "../src/db/schema";
import { scanActiveRosterAssignments } from "../src/lib/workforce-roster-scale";
import { loadClockInWatchScheduleBatch } from "../src/lib/workforce-clock-in-watch-batch";

/** Actual disposable PostgreSQL seed, not a source-text grep. */
test("WFM-12: 1000 real assignment rows page without skipping or including another tenant", {timeout:120_000}, async()=>{
  const seed=randomUUID().slice(0,10);
  const [a,b]=await db.insert(organizations).values([
    {name:"WFM-12 Synthetic A "+seed,legalName:"WFM-12 Synthetic A "+seed},
    {name:"WFM-12 Synthetic B "+seed,legalName:"WFM-12 Synthetic B "+seed},
  ]).returning();
  const syntheticPatternDayIds:number[]=[];
  try{
    const [patternA,patternB]=await db.insert(schedulePatterns).values([
      {organizationId:a.id,code:"S-"+seed,name:"Synthetic A",cycleDays:7},
      {organizationId:b.id,code:"S-"+seed,name:"Synthetic B",cycleDays:7},
    ]).returning();
    const [shiftA]=await db.insert(shiftDefinitions).values({
      organizationId:a.id,code:"D-"+seed,name:"Synthetic Day",
      startTime:"09:00",endTime:"17:00",breakMinutes:0,
    }).returning();
    const days=await db.insert(schedulePatternDays).values(
      Array.from({length:7},(_,dayIndex)=>({
        patternId:patternA.id,dayIndex,isRestDay:false,
      }))
    ).returning();
    syntheticPatternDayIds.push(...days.map(row=>row.id));
    await db.insert(schedulePatternSegments).values(
      days.map(row=>({patternDayId:row.id,shiftDefinitionId:shiftA.id,segmentOrder:1}))
    );
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
    // Exercise the exact 20-worker sort/limit/offset query used by the
    // authenticated team-roster GET. This verifies DB page completeness,
    // not HTTP authentication, UI rendering, or browser switching.
    const pageSize=20;
    const displayedIds:number[]=[];
    for(let page=1;page<=50;page++){
      const rosterPage=await db.select({
        id:employees.id,employeeNo:employees.employeeNo,
        organizationId:employees.organizationId,
      }).from(employees)
        .where(eq(employees.organizationId,a.id))
        .orderBy(asc(employees.employeeNo),asc(employees.id))
        .limit(pageSize).offset((page-1)*pageSize);
      assert.equal(rosterPage.length,pageSize,
        "every 20-worker tenant-scoped roster page must be filled");
      assert.ok(rosterPage.every(row=>row.organizationId===a.id),
        "a tenant-B employee must never appear on the A roster");
      displayedIds.push(...rosterPage.map(row=>row.id));
    }
    assert.equal(displayedIds.length,1000);
    assert.equal(new Set(displayedIds).size,1000,
      "all 1,000 visible employee IDs must be unique across 50 pages");
    assert.deepEqual([...displayedIds].sort((left,right)=>left-right),
      [...employeeIds].sort((left,right)=>left-right),
      "no authorized employee may be silently omitted");
    const emptyRosterPage=await db.select({id:employees.id}).from(employees)
      .where(eq(employees.organizationId,a.id))
      .orderBy(asc(employees.employeeNo),asc(employees.id))
      .limit(pageSize).offset(1000);
    assert.equal(emptyRosterPage.length,0,
      "page 51 must be empty rather than leaking another tenant");

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
    let resolved=0;
    for(let i=0;i<employeeIds.length;i+=100){
      const slice=employeeIds.slice(i,i+100);
      const schedules=await loadClockInWatchScheduleBatch({
        organizationId:a.id,employeeIds:slice,
        startDate:"2026-10-11",endDate:"2026-10-12",
      });
      for(const id of slice) {
        const days=schedules.get(id);
        assert.equal(days?.length,2,"each fictional worker must have a resolved two-day window");
        assert.equal(days?.[0]?.segments[0]?.startTime,"09:00");
        resolved++;
      }
    }
    assert.equal(resolved,1000,"1000 workers resolved in ten batched tenant-scoped reads");

  }finally{
    // The test owns only these fictional tenants. Deleting the organizations
    // also deletes their synthetic employees and associated schedule rows.
    if(syntheticPatternDayIds.length) await db.delete(schedulePatternSegments).where(
      inArray(schedulePatternSegments.patternDayId,syntheticPatternDayIds));
    await db.delete(organizations).where(eq(organizations.id,a.id));
    await db.delete(organizations).where(eq(organizations.id,b.id));
  }
});
