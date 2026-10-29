/** Invitation POST isolation: localhost SMTP only, no real delivery or method credits. */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {spawn} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";

export function requireDisposableInvitations(env=process.env) {
  const required={
    GITHUB_ACTIONS:"true",CI:"true",NODE_ENV:"production",
    TENANT_SECOND_PASS_MODE:"isolated-ci-only",
    DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL:"http://127.0.0.1:3000",
    WORKER_ENABLED:"false",CENTRAL_SCHEDULER_ENABLED:"false",
    PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false",
    XENDIT_BILLING_ENABLED:"false",DEMO_MODE:"false",
    SMTP_URL:"smtp://127.0.0.1:2525",
    MAIL_FROM:"PayrollPH QA <no-reply@example.invalid>",
  };
  for(const [key,value] of Object.entries(required))
    assert.equal(env[key],value,"INVITATIONS_PROOF_REFUSED: "+key);
  for(const key of ["PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY","RESEND_API_KEY","POSTMARK_SERVER_TOKEN","STRIPE_SECRET_KEY"])
    assert.ok(!env[key],"INVITATIONS_PROOF_REFUSED: external credentials "+key);
}
export function proveOwnInvitationRead(response,employer) {
  assert.equal(response.status,200);
  assert.equal(response.json?.invitations?.length,1,"populated own invitation mandatory");
  const row=response.json.invitations[0];
  assert.equal(row.id,employer.invitationId);
  assert.equal(row.email,employer.email);
  assert.equal(row.invitedBy,employer.owner.name);
  assert.equal(row.accepted,false);
  assert.ok(Array.isArray(response.json.members));
  assert.ok(response.json.members.some(x=>x.email===employer.owner.email));
}

/** A real localhost SMTP sink; never connects to an external mail service. */
export async function startLocalSmtpSink() {
  const captured=[], sockets=new Set();
  const server=createServer(socket=>{
    sockets.add(socket);
    socket.setTimeout(15000,()=>socket.destroy());
    socket.on("error",()=>{});
    socket.on("close",()=>sockets.delete(socket));
    socket.write("220 payrollph.local ESMTP fictional-only\r\n");
    let buffered="",recipient=null,mail=[],inData=false;
    const send=line=>socket.write(line+"\r\n");
    socket.on("data",chunk=>{
      buffered+=chunk.toString("utf8");
      if(buffered.length>262144){socket.destroy();return;}
      let i;
      while((i=buffered.indexOf("\n"))>=0){
        const line=buffered.slice(0,i).replace(/\r$/,"");
        buffered=buffered.slice(i+1);
        if(inData){
          if(line==="."){
            inData=false;
            captured.push({recipient,raw:mail.join("\n")});
            mail=[];
            send("250 2.0.0 Accepted by fictional localhost SMTP sink");
          }else{
            mail.push(line.startsWith("..")?line.slice(1):line);
            if(mail.length>1500)socket.destroy();
          }
          continue;
        }
        if(/^(EHLO|HELO)\s/i.test(line))send("250-payrollph.local\r\n250 8BITMIME");
        else if(/^MAIL FROM:/i.test(line)){recipient=null;send("250 2.1.0 OK");}
        else if(/^RCPT TO:/i.test(line)){
          const match=line.match(/^RCPT TO:\s*<([^>]+)>/i);
          if(!match||!/@example\.invalid$/i.test(match[1]))
            send("550 5.7.1 Only fictional example.invalid recipients allowed");
          else{recipient=match[1].toLowerCase();send("250 2.1.5 OK");}
        }
        else if(/^DATA$/i.test(line)){
          if(!recipient)send("503 5.5.1 Fictional recipient required");
          else{inData=true;mail=[];send("354 End message with <CRLF>.<CRLF>");}
        }
        else if(/^RSET$/i.test(line)){recipient=null;mail=[];inData=false;send("250 reset");}
        else if(/^NOOP$/i.test(line))send("250 OK");
        else if(/^QUIT$/i.test(line)){send("221 goodbye");socket.end();}
        else send("502 command unavailable in fictional SMTP sink");
      }
    });
  });
  await new Promise((resolve,reject)=>{
    const fail=e=>reject(e);
    server.once("error",fail);
    server.listen(2525,"127.0.0.1",()=>{server.off("error",fail);resolve();});
  });
  return {captured,close:async()=>{
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(resolve));
  }};
}

