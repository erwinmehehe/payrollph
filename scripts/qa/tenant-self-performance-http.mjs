/**
 * Three independently proved GET / POST / PATCH employee performance methods,
 * using production Next HTTP and a disposable PostgreSQL 16 localhost database.
 * No production changes or automatic manifest coverage credit.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {
  ENDPOINT,METHODS,requireDisposablePerformance,assertNoLeak,assertOwnRead,
  assertOwnPost,assertOwnPatch,assertDenied,assertUnchanged,assertOneAuditAdded,
} from "./tenant-self-performance-contract.mjs";

export async function proveSelfPerformance() {
  // Do not import anything that opens the app database before this check.
  requireDisposablePerformance();
  const [{db,pool},s,http,{eq,asc},{auditBusinessSnapshot}]=await Promise.all([
    import("../../src/db/index.ts"),import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),import("drizzle-orm"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const nonce=randomUUID().replaceAll("-","").slice(0,10);
  const tables={
    employees:s.employees,profiles:s.employeePayProfiles,
    memberships:s.userOrganizations,cycles:s.performanceCycles,
    templates:s.performanceTemplates,cycleTemplates:s.performanceCycleTemplates,
    reviews:s.performanceReviews,items:s.performanceReviewItems,
    goals:s.performanceGoals,meetings:s.performanceOneOnOnes,
    actionItems:s.performanceOneOnOneActionItems,
    agenda:s.performanceOneOnOneAgendaContributions,
    feedback:s.performanceFeedback,payroll:s.payrollRuns,
    outbox:s.outbox,audit:s.auditEvents,
  };
  const snapshot=async orgId=>{
    const entries=await Promise.all(Object.entries(tables).map(async ([key,table])=>[
      key,await db.select().from(table).where(eq(table.organizationId,orgId))
        .orderBy(asc(table.id)),
    ]));
    const data=Object.fromEntries(entries);
    data.audit=auditBusinessSnapshot(data.audit);
    return data;
  };
  const noChange=(before,after,exclude,label)=>{
    for(const key of Object.keys(before).filter(x=>!exclude.includes(x)))
      assert.deepEqual(after[key],before[key],label+": "+key+" cannot change");
  };

  async function login(e,worker,suffix){
    const name=e.marker+suffix+" fictional self-service worker";
    const [user]=await db.insert(s.users).values({
      email:(e.marker+suffix).toLowerCase()+"@example.invalid",
      name,passwordHash:"fictional-no-password-login",role:"employee",
      employeeId:worker.id,active:true,totpEnabled:true,
    }).returning();
    const [membership]=await db.insert(s.userOrganizations).values({
      userId:user.id,organizationId:e.org.id,workerEmployeeId:worker.id,
      role:"employee",active:true,
    }).returning();
    const session=await http.standaloneMakeSession(user.id);
    await db.update(s.sessions).set({mfaVerifiedAt:new Date()})
      .where(eq(s.sessions.id,session.id));
    return {name,userId:user.id,memberId:membership.id,cookie:session.cookie};
  }

  async function seedProfile(actor){
    const orgId=actor.org.id,employeeId=actor.worker.id,marker=actor.marker;
    const [cycle]=await db.insert(s.performanceCycles).values({
      organizationId:orgId,name:marker+" October QA cycle",
      startDate:"2026-10-01",endDate:"2026-12-31",
      status:"active",requireSelfAssessment:true,createdBy:actor.owner.name,
      createdByUserId:actor.owner.id,
    }).returning();
    const [template]=await db.insert(s.performanceTemplates).values({
      organizationId:orgId,code:(marker+"-competency").slice(0,60),
      name:marker+" fictional competency",type:"competency",defaultWeight:"100",
      createdByUserId:actor.owner.id,
    }).returning();
    const [cycleTemplate]=await db.insert(s.performanceCycleTemplates).values({
      organizationId:orgId,cycleId:cycle.id,templateId:template.id,
      weight:"100",required:true,
    }).returning();
    const [review]=await db.insert(s.performanceReviews).values({
      organizationId:orgId,employeeId,cycleId:cycle.id,
      reviewerUserId:actor.owner.id,status:"draft",
    }).returning();
    const [item]=await db.insert(s.performanceReviewItems).values({
      organizationId:orgId,reviewId:review.id,templateId:template.id,
      required:true,weight:"100",
    }).returning();
    const [goal]=await db.insert(s.performanceGoals).values({
      organizationId:orgId,employeeId,cycleId:cycle.id,
      scope:"employee",title:marker+" confidential objective",
      description:marker+" owned goal",
      createdByUserId:actor.owner.id,
    }).returning();
    const [meeting]=await db.insert(s.performanceOneOnOnes).values({
      organizationId:orgId,employeeId,
      managerUserId:actor.owner.id,scheduledFor:new Date("2026-12-01T09:00:00Z"),
      status:"scheduled",agenda:marker+" shared 1:1 agenda",
      privateManagerNotes:"SECRET-MANAGER-"+marker,
      createdByName:actor.owner.name,createdByUserId:actor.owner.id,
    }).returning();
    const [seedAgenda]=await db.insert(s.performanceOneOnOneAgendaContributions).values({
      organizationId:orgId,oneOnOneId:meeting.id,employeeId,
      authorUserId:actor.self.userId,authorEmployeeId:employeeId,
      authorName:actor.self.name,content:marker+" seeded agenda note",
    }).returning();
    const [sharedAction]=await db.insert(s.performanceOneOnOneActionItems).values({
      organizationId:orgId,oneOnOneId:meeting.id,employeeId,
      ownerKind:"employee",ownerUserId:actor.self.userId,
      ownerEmployeeId:employeeId,ownerName:actor.self.name,
      title:marker+" shared action",dueDate:"2026-12-15",
      visibility:"employee_shared",createdByName:actor.owner.name,
    }).returning();
    await db.insert(s.performanceOneOnOneActionItems).values({
      organizationId:orgId,oneOnOneId:meeting.id,employeeId,
      ownerKind:"manager",ownerUserId:actor.owner.id,
      ownerName:actor.owner.name,title:"PRIVATE-ACTION-"+marker,
      dueDate:"2026-12-15",visibility:"manager_private",
      createdByName:actor.owner.name,
    });
    const [sharedFeedback]=await db.insert(s.performanceFeedback).values({
      organizationId:orgId,employeeId,
      authorUserId:actor.owner.id,authorName:actor.owner.name,
      feedbackType:"general",visibility:"employee_shared",
      content:marker+" shared employer feedback",
    }).returning();
    await db.insert(s.performanceFeedback).values({
      organizationId:orgId,employeeId,
      authorUserId:actor.owner.id,authorName:actor.owner.name,
      feedbackType:"coaching",visibility:"manager_private",
      content:"SECRET-FEEDBACK-"+marker,
    });
    return {marker,cycle,template,cycleTemplate,review,item,goal,meeting,
      seedAgenda,sharedAction,sharedFeedback};
  }

  async function seedEmployer(label){
    const e=await http.seedEmployer(label,nonce,http.standaloneMakeSession);
    e.self=await login(e,e.worker,"-SELF");
    e.profile=await seedProfile(e);
    const peerWorker=await http.addWorker(e,"PEER",{payProfile:false});
    const peer={...e,worker:peerWorker,marker:e.marker+"-PEER"};
    peer.self=await login(e,peerWorker,"-PEER-SELF");
    peer.profile=await seedProfile(peer);
    e.peer=peer;
    return e;
  }
  async function fakeForeignLink(attacker,victim){
    const [user]=await db.insert(s.users).values({
      email:(attacker.marker+"-stolen-id").toLowerCase()+"@example.invalid",
      name:attacker.marker+" stolen employee link",
      passwordHash:"fictional-no-password",role:"employee",
      employeeId:victim.worker.id,
    }).returning();
    // A copied user.employeeId from the victim cannot grant victim membership.
    await db.insert(s.userOrganizations).values({
      userId:user.id,organizationId:attacker.org.id,active:true,role:"employee",
    });
    const session=await http.standaloneMakeSession(user.id);
    return session.cookie;
  }

  const get=(actor,path=ENDPOINT,cookie=actor.self.cookie)=>
    http.standaloneRequest(path,{cookie});
  const request=(actor,method,body,path=ENDPOINT,cookie=actor.self.cookie)=>
    http.standaloneRequest(path,{method,body,cookie});
  let checks=0;
  try{
    for(const [name,table] of [["organizations",s.organizations],
      ["audits",s.auditEvents],["reviews",s.performanceReviews],
      ["payroll",s.payrollRuns]]){
      assert.equal((await db.select().from(table).limit(1)).length,0,
        "PERFORMANCE_TENANT_REFUSED: "+name+" already present in supposed fresh PG16 database");
    }
    // The higher-ID victim is created only AFTER both independent attackers
    // and their same-employer peer employees, meetings and reviews.
    const a=await seedEmployer("ATTA");
    const b=await seedEmployer("ATTB");
    const victim=await seedEmployer("VICTIM");
    const all=[a,b,victim];
    for(const e of [a,b]){
      for(const field of ["org","worker"]){
        assert.ok(victim[field].id>e.peer[field].id,
          "must attack a genuinely persisted higher-ID "+field+" victim");
      }
      for(const field of ["meeting","review","item"]){
        assert.ok(victim.profile[field].id>e.peer.profile[field].id,
          "higher-ID victim "+field+" must be real");
      }
      assert.notEqual(e.self.cookie,victim.self.cookie);
      assert.notEqual(e.self.cookie,e.peer.self.cookie);
    }
    assert.notEqual(a.self.cookie,b.self.cookie,"independent employee logins required");
    const forged=new Map();
    for(const e of [a,b])forged.set(e.org.id,await fakeForeignLink(e,victim));
    const victimBefore=await snapshot(victim.org.id);
    assert.equal(victimBefore.reviews.length,2);
    assert.equal(victimBefore.meetings.length,2);
    assert.equal(victimBefore.payroll.length,0);

    // GET: all 3 employers and two independent peers return their own real
    // nonempty HR data; foreign/private rows are never returned. Forged
    // selectors may not redirect these session-bound GETs.
    for(const e of all){
      const own=await get(e);
      assertOwnRead(own,e,[e.marker+"-PEER","SECRET-MANAGER-"+e.marker,
        "SECRET-FEEDBACK-"+e.marker,"PRIVATE-ACTION-"+e.marker,
        ...all.filter(x=>x!==e).map(x=>x.marker)]);
      checks++;
      const peer=await get(e.peer);
      assertOwnRead(peer,e.peer,["SECRET-MANAGER-"+e.peer.marker,
        "SECRET-FEEDBACK-"+e.peer.marker,"PRIVATE-ACTION-"+e.peer.marker,
        ...all.filter(x=>x!==e).map(x=>x.marker)]);
      checks++;
      const forgedPath=ENDPOINT+"?organizationId="+victim.org.id+
        "&employeeId="+victim.worker.id+"&reviewId="+victim.profile.review.id+
        "&oneOnOneId="+victim.profile.meeting.id;
      const forgedGet=await get(e,forgedPath);
      assertOwnRead(forgedGet,e,[victim.marker,e.marker+"-PEER"]);
      assert.deepEqual(forgedGet.json,own.json,
        "forged URL selectors cannot alter session-bound self-performance GET");
      checks++;
    }
    assertUnchanged(victimBefore,await snapshot(victim.org.id),
      "all genuine and forged GETs leave victim database and audit unchanged");

    // POST and PATCH: both attacker employees must actually write, persist,
    // audit and read back OWN data. A negative-only test earns no method credit.
    for(const actor of [a,b]){
      const other=actor===a?b:a;
      let before=await snapshot(actor.org.id);
      const otherBefore=await snapshot(other.org.id);
      const protectedVictim=await snapshot(victim.org.id);
      const content=actor.marker+" requested a fictional upcoming 1:1 agenda topic";
      const posted=await request(actor,"POST",{
        oneOnOneId:actor.profile.meeting.id,content,
        organizationId:victim.org.id,employeeId:victim.worker.id,
        authorUserId:victim.self.userId,
      });
      const created=assertOwnPost(posted,actor,content);
      assertNoLeak(posted,[victim.marker,actor.marker+"-PEER"]);
      let after=await snapshot(actor.org.id);
      noChange(before,after,["agenda","audit"],actor.label+" own POST");
      assert.equal(after.agenda.length,before.agenda.length+1);
      assert.deepEqual(after.agenda.slice(0,before.agenda.length),before.agenda);
      const saved=after.agenda.find(x=>x.id===created.id);
      assert.ok(saved,"HTTP POST must match actual inserted agenda ID");
      assert.equal(saved.organizationId,actor.org.id);
      assert.equal(saved.employeeId,actor.worker.id);
      assert.equal(saved.oneOnOneId,actor.profile.meeting.id);
      assert.equal(saved.authorUserId,actor.self.userId);
      assert.equal(saved.content,content);
      const event=assertOneAuditAdded(before,after,actor,
        "Employee contributed 1:1 agenda item","oneOnOneId",actor.profile.meeting.id);
      assert.equal(event.metadata.agendaContributionId,created.id);
      assert.equal(event.metadata.employeeId,actor.worker.id);
      assertOwnRead(await get(actor),actor,[victim.marker,actor.marker+"-PEER"],2);
      assertUnchanged(otherBefore,await snapshot(other.org.id),actor.label+" POST other attacker");
      assertUnchanged(protectedVictim,await snapshot(victim.org.id),actor.label+" POST higher-ID victim");
      checks++;

      for(const [round,score,itemScore] of [[1,"4.50","4.00"],[2,"3.50","3.75"]]){
        before=await snapshot(actor.org.id);
        const otherState=await snapshot(other.org.id);
        const victimState=await snapshot(victim.org.id);
        const reflection=actor.marker+" round "+round+" own fictional self-assessment";
        const comment=actor.marker+" round "+round+" competency comment";
        const result=await request(actor,"PATCH",{
          reviewId:actor.profile.review.id,selfScore:Number(score),
          employeeReflection:reflection,items:[{
            id:actor.profile.item.id,selfScore:Number(itemScore),employeeComment:comment,
          }],
          organizationId:victim.org.id,employeeId:victim.worker.id,
          cycleId:victim.profile.cycle.id,
        });
        assertOwnPatch(result,actor,{
          selfScore:score,employeeReflection:reflection,
          itemScore,employeeComment:comment,
        });
        assertNoLeak(result,[victim.marker,actor.marker+"-PEER"]);
        after=await snapshot(actor.org.id);
        noChange(before,after,["reviews","items","audit"],actor.label+" own PATCH "+round);
        assert.equal(after.reviews.length,before.reviews.length);
        assert.equal(after.items.length,before.items.length);
        const updated=after.reviews.find(x=>x.id===actor.profile.review.id);
        const updatedItem=after.items.find(x=>x.id===actor.profile.item.id);
        assert.ok(updated&&updatedItem,"PATCH must update genuine own database rows");
        assert.equal(updated.selfScore,score);
        assert.equal(updated.employeeReflection,reflection);
        assert.equal(updatedItem.selfScore,itemScore);
        assert.equal(updatedItem.employeeComment,comment);
        for(const row of after.reviews.filter(x=>x.id!==updated.id))
          assert.deepEqual(row,before.reviews.find(x=>x.id===row.id),
            "other self/peer review must be immutable");
        for(const row of after.items.filter(x=>x.id!==updatedItem.id))
          assert.deepEqual(row,before.items.find(x=>x.id===row.id),
            "other self/peer competencies must be immutable");
        const audit=assertOneAuditAdded(before,after,actor,
          round===1?"Performance self-assessment submitted":"Performance self-assessment updated",
          "reviewId",actor.profile.review.id);
        assert.equal(audit.metadata.cycleId,actor.profile.cycle.id);
        assert.equal(audit.metadata.selfScore,score);
        assertOwnRead(await get(actor),actor,[victim.marker,actor.marker+"-PEER"],2,score);
        assertUnchanged(otherState,await snapshot(other.org.id),actor.label+" PATCH other attacker");
        assertUnchanged(victimState,await snapshot(victim.org.id),actor.label+" PATCH victim");
        checks++;
      }
    }
    const stable=new Map(await Promise.all(all.map(async e=>[
      e.org.id,await snapshot(e.org.id),
    ])));
    const stableVictim=await snapshot(victim.org.id);
    async function denied(label,method,actor,body,status,markers=[],
      cookie=actor?.self?.cookie){
      const result=await http.standaloneRequest(ENDPOINT,{
        method,body,cookie,
      });
      assertDenied(result,status,markers);
      for(const e of all)assertUnchanged(stable.get(e.org.id),await snapshot(e.org.id),
        label+" cannot mutate "+e.label);
      checks++;
      return result;
    }
    for(const actor of [a,b]){
      const other=actor===a?b:a;
      const mark=[victim.marker,other.marker+"-PEER",actor.marker+"-PEER"];
      for(const [target,label] of [[victim,"victim"],[other,"other employer"],
        [actor.peer,"same-employer coworker"]]){
        await denied(actor.label+" stolen "+label+" POST","POST",actor,{
          oneOnOneId:target.profile.meeting.id,
          organizationId:target.org.id,employeeId:target.worker.id,
          content:"fictional unauthorized meeting content",
        },404,mark);
        await denied(actor.label+" stolen "+label+" PATCH","PATCH",actor,{
          reviewId:target.profile.review.id,selfScore:4,
          employeeReflection:"fictional unauthorized assessment",
          organizationId:target.org.id,employeeId:target.worker.id,
          items:[{id:target.profile.item.id,selfScore:4}],
        },404,mark);
      }
      await denied(actor.label+" own review with stolen victim item","PATCH",actor,{
        reviewId:actor.profile.review.id,selfScore:4,
        employeeReflection:"trying forged review item",
        items:[{id:victim.profile.item.id,selfScore:4}],
      },400,[victim.marker]);
      await denied(actor.label+" invalid item input","PATCH",actor,{
        reviewId:actor.profile.review.id,selfScore:8,
        employeeReflection:"invalid score",items:[],
      },400,[victim.marker]);
      await denied(actor.label+" invalid POST input","POST",actor,{
        oneOnOneId:actor.profile.meeting.id,content:"x",
      },400,[victim.marker]);
      for(const method of ["GET","POST","PATCH"]){
        const ownerBody=method==="POST"
          ?{oneOnOneId:actor.profile.meeting.id,content:"owner not an employee"}
          :method==="PATCH"
            ?{reviewId:actor.profile.review.id,selfScore:4,employeeReflection:"owner not an employee"}
            :undefined;
        await denied(actor.label+" owner role "+method,method,actor,ownerBody,403,
          [victim.marker],actor.cookie);
        await denied(actor.label+" forged victim worker identity "+method,
          method,actor,ownerBody,403,[victim.marker],forged.get(actor.org.id));
      }
    }
    for(const method of ["GET","POST","PATCH"]){
      const body=method==="POST"
        ?{oneOnOneId:victim.profile.meeting.id,content:"unauthenticated agenda"}
        :method==="PATCH"
          ?{reviewId:victim.profile.review.id,selfScore:4,employeeReflection:"unauthenticated"}
          :undefined;
      await denied("anonymous "+method,method,null,body,401,[victim.marker],undefined);
    }

    // Real completed-resource lock paths with unchanged-state snapshots after
    // intentionally switching only our own disposable row into the locked state.
    for(const actor of [a,b]){
      await db.update(s.performanceOneOnOnes).set({status:"completed"})
        .where(eq(s.performanceOneOnOnes.id,actor.profile.meeting.id));
      const locked=await snapshot(actor.org.id);
      const r=await request(actor,"POST",{
        oneOnOneId:actor.profile.meeting.id,content:"locked fictional meeting",
      });
      assertDenied(r,409,[victim.marker]);
      assertUnchanged(locked,await snapshot(actor.org.id),"completed meeting POST");
      await db.update(s.performanceOneOnOnes).set({status:"scheduled"})
        .where(eq(s.performanceOneOnOnes.id,actor.profile.meeting.id));
      await db.update(s.performanceReviews).set({status:"completed"})
        .where(eq(s.performanceReviews.id,actor.profile.review.id));
      const closed=await snapshot(actor.org.id);
      const p=await request(actor,"PATCH",{
        reviewId:actor.profile.review.id,selfScore:4,
        employeeReflection:"locked fictional review",items:[],
      });
      assertDenied(p,409,[victim.marker]);
      assertUnchanged(closed,await snapshot(actor.org.id),"completed review PATCH");
      await db.update(s.performanceReviews).set({status:"draft"})
        .where(eq(s.performanceReviews.id,actor.profile.review.id));
      checks+=2;
    }
    assertUnchanged(stableVictim,await snapshot(victim.org.id),
      "higher-ID victim unaffected by other employers' writes and negative controls");

    // Revoked membership is re-checked on every method, not just at sign-in.
    await db.update(s.userOrganizations).set({active:false})
      .where(eq(s.userOrganizations.id,a.self.memberId));
    const revokedState=new Map(await Promise.all(all.map(async e=>[
      e.org.id,await snapshot(e.org.id),
    ])));
    for(const method of ["GET","POST","PATCH"]){
      const body=method==="POST"
        ?{oneOnOneId:a.profile.meeting.id,content:"revoked fictional employee"}
        :method==="PATCH"
          ?{reviewId:a.profile.review.id,selfScore:4,employeeReflection:"revoked fictional employee"}
          :undefined;
      const r=await http.standaloneRequest(ENDPOINT,{
        method,body,cookie:a.self.cookie,
      });
      assertDenied(r,403,[victim.marker]);
      for(const e of all)assertUnchanged(revokedState.get(e.org.id),await snapshot(e.org.id),
        "revoked membership "+method+" cannot change "+e.label);
      checks++;
    }
    console.log(JSON.stringify({
      proof:"self-performance-three-methods",syntheticPostgresVersion:16,
      methods:METHODS,realOwnGetAndStructuredRead:true,
      realOwnPostWithDbAudit:true,realOwnPatchSubmitAndUpdateWithDbAudit:true,
      independentAttackers:2,higherIdVictim:true,
      sameEmployerPeerDenials:true,crossEmployerDenials:true,
      stolenEmployeeIdDenied:true,forgedSelectorContainment:true,
      privateManagerDataHidden:true,revocationDenied:true,
      discriminatingAssertions:checks,realVictimUnchanged:true,
      coverageCredits:0,status:"PROVISIONAL-REVIEW-REQUIRED",
    }));
  } finally {
    await pool.end();
  }
}
if(process.argv[1]?.replaceAll("\\","/").endsWith("scripts/qa/tenant-self-performance-http.mjs")){
  proveSelfPerformance().catch(error=>{
    console.error("SELF_PERFORMANCE_THREE_METHODS_PROOF_FAILED:",error);
    process.exitCode=1;
  });
}
