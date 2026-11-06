import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {requireDisposableIdentityAccount} from "./tenant-identity-account-proof.mjs";
import {MIGRATION_PROOF_KINDS,migrationProofBody,assertMigrationCommit} from "./migration-method-proof.mjs";

export async function proveMigrationMethod(){
  requireDisposableIdentityAccount();
  assert.equal(process.env.GITHUB_ACTIONS,"true","Dedicated disposable PG16 CI only");
  const [{db,pool},s,orm,shared]=await Promise.all([import("../../src/db/index.ts"),import("../../src/db/schema.ts"),import("drizzle-orm"),import("./tenant-table-http.mjs")]);
  const {eq,asc}=orm;
  assert.equal(Math.floor(Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num)/10000),16);
  assert.equal((await db.select().from(s.organizations).limit(1)).length,0,"Fresh empty CI database required");
  const nonce=randomUUID().slice(0,8),{seedEmployer,standaloneMakeSession,standaloneRequest,addWorker}=shared;
  const a=await seedEmployer("ATTA",nonce,standaloneMakeSession),b=await seedEmployer("ATTB",nonce,standaloneMakeSession);
  // Imports are a Scale-plan feature. Grant ONLY the two fictional owners an
  // offline, provider-less test entitlement; never weaken the real feature gate.
  for(const employer of [a,b]){
    await db.insert(s.subscriptions).values({
      organizationId:employer.org.id,plan:"Scale",status:"active",
      seatLimit:100,amountCents:0,currency:"PHP",
    });
  }
  for(let i=0;i<6;i++)await addWorker(a,"MIGPAD"+i);
  const victim=await seedEmployer("VICTIM",nonce,standaloneMakeSession);
  assert.ok(victim.worker.id>6&&victim.worker.id>Math.max(a.worker.id,b.worker.id),"Real higher-ID victim must exist");
  const plain=x=>JSON.parse(JSON.stringify(x));
  const snapshot=async orgId=>{
    const tables={workers:s.employees,profiles:s.employeePayProfiles,batches:s.importBatches,history:s.historicalPayrollEntries,leave:s.leaveBalances,loans:s.employeeLoans,payroll:s.payrollRuns,audit:s.auditEvents};
    const out={};for(const [key,table] of Object.entries(tables))out[key]=await db.select().from(table).where(eq(table.organizationId,orgId)).orderBy(asc(table.id));
    return plain(out);
  };
  let server,logs="";
  try{
    server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3000"],{env:process.env,stdio:["ignore","pipe","pipe"]});
    for(const stream of [server.stdout,server.stderr])stream.on("data",x=>{logs=(logs+x).slice(-3000);});
    let ready=false;for(let i=0;i<60;i++){
      if(server.exitCode!==null)throw new Error("Isolated Next exited: "+logs);
      try{if((await fetch("http://127.0.0.1:3000/login")).ok){ready=true;break;}}catch{/* startup */}await delay(1000);
    }assert.ok(ready,"Isolated Next unavailable: "+logs);
    const send=(e,body)=>standaloneRequest("/api/migrations",{method:"POST",cookie:e.cookie,body});
    const victimBefore=await snapshot(victim.org.id),positives=new Map();let ownCommits=0,foreignDenials=0,forgedDenials=0,previews=0,multipartPreviews=0;
    for(const e of [a,b]){
      const records=new Map();positives.set(e.org.id,records);
      for(const kind of MIGRATION_PROOF_KINDS){
        const body=migrationProofBody(e,kind);
        // Preview must not be confused with a committed import. Compatibility
        // setup runs before its snapshot; all eight data tables are then fixed.
        const preview=await send(e,{...body,dryRun:true});
        assert.equal(preview.status,200,"real own preview: "+preview.text);assert.equal(preview.json?.dryRun,true);previews++;
        const before=await snapshot(e.org.id);
        const secondPreview=await send(e,{...body,dryRun:true});assert.equal(secondPreview.status,200);
        assert.deepEqual(await snapshot(e.org.id),before,"preview cannot import data or audit");
        const own=await send(e,body);assert.equal(own.status,200,"real own commit: "+own.text);assert.equal(own.json?.dryRun,false);
        const after=await snapshot(e.org.id);assertMigrationCommit(before,after,e,kind);
        records.set(kind,{before,after});ownCommits++;
        assert.deepEqual(await snapshot(victim.org.id),victimBefore,"own commit must preserve victim SQL/audit");
        const beforeDeny=await snapshot(e.org.id);
        const foreign=await send(e,{...body,organizationId:victim.org.id});assert.equal(foreign.status,403);foreignDenials++;
        if(kind!=="employees"){
          const forged=await send(e,migrationProofBody(e,kind,victim.worker.employeeNo));
          assert.equal(forged.status,422,"real victim employee number under own organization: "+forged.text);forgedDenials++;
        }
        assert.deepEqual(await snapshot(e.org.id),beforeDeny,"foreign/forged requests cannot write own data");
        assert.deepEqual(await snapshot(victim.org.id),victimBefore,"foreign/forged requests cannot write victim data");
      }
      const body=migrationProofBody(e,"leave_balances");
      const form=new FormData();for(const key of ["organizationId","source","kind"])form.set(key,String(body[key]));
      form.set("dryRun","true");form.set("file",new Blob([body.csv],{type:"text/csv"}),"fictional.csv");
      const beforeMultipart=await snapshot(e.org.id);
      const response=await fetch("http://127.0.0.1:3000/api/migrations",{method:"POST",headers:{cookie:e.cookie,origin:"http://127.0.0.1:3000","sec-fetch-site":"same-origin"},body:form,redirect:"manual"});
      assert.equal(response.status,200);assert.equal((await response.json()).dryRun,true);multipartPreviews++;
      assert.deepEqual(await snapshot(e.org.id),beforeMultipart,"multipart preview cannot commit");
      const replay=await send(e,migrationProofBody(e,"employees"));assert.equal(replay.status,409,"repeat employee master must remain governed");
      assert.deepEqual(await snapshot(e.org.id),beforeMultipart);assert.deepEqual(await snapshot(victim.org.id),victimBefore);
    }
    for(const e of [a,b])for(const kind of MIGRATION_PROOF_KINDS){
      const other=e===a?b:a,{before,after}=positives.get(other.org.id).get(kind);
      assert.throws(()=>assertMigrationCommit(before,after,e,kind),/accepts another employer's data/);
    }
    assert.deepEqual({ownCommits,foreignDenials,forgedDenials,previews,multipartPreviews},{ownCommits:8,foreignDenials:8,forgedDenials:6,previews:8,multipartPreviews:2});
    console.log(JSON.stringify({kind:"REQUESTED_MIGRATIONS_PG16_HTTP",ownCommits,foreignDenials,forgedDenials,previews,multipartPreviews,discriminationChecks:8,victimSqlAndAuditUnchanged:true,credits:0,providerCalls:0,productionCertified:false}));
  }finally{
    if(server&&server.exitCode===null){server.kill("SIGTERM");await Promise.race([new Promise(resolve=>server.once("exit",resolve)),delay(4000)]);if(server.exitCode===null)server.kill("SIGKILL");}
    await pool.end();
  }
}
if(process.argv[1]?.replaceAll("\\","/").endsWith("tenant-requested-migrations-http.mjs"))proveMigrationMethod().catch(error=>{console.error(error);process.exitCode=1;});
