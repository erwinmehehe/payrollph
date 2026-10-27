/** PR-only provisional invitation POST tenant boundary proof. No delivery or credits. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
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
  };
  for(const [key,value] of Object.entries(required))
    assert.equal(env[key],value,"INVITATIONS_PROOF_REFUSED: "+key);
  for(const key of ["PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY","RESEND_API_KEY","STRIPE_SECRET_KEY"])
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
export function proveUnchanged(before,after,label) {
  assert.deepEqual(after,before,label+" must not mutate invitation, membership, payroll or audit");
}
async function main() {
  requireDisposableInvitations(); // before any dynamic database/app import
  const [{db,pool},s,{eq,asc},http,{auditBusinessSnapshot}]=await Promise.all([
    import("../../src/db/index.ts"),import("../../src/db/schema.ts"),
    import("drizzle-orm"),import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs")
  ]);
  let server;
  const base="http://127.0.0.1:3000";
  try {
    assert.equal((await db.select({id:s.organizations.id}).from(s.organizations).limit(1)).length,0,
      "INVITATIONS_PROOF_REFUSED: empty disposable database required");
    assert.equal((await db.select({id:s.auditEvents.id}).from(s.auditEvents).limit(1)).length,0);
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
      const [invites,members,staff,payroll,audits]=await Promise.all([
        byOrg(s.invitations),byOrg(s.userOrganizations),byOrg(s.employees),
        byOrg(s.payrollRuns),byOrg(s.auditEvents)
      ]);
      return {invites,members,staff,payroll,audits:auditBusinessSnapshot(audits)};
    };
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
    console.log(JSON.stringify({kind:"tenant-invitations-post-boundary-pg16",
      independentAttackers:2,higherIdVictim:true,populatedOwnGets:3,
      foreignGetDenials:2,foreignPostDenials:2,unchangedRealRows:true,
      legitimatePostCreationProved:false,methodFullyCovered:false,coverageCredits:0}));
  } finally {
    if(server&&server.exitCode===null){server.kill("SIGTERM");await Promise.race([
      new Promise(resolve=>server.once("exit",resolve)),sleep(3500)
    ]);if(server.exitCode===null)server.kill("SIGKILL");}
    await pool.end();
  }
}
if(process.argv[1]?.replaceAll("\\","/").endsWith("/tenant-invitations-post-boundary.mjs"))
  main().catch(error=>{console.error(error);process.exitCode=1});