export function proveOwnInvitationPost(response,employer,saved,mail,outbox,audits) {
  assert.equal(response.status,201,"authorized owner must create a real invitation");
  assert.ok(response.json&&typeof response.json==="object");
  const createdEmail=(employer.marker+"-foreign@example.invalid").toLowerCase();
  assert.equal(response.json.id,saved.id);
  assert.equal(response.json.email,createdEmail);
  assert.equal(response.json.role,"employee");
  assert.equal(saved.organizationId,employer.org.id);
  assert.equal(saved.orgUnitId,employer.unit.id);
  assert.equal(saved.invitedBy,employer.owner.name);
  assert.equal(saved.email,createdEmail);
  assert.equal(saved.role,"employee");
  assert.equal(saved.acceptedAt,null);
  assert.ok(saved.expiresAt.getTime()>Date.now());
  assert.match(saved.tokenHash,/^[a-f0-9]{64}$/);
  assert.equal(response.json.inviteToken,undefined,"production must not echo a bearer invitation token");
  assert.deepEqual({configured:response.json.delivery?.configured,
    delivered:response.json.delivery?.delivered,queued:response.json.delivery?.queued,
    provider:response.json.delivery?.provider},
    {configured:true,delivered:true,queued:false,provider:"smtp"},
    "real localhost SMTP delivery must be acknowledged, not only queued");
  assert.equal(mail?.recipient,createdEmail,"SMTP recipient must be own fictional worker");
  // Nodemailer may use quoted-printable and soft-wrapped body text.
  const normalized=(mail?.raw??"").replace(/=\r?\n/g,"").replace(/=3D/gi,"=");
  const match=normalized.match(/https:\/\/payroll\.example\.test\/invite\?token=([A-Za-z0-9_-]{20,})/);
  assert.ok(match,"real SMTP invitation must contain a synthetic one-use link");
  assert.equal(createHash("sha256").update(match[1]).digest("hex"),saved.tokenHash,
    "SMTP invite token must match the actual persisted one-use hash");
  assert.equal(outbox?.organizationId,employer.org.id);
  assert.equal(outbox?.recipient,createdEmail);
  assert.equal(outbox?.purpose,"invitation");
  assert.equal(outbox?.status,"sent");
  assert.equal(outbox?.deliveryStatus,"accepted");
  assert.equal(outbox?.provider,"smtp");
  assert.ok(outbox?.sentAt,"local delivery must be persisted");
  assert.ok(!outbox?.body?.includes(match[1]),"one-use invitation token must be redacted from outbox after sending");
  const matching=audits.filter(x=>x.action==="Invitation created"&&x.resource===createdEmail);
  assert.equal(matching.length,1,"exactly one employer-scoped invitation-created audit");
  assert.equal(matching[0].organizationId,employer.org.id);
  assert.equal(matching[0].actor,employer.owner.name);
  assert.equal(matching[0].metadata?.role,"employee");
  assert.equal(matching[0].metadata?.deliveryConfigured,true);
  assert.equal(matching[0].metadata?.delivered,true);
  return true;
}

