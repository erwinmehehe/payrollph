import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  organizations, users, worksites,
  workforceDemandStaffingPolicies, workforceDemandStaffingPolicyEvents,
} from "../src/db/schema";
import { parseStaffingPolicyDraft } from "../src/lib/workforce-demand-staffing-policy";
import {
  createStaffingPolicyDraft, transitionStaffingPolicy, readStaffingPolicies,
  StaffingPolicyConflict, StaffingPolicyUnauthorized,
} from "../src/lib/workforce-demand-staffing-policy-server";

const sampleScope=(organizationId:number,worksiteId:number)=>({
  organizationId,worksiteId,companyWide:true,orgUnitId:null,
});
test("isolated Postgres: exact-company versioned policy, maker-checker, replacement and evidence receipts",async()=>{
  const unique=randomUUID().slice(0,8);
  const [one,two]=await db.insert(organizations).values([
    {name:"Fictional policy A "+unique,legalName:"Fictional policy A "+unique},
    {name:"Fictional policy B "+unique,legalName:"Fictional policy B "+unique},
  ]).returning({id:organizations.id});
  let siteA=0,siteB=0,makerId=0,checkerId=0;
  try {
    const [a,b]=await db.insert(worksites).values([
      {organizationId:one.id,code:"POLA"+unique,name:"Fictional primary worksite",
        timezone:"Asia/Manila"},
      {organizationId:two.id,code:"POLB"+unique,name:"Fictional external worksite",
        timezone:"Asia/Manila"},
    ]).returning({id:worksites.id});
    siteA=a.id;siteB=b.id;
    const [maker,checker]=await db.insert(users).values([
      {name:"Synthetic proposer",email:"policy-maker-"+unique+"@example.invalid",
        passwordHash:"never-used",role:"owner"},
      {name:"Synthetic checker",email:"policy-checker-"+unique+"@example.invalid",
        passwordHash:"never-used",role:"owner"},
    ]).returning({id:users.id});
    makerId=maker.id;checkerId=checker.id;
    const source={
      organizationId:one.id,worksiteId:a.id,jobProfileId:null,metricKind:"transactions" as const,
      intervalMinutes:30 as const,effectiveFrom:"2099-01-01",effectiveUntil:"2099-01-07",
      productiveUnitsPerWorkerHour:10.25,serviceTargetCoveragePercent:92.5,
      rationale:"Synthetic complete-volume productivity and coverage target",
      idempotencyKey:"policy-"+randomUUID(),
    };
    const access=sampleScope(one.id,a.id);
    const first=await createStaffingPolicyDraft({
      spec:parseStaffingPolicyDraft(source),actorUserId:maker.id,access,
    });
    assert.equal(first.version,1);
    assert.equal(first.status,"draft");
    const retry=await createStaffingPolicyDraft({
      spec:parseStaffingPolicyDraft(source),actorUserId:maker.id,access,
    });
    assert.equal(retry.replayed,true);
    assert.equal(retry.id,first.id);
    await assert.rejects(createStaffingPolicyDraft({
      spec:parseStaffingPolicyDraft({...source,productiveUnitsPerWorkerHour:40}),
      actorUserId:maker.id,access,
    }),StaffingPolicyConflict);

    await assert.rejects(createStaffingPolicyDraft({
      spec:parseStaffingPolicyDraft({
        ...source,worksiteId:b.id,idempotencyKey:"foreign-"+randomUUID(),
      }),actorUserId:maker.id,access,
    }),StaffingPolicyUnauthorized,"cross-tenant worksite must be unavailable");

    const change=(policyId:number,action:"submit"|"approve"|"reject",decisionNote:string)=>({
      organizationId:one.id,policyId,action,decisionNote,acknowledged:true as const,
    });
    const submitted=await transitionStaffingPolicy({
      change:change(first.id,"submit",""),actorUserId:maker.id,actorRole:"owner",access,
    });
    assert.equal(submitted.status,"submitted");
    await assert.rejects(transitionStaffingPolicy({
      change:change(first.id,"approve","Self-approval must never be possible"),
      actorUserId:maker.id,actorRole:"owner",access,
    }),StaffingPolicyUnauthorized);
    const approved=await transitionStaffingPolicy({
      change:change(first.id,"approve","Independent fictional manager policy verification"),
      actorUserId:checker.id,actorRole:"owner",access,
    });
    assert.equal(approved.status,"approved");
    assert.match(approved.approvalReceiptSha256??"",/^[a-f0-9]{64}$/);
    const listed=await readStaffingPolicies({
      organizationId:one.id,worksiteId:a.id,jobProfileId:null,
      metricKind:"transactions",intervalMinutes:30,mode:"approved",
    });
    assert.equal(listed.length,1);
    assert.equal(listed[0].approvalIntegrity,"matches_hash");
    assert.equal(listed[0].productiveUnitsPerWorkerHour,10.25);
    assert.equal((await readStaffingPolicies({
      organizationId:two.id,worksiteId:a.id,jobProfileId:null,
      metricKind:"transactions",intervalMinutes:30,mode:"approved",
    })).length,0,"no cross-employer policy read");

    const v2=await createStaffingPolicyDraft({
      spec:parseStaffingPolicyDraft({...source,
        effectiveFrom:"2099-01-07",effectiveUntil:"2099-01-14",
        idempotencyKey:"overlap-"+randomUUID()}),
      actorUserId:maker.id,access,
    });
    assert.equal(v2.version,2);
    await transitionStaffingPolicy({
      change:change(v2.id,"submit",""),actorUserId:maker.id,actorRole:"owner",access,
    });
    await assert.rejects(transitionStaffingPolicy({
      change:change(v2.id,"approve","Partial overlap is intentionally blocked"),
      actorUserId:checker.id,actorRole:"owner",access,
    }),StaffingPolicyConflict);
    assert.equal((await readStaffingPolicies({
      organizationId:one.id,worksiteId:a.id,jobProfileId:null,
      metricKind:"transactions",intervalMinutes:30,mode:"approved",
    })).length,1);

    const v3=await createStaffingPolicyDraft({
      spec:parseStaffingPolicyDraft({...source,
        productiveUnitsPerWorkerHour:11.75,
        idempotencyKey:"revised-"+randomUUID()}),
      actorUserId:maker.id,access,
    });
    assert.equal(v3.version,3);
    await transitionStaffingPolicy({
      change:change(v3.id,"submit",""),actorUserId:maker.id,actorRole:"owner",access,
    });
    const newApproval=await transitionStaffingPolicy({
      change:change(v3.id,"approve","Independently approved same-window revision"),
      actorUserId:checker.id,actorRole:"owner",access,
    });
    assert.equal(newApproval.supersededPolicyId,first.id);
    const remaining=await readStaffingPolicies({
      organizationId:one.id,worksiteId:a.id,jobProfileId:null,
      metricKind:"transactions",intervalMinutes:30,mode:"approved",
    });
    assert.equal(remaining.length,1);
    assert.equal(remaining[0].id,v3.id);
    assert.equal(remaining[0].approvalIntegrity,"matches_hash");
    const historical=await db.select().from(workforceDemandStaffingPolicyEvents).where(and(
      eq(workforceDemandStaffingPolicyEvents.organizationId,one.id),
      eq(workforceDemandStaffingPolicyEvents.policyId,first.id),
    ));
    assert.ok(historical.some(v=>v.action==="superseded"));
    assert.ok(historical.some(v=>v.action==="approved"));
  } finally {
    // Exact isolated fixture cleanup; never operates on real employer records.
    await db.delete(workforceDemandStaffingPolicyEvents)
      .where(eq(workforceDemandStaffingPolicyEvents.organizationId,one.id));
    await db.delete(workforceDemandStaffingPolicies)
      .where(eq(workforceDemandStaffingPolicies.organizationId,one.id));
    if(siteA)await db.delete(worksites).where(eq(worksites.id,siteA));
    if(siteB)await db.delete(worksites).where(eq(worksites.id,siteB));
    if(makerId)await db.delete(users).where(eq(users.id,makerId));
    if(checkerId)await db.delete(users).where(eq(users.id,checkerId));
    await db.delete(organizations).where(eq(organizations.id,one.id));
    await db.delete(organizations).where(eq(organizations.id,two.id));
  }
});
