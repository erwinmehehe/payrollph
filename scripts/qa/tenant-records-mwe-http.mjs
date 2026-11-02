import {db,S,eq,addWorker,prove,exact,denial,http}
  from "./tenant-records-mwe-migration-shared.mjs";

async function classification(e,worker,decision,from){
  const [r]=await db.insert(S.employeeMweClassifications).values({
    organizationId:e.org.id,employeeId:worker.id,
    isMwe:decision==="approve",region:"NCR",
    employeeDailyWage:"600.00",statutoryMinimumWage:"600.00",
    wageOrderReference:"Fictional Wage Order QA-01",
    evidenceReference:"SYNTHETIC-MWE-PG16-ONLY",
    effectiveFrom:from,status:"pending",
    requestedByUserId:e.requester.id,requestedByName:e.requester.name,
  }).returning();
  return r;
}
const path=(workerId,id)=>"/api/employees/"+workerId+
  "/mwe-classifications/"+id;
const patch=(e,workerId,id,decision,selectors={})=>
  http(path(workerId,id),"PATCH",e.cookie,{
    decision,decisionNote:"Synthetic checker decision "+decision,...selectors,
  });
export async function proveMwe(attackers,victim){
  const own=new Map();
  for(const e of attackers){
    const acceptWorker=await addWorker(e,"MWEPOS",{payProfile:false});
    const rejectWorker=await addWorker(e,"MWENEG",{payProfile:false});
    const accept=await classification(e,acceptWorker,"approve","2026-03-01");
    const reject=await classification(e,rejectWorker,"reject","2026-04-01");
    own.set(e,{acceptWorker,rejectWorker,accept,reject});
  }
  // Actual higher-ID victim, not an invented 404 probe.
  for(let i=0;i<7;i++){
    const w=await addWorker(victim,"MWEF"+i,{payProfile:false});
    await classification(victim,w,"approve","2026-03-01");
  }
  const victimWorker=await addWorker(victim,"MWEVICTIM",{payProfile:false});
  const victimRow=await classification(victim,victimWorker,"approve","2026-04-01");
  prove(victimWorker.id>6&&victimRow.id>6&&
    victimRow.id>own.get(attackers[1]).reject.id,
    "actual victim classification and employee are higher-ID persisted rows >6");
  for(const e of attackers){
    const c=own.get(e);
    for(const [decision,worker,record] of [
      ["approve",c.acceptWorker,c.accept],["reject",c.rejectWorker,c.reject]
    ]){
      const r=exact(await patch(e,worker.id,record.id,decision,{
        organizationId:victim.org.id,employeeId:victimWorker.id,
        classificationId:victimRow.id,
      }),200,e.label+" owned independent-checker "+decision+" HTTP PATCH");
      prove(r.json?.kind===(decision==="approve"?"approved":"rejected"),
        "MWE PATCH "+decision+" succeeded, not empty or feature-disabled");
      const [saved]=await db.select().from(S.employeeMweClassifications)
        .where(eq(S.employeeMweClassifications.id,record.id));
      prove(saved?.organizationId===e.org.id&&saved.employeeId===worker.id&&
        saved.decidedByUserId===e.owner.id&&
        saved.status===(decision==="approve"?"approved":"rejected"),
        "own "+decision+" persists with authenticated checker, forged body selectors ignored");
      const events=await db.select().from(S.auditEvents)
        .where(eq(S.auditEvents.organizationId,e.org.id));
      prove(events.some(x=>x.action==="MWE classification "+(decision==="approve"?"approved":"rejected")&&
        Number(x.metadata?.classificationId)===record.id),
        "real owner-scoped audit appended on MWE "+decision);
    }
  }
  return async ()=>{
    for(const e of attackers){
      const c=own.get(e);
      await denial(await patch(e,victimWorker.id,victimRow.id,"approve",{
        organizationId:e.org.id}),403,victim,
        "real victim MWE classification denied under attacker's cookie");
      await denial(await patch(e,c.acceptWorker.id,victimRow.id,"approve"),
        404,victim,"forged higher-ID victim classification on own employee path");
      await denial(await patch(e,victimWorker.id,c.accept.id,"reject"),
        404,victim,"forged victim employee path with own classification ID");
      const replay=exact(await patch(e,c.acceptWorker.id,c.accept.id,"approve"),
        409,"already-approved own MWE cannot replay");
      prove(typeof replay.json?.error==="string",
        "finished MWE request cannot be silently reapproved");
    }
    return {victimRow,victimWorker};
  };
}