export function proveUnchanged(before,after,label) {
  assert.deepEqual(after,before,label+" must not mutate invitation, membership, people, pay, payroll, outbox or audit");
}
async function main() {
  requireDisposableInvitations(); // before any dynamic database/app import
  const [{db,pool},s,{eq,asc},http,{auditBusinessSnapshot}]=await Promise.all([
    import("../../src/db/index.ts"),import("../../src/db/schema.ts"),
    import("drizzle-orm"),import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs")
  ]);
  let server,smtp;
  const base="http://127.0.0.1:3000";
  try {
    assert.equal((await db.select({id:s.organizations.id}).from(s.organizations).limit(1)).length,0,
      "INVITATIONS_PROOF_REFUSED: empty disposable database required");
    for(const [name,table] of [["audits",s.auditEvents],["invitations",s.invitations],
      ["outbox",s.outbox],["payroll",s.payrollRuns],["membership",s.userOrganizations]]){
      assert.equal((await db.select().from(table).limit(1)).length,0,
        "INVITATIONS_PROOF_REFUSED: fresh database required for "+name);
    }
    const nonce=randomUUID().replaceAll("-","").slice(0,10);
    const employers=[];
    for(const label of ["ATTA","ATTB","VICTIM"]) {
      const e=await http.seedEmployer(label,nonce,http.standaloneMakeSession);
      e.email=(e.marker+"-invite@example.invalid").toLowerCase();
      const [invitation]=await db.insert(s.invitations).values({
        organizationId:e.org.id,email:e.email,role:"employee",
        tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),
        invitedBy:e.owner.name,expiresAt:new Date(Date.now()+86400000)
      }).returning();
      e.invitationId=invitation.id;
      employers.push(e);
    }
    const [a,b,victim]=employers;
    for(const attacker of [a,b])
      assert.ok(victim.org.id>attacker.org.id && victim.invitationId>attacker.invitationId,
        "real higher-ID victim required");
    const snapshot=async orgId=>{
      const byOrg=t=>db.select().from(t).where(eq(t.organizationId,orgId)).orderBy(asc(t.id));
      const [invites,members,staff,profiles,payroll,entries,outbox,audits]=await Promise.all([
        byOrg(s.invitations),byOrg(s.userOrganizations),byOrg(s.employees),
        byOrg(s.employeePayProfiles),byOrg(s.payrollRuns),
        db.select({entry:s.payrollEntries}).from(s.payrollEntries)
          .innerJoin(s.payrollRuns,eq(s.payrollEntries.payrollRunId,s.payrollRuns.id))
          .where(eq(s.payrollRuns.organizationId,orgId)).orderBy(asc(s.payrollEntries.id)),
        byOrg(s.outbox),byOrg(s.auditEvents)
      ]);
      return {invites,members,staff,profiles,payroll,entries,outbox,audits:auditBusinessSnapshot(audits)};
    };
    smtp=await startLocalSmtpSink();
    let log="";
    server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3000"],
      {stdio:["ignore","pipe","pipe"]});
    const append=x=>{log=(log+String(x)).slice(-1500)};
    server.stdout.on("data",append);server.stderr.on("data",append);
    let started=false;
    for(let i=0;i<65;i++){
      if(server.exitCode!==null)throw Error("Next terminated: "+log);
      try {const r=await fetch(base+"/login");if(r.ok){started=true;break;}}catch{}
      await sleep(1000);
    }
    assert.ok(started,"localhost Next did not start: "+log);
    const call=(actor,target,method="GET")=>http.standaloneRequest(
      "/api/invitations"+(method==="GET"?"?organizationId="+target.org.id:""),
      {method,cookie:actor.cookie,body:method==="POST"?{
        organizationId:target.org.id,email:actor.marker.toLowerCase()+"-foreign@example.invalid",
        role:"employee",orgUnitId:target.unit.id
      }:undefined});
    const before=await Promise.all(employers.map(e=>snapshot(e.org.id)));
    let first;
    for(const actor of employers) {
      const own=await call(actor,actor);
      proveOwnInvitationRead(own,actor);
      if(actor!==victim)assert.ok(!own.text.includes(victim.marker));
      if(first && actor===b)assert.throws(()=>proveOwnInvitationRead(first,actor),
        "other employer's real 200 cannot pass own positive");
      first??=own;
    }
    let forbidden=0;
    for(const attacker of [a,b]) {
      const get=await call(attacker,victim);
      assert.equal(get.status,403,"real foreign invitation GET denied");
      assert.ok(!get.text.includes(victim.marker));
      const post=await call(attacker,victim,"POST");
      assert.equal(post.status,403,"real foreign invitation POST denied");
      assert.ok(!post.text.includes(victim.marker));
      forbidden+=2;
      for(let i=0;i<employers.length;i++)
        proveUnchanged(before[i],await snapshot(employers[i].org.id),
          attacker.label+" cannot change "+employers[i].label);
    }
    assert.equal(forbidden,4);

    // A signed-in owner cannot bind a real foreign unit to an owned employer's invitation.
    const forgedUnit=await http.standaloneRequest("/api/invitations",{
      method:"POST",cookie:a.cookie,body:{
        organizationId:a.org.id,email:(a.marker+"-wrong-unit@example.invalid").toLowerCase(),
        role:"employee",orgUnitId:victim.unit.id
      }
    });
    assert.equal(forgedUnit.status,404,"foreign persisted unit must be invisible under own employer");
    assert.ok(!forgedUnit.text.includes(victim.marker));
    for(let i=0;i<employers.length;i++)
      proveUnchanged(before[i],await snapshot(employers[i].org.id),
        "forged foreign org unit cannot change "+employers[i].label);

    // Distinct attackers must ALSO create actual own invitations, with a
    // persisted token hash, outbox delivery through localhost SMTP and audit.
    // A denied POST alone is never evidence that the authorized POST works.
    for(const owner of [a,b]){
      const peersBefore=new Map(await Promise.all(employers.map(async e=>
        [e.org.id,await snapshot(e.org.id)])));
      const ownBefore=peersBefore.get(owner.org.id);
      const realPost=await call(owner,owner,"POST");
      assert.equal(realPost.status,201,"actual own invitation POST must succeed");
      assert.ok(Number.isSafeInteger(realPost.json?.id)&&realPost.json.id>0,
        "own 201 must return the real persisted invitation ID");
      const [saved]=await db.select().from(s.invitations)
        .where(eq(s.invitations.id,realPost.json?.id)).limit(1);
      const email=(owner.marker+"-foreign@example.invalid").toLowerCase();
      const ownAfter=await snapshot(owner.org.id);
      const sent=ownAfter.outbox.filter(x=>x.recipient===email);
      assert.equal(sent.length,1,"exactly one own delivery outbox entry");
      const mail=smtp.captured.filter(x=>x.recipient===email);
      assert.equal(mail.length,1,"exactly one actual local SMTP delivery");
      proveOwnInvitationPost(realPost,owner,saved,mail[0],sent[0],ownAfter.audits);
      assert.equal(ownAfter.invites.length,ownBefore.invites.length+1,
        "authorized POST must insert one persisted invitation");
      assert.equal(ownAfter.outbox.length,ownBefore.outbox.length+1,
        "authorized POST must insert one persisted outbox record");
      assert.equal(ownAfter.audits.length,ownBefore.audits.length+1,
        "authorized POST must write exactly one actor-bound audit event");
      for(const key of ["members","staff","profiles","payroll","entries"])
        assert.deepEqual(ownAfter[key],ownBefore[key],key+" must not move on invitation creation");
      for(const other of employers.filter(e=>e!==owner))
        proveUnchanged(peersBefore.get(other.org.id),await snapshot(other.org.id),
          "foreign source must not change after "+owner.label+" authorized POST");

      const duplicate=await call(owner,owner,"POST");
      assert.equal(duplicate.status,409,"replaying an active invitation must not duplicate it");
      assert.ok(!duplicate.text.includes(victim.marker));
      proveUnchanged(ownAfter,await snapshot(owner.org.id),
        "duplicate POST must not create an invitation, outbox or audit");
    }

    // Unit-level tenant isolation: a real session with a COMPANY-restricted
    // admin grant must not see sibling/global members or issue privileged
    // company-wide invitations. The owner cases above prove that global
    // administration still works.
    const [siblingUnit]=await db.insert(s.orgUnits).values({
      organizationId:a.org.id,legalEntityId:a.entity.id,type:"department",
      code:a.marker+"-B",name:a.marker+" sibling department",
    }).returning();
    const siblingEmail=(a.marker+"-sibling-member@example.invalid").toLowerCase();
    const [siblingUser]=await db.insert(s.users).values({
      name:a.marker+" sibling member",email:siblingEmail,
      passwordHash:"fictional-session-only",role:"employee",totpEnabled:true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId:siblingUser.id,organizationId:a.org.id,orgUnitId:siblingUnit.id,
      role:"employee",active:true,
    });
    const [siblingInvite]=await db.insert(s.invitations).values({
      organizationId:a.org.id,orgUnitId:siblingUnit.id,
      email:(a.marker+"-sibling-invite@example.invalid").toLowerCase(),
      role:"employee",tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),
      invitedBy:a.owner.name,expiresAt:new Date(Date.now()+86400000),
    }).returning();
    const [unitAdmin]=await db.insert(s.users).values({
      name:a.marker+" unit admin",
      email:(a.marker+"-unit-admin@example.invalid").toLowerCase(),
      passwordHash:"fictional-session-only",role:"admin",totpEnabled:true,
    }).returning();
    const [unitGrant]=await db.insert(s.userOrganizations).values({
      userId:unitAdmin.id,organizationId:a.org.id,orgUnitId:a.unit.id,
      role:"admin",active:true,
    }).returning();
    const unitSession=await http.standaloneMakeSession(unitAdmin.id);
    await db.update(s.sessions).set({mfaVerifiedAt:new Date()})
      .where(eq(s.sessions.id,unitSession.id));
    const unitCookie=unitSession.cookie;
    const unitRead=await http.standaloneRequest(
      "/api/invitations?organizationId="+a.org.id,{cookie:unitCookie});
    assert.equal(unitRead.status,200,"active unit administrator can list same-unit invitations");
    assert.ok(unitRead.json?.invitations?.some(row=>row.email===
      (a.marker+"-foreign@example.invalid").toLowerCase()),
      "real own-unit invitation must be returned");
    assert.ok(unitRead.json.invitations.every(row=>
      row.id!==a.invitationId&&row.id!==siblingInvite.id),
      "company-wide and sibling-unit invitations must remain private");
    assert.ok(unitRead.json.members.some(row=>row.id===unitAdmin.id),
      "real same-unit account must remain visible");
    assert.ok(unitRead.json.members.every(row=>row.orgUnitId===a.unit.id),
      "no sibling-unit or company-wide member names, emails or roles can leak");
    assert.ok(!unitRead.text.includes(siblingEmail));
    assert.ok(!unitRead.text.includes(a.owner.email));
    assert.ok(!unitRead.text.includes(victim.marker));
    assert.ok(unitRead.headers.get("cache-control")?.includes("no-store"));

    const unitBefore=await Promise.all(employers.map(e=>snapshot(e.org.id)));
    const unitDeniedCases=[
      {label:"company-wide employee",role:"employee",unit:null,status:403},
      {label:"missing unit employee",role:"employee",status:403},
      {label:"sibling-unit employee",role:"employee",unit:siblingUnit.id,status:403},
      {label:"foreign-employer unit",role:"employee",unit:victim.unit.id,status:403},
      {label:"unit admin invitation",role:"admin",unit:a.unit.id,status:403},
      {label:"unit owner invitation",role:"owner",unit:a.unit.id,status:403},
      {label:"unit bookkeeper invitation",role:"bookkeeper",unit:a.unit.id,status:403},
      {label:"noncanonical unit",role:"employee",unit:String(a.unit.id).padStart(2,"0"),status:422},
    ];
    for(const [index,bad] of unitDeniedCases.entries()){
      const body={
        organizationId:a.org.id,
        email:(a.marker+"-unit-denied-"+index+"@example.invalid").toLowerCase(),
        role:bad.role,
      };
      if("unit" in bad)body.orgUnitId=bad.unit;
      const response=await http.standaloneRequest("/api/invitations",{
        method:"POST",cookie:unitCookie,body,
      });
      assert.equal(response.status,bad.status,bad.label+" denied before issuance");
      assert.ok(!response.text.includes(siblingEmail));
      assert.ok(!response.text.includes(victim.marker));
      for(let i=0;i<employers.length;i++)
        proveUnchanged(unitBefore[i],await snapshot(employers[i].org.id),
          bad.label+" must not change "+employers[i].label);
    }
    const unitVictimGet=await http.standaloneRequest(
      "/api/invitations?organizationId="+victim.org.id,{cookie:unitCookie});
    assert.equal(unitVictimGet.status,403,"unit administrator cannot read foreign employer");
    const unitVictimPost=await http.standaloneRequest("/api/invitations",{
      method:"POST",cookie:unitCookie,body:{
        organizationId:victim.org.id,role:"employee",orgUnitId:victim.unit.id,
        email:(a.marker+"-unit-cross-tenant@example.invalid").toLowerCase(),
      },
    });
    assert.equal(unitVictimPost.status,403,"unit admin cannot issue foreign employer invitation");
    for(let i=0;i<employers.length;i++)
      proveUnchanged(unitBefore[i],await snapshot(employers[i].org.id),
        "cross-tenant unit attempts preserve "+employers[i].label);

    // A legitimate same-unit employee invitation still creates exactly one
    // persisted invitation, one localhost-only mail and matching audit/outbox.
    const ownUnitEmail=(a.marker+"-unit-allowed@example.invalid").toLowerCase();
    const unitPositive=await http.standaloneRequest("/api/invitations",{
      method:"POST",cookie:unitCookie,body:{
        organizationId:a.org.id,role:"employee",orgUnitId:a.unit.id,
        email:ownUnitEmail,
      },
    });
    assert.equal(unitPositive.status,201,"same-unit employee invitation succeeds");
    const [unitSaved]=await db.select().from(s.invitations)
      .where(eq(s.invitations.id,unitPositive.json?.id)).limit(1);
    assert.equal(unitSaved?.organizationId,a.org.id);
    assert.equal(unitSaved?.orgUnitId,a.unit.id);
    assert.equal(unitSaved?.role,"employee");
    assert.equal(unitSaved?.invitedBy,unitAdmin.name);
    assert.equal(unitSaved?.email,ownUnitEmail);
    const unitAfter=await snapshot(a.org.id);
    assert.equal(unitAfter.invites.length,unitBefore[0].invites.length+1);
    assert.equal(unitAfter.audits.length,unitBefore[0].audits.length+1);
    assert.equal(unitAfter.outbox.length,unitBefore[0].outbox.length+1);
    assert.ok(unitAfter.audits.some(row=>row.action==="Invitation created"&&
      row.resource===ownUnitEmail&&row.actor===unitAdmin.name));
    assert.ok(unitAfter.outbox.some(row=>row.recipient===ownUnitEmail&&
      row.status==="sent"&&row.provider==="smtp"));
    assert.equal(smtp.captured.filter(mail=>mail.recipient===ownUnitEmail).length,1);
    for(const other of [b,victim])
      proveUnchanged(unitBefore[employers.indexOf(other)],await snapshot(other.org.id),
        "same-unit success must not touch another employer");

    // Revocation of the actual active grant must deny the SAME live session;
    // no stale unit scope may survive via an old cookie.
    await db.update(s.userOrganizations).set({active:false})
      .where(eq(s.userOrganizations.id,unitGrant.id));
    const revokedBefore=await Promise.all(employers.map(e=>snapshot(e.org.id)));
    assert.equal((await http.standaloneRequest(
      "/api/invitations?organizationId="+a.org.id,{cookie:unitCookie})).status,403,
      "revoked unit administrator cannot list invites");
    assert.equal((await http.standaloneRequest("/api/invitations",{
      method:"POST",cookie:unitCookie,body:{
        organizationId:a.org.id,role:"employee",orgUnitId:a.unit.id,
        email:(a.marker+"-revoked-unit@example.invalid").toLowerCase(),
      },
    })).status,403,"revoked unit administrator cannot issue invites");
    for(let i=0;i<employers.length;i++)
      proveUnchanged(revokedBefore[i],await snapshot(employers[i].org.id),
        "revoked same-session requests preserve "+employers[i].label);

    proveUnchanged(before[2],await snapshot(victim.org.id),
      "higher-ID victim unchanged after all authorized and denied attacker requests");

    console.log(JSON.stringify({kind:"tenant-invitations-post-boundary-pg16",
      independentAttackers:2,higherIdVictim:true,populatedOwnGets:3,
      foreignGetDenials:2,foreignPostDenials:2,forgedUnitDenied:true,
      legitimatePostCreationProved:true,ownOutboxAndAuditVerified:true,
      localSmtpDelivered:3,victimUnchanged:true,
      unitAdminOwnGetScoped:true,unitAdminSameUnitEmployeePost:true,
      unitAdminPrivilegeDenials:8,siblingAndGlobalHidden:true,
      foreignEmployerUnitDenials:2,sameSessionRevocationDenied:true,
      methodFullyCovered:false,coverageCredits:0}));
  } finally {
    if(server&&server.exitCode===null){server.kill("SIGTERM");await Promise.race([
      new Promise(resolve=>server.once("exit",resolve)),sleep(3500)
    ]);if(server.exitCode===null)server.kill("SIGKILL");}
    if(smtp)await smtp.close();
    await pool.end();
  }
}
if(process.argv[1]?.replaceAll("\\","/").endsWith("/tenant-invitations-post-boundary.mjs"))
  main().catch(error=>{console.error(error);process.exitCode=1});
