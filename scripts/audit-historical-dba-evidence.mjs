#!/usr/bin/env node
/**
 * DBA-safe historical schema inventory, NOT a production migration.
 *
 * --inventory: exact bytes SHA-256 source only, no DB credentials.
 * --verify: GitHub manual protected action only, catalog-only DB role,
 *            exact reviewed main SHA and original Neon endpoint.
 */
import { inventoryMigrationSources } from "./lib/migration-receipt-audit.mjs";
import {
  HISTORICAL_GROUPS,PINNED_NEON,inspectReadOnlyHistoricalEvidence,
} from "./lib/historical-dba-evidence.mjs";

const mode=process.argv[2];
const manifest=inventoryMigrationSources();
function halt(code){
 console.error("P0_4_HISTORICAL_AUDIT_"+code);
 process.exitCode=1;
}

if(mode==="--inventory" && process.argv.length===3){
 const files=new Map(manifest.files.map(f=>[f.path,f]));
 console.log(JSON.stringify({
   kind:"p0-4-historical-git-source-only",
   manifestSha256:manifest.digest,
   files:HISTORICAL_GROUPS.map(g=>{
      const f=files.get(g.source);
      if(!f)throw Error("HISTORICAL_FILE_MISSING");
      return {path:f.path,sha256:f.sha256};
   }),
   databaseConnected:false,
   historicalApplicationProven:false,
   productionMigrationAuthorized:false,
 },null,2));
}else if(mode==="--verify" && process.argv.length===3){
 verify().catch(()=>halt("DENIED_OR_UNVERIFIED"));
}else{
 halt("INVALID_MODE");
}

async function verify(){
 const e=process.env;
 const validSha=/^[a-f0-9]{40}$/;
 const actors=e.P0_4_AUDIT_ALLOWED_ACTORS??"";
 if(e.GITHUB_ACTIONS!=="true" ||
    e.GITHUB_EVENT_NAME!=="workflow_dispatch" ||
    e.GITHUB_REPOSITORY!=="erwinmehehe/payrollph" ||
    e.GITHUB_REF!=="refs/heads/main" ||
    !validSha.test(e.GITHUB_SHA??"") ||
    e.REVIEWED_SHA!==e.GITHUB_SHA ||
    e.P0_4_AUDIT_ENVIRONMENT!=="production" ||
    !/^[A-Za-z0-9][A-Za-z0-9,-]{0,255}$/.test(actors) ||
    !actors.split(",").includes(e.GITHUB_ACTOR) ||
    e.EXPECTED_PRODUCTION_NEON_PROJECT_ID!==PINNED_NEON.projectId ||
    e.EXPECTED_PRODUCTION_NEON_BRANCH_ID!==PINNED_NEON.branchId ||
    e.EXPECTED_PRODUCTION_NEON_ENDPOINT_ID!==PINNED_NEON.endpointId ||
    e.EXPECTED_PRODUCTION_DATABASE_NAME!==PINNED_NEON.database ||
    !/^P0-4-[A-Za-z0-9-]{8,100}$/.test(e.P0_4_AUDIT_CHANGE_REF??"")) {
    throw Error("HISTORICAL_UNREVIEWED_REQUEST");
 }
 let target;
 try{target=new URL(e.PRODUCTION_MIGRATION_AUDIT_DATABASE_URL);}
 catch{throw Error("HISTORICAL_URL_MISSING");}
 if(!["postgres:","postgresql:"].includes(target.protocol) ||
    target.hostname!==PINNED_NEON.host ||
    !["","5432"].includes(target.port) ||
    target.pathname!=="/"+PINNED_NEON.database ||
    target.searchParams.get("sslmode")!=="verify-full" ||
    !target.username || !target.password ||
    target.hash) {
   throw Error("HISTORICAL_TARGET_NOT_PINNED");
 }
 const {default:pg}=await import("pg");
 const client=new pg.Client({
   connectionString:e.PRODUCTION_MIGRATION_AUDIT_DATABASE_URL,
   connectionTimeoutMillis:6000,query_timeout:8000,
   ssl:{rejectUnauthorized:true},
 });
 let connected=false;
 try{
  await client.connect();connected=true;
  const report=await inspectReadOnlyHistoricalEvidence({
    client,inventory:manifest,capturedAt:new Date().toISOString(),
  });
  // Only public schema object identities + Git SHA digests. No row values.
  console.log(JSON.stringify({...report,reviewedGitSha:e.GITHUB_SHA,
    receiptDispositionCount:0,dbaAttestationEstablished:false},null,2));
 }finally{
  if(connected)await client.end().catch(()=>{});
 }
}
