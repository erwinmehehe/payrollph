import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {PHASE15_DATABASE,PHASE15_OFF,requirePhase15Environment,requirePhase15Database} from "../scripts/qa/golden-phase15-safety";
import {phase15Centavos,phase15CutoffFailures} from "../scripts/qa/golden-phase15-observations";

const local=()=>({GOLDEN_PHASE15_DISPOSABLE:"local-disposable-pg16-only",
  GOLDEN_PHASE15_LOCAL_CONFIRM:"fresh-empty-fictional-database",DATABASE_URL:PHASE15_DATABASE,
  ...Object.fromEntries(PHASE15_OFF.map(k=>[k,"false"]))});
const state={version:160016,employers:0,database:"app_db",serverAddress:"127.0.0.1",clientAddress:"127.0.0.1"};

test("truthful explicit local mode and the existing disposable CI mode retain separate guards",()=>{
 assert.equal(requirePhase15Environment(local()),"local-disposable-pg16-only");
 const ci={...local(),GOLDEN_PHASE15_DISPOSABLE:"github-actions-pg16-only",CI:"true",GITHUB_ACTIONS:"true"};
 assert.equal(requirePhase15Environment(ci),"github-actions-pg16-only");
 for(const change of [{GOLDEN_PHASE15_LOCAL_CONFIRM:""},{CI:"true"},{GITHUB_ACTIONS:"true"},
   {GOLDEN_PHASE15_DISPOSABLE:""},{VERCEL:"1"},{VERCEL_ENV:"preview"},{NEON_DATABASE_URL:"remote"},
   {RESEND_API_KEY:"forbidden-test-marker"},{SMTP_URL:"smtp://127.0.0.1"},
   {EXACT_THIRTEENTH_CENTAVOS_ENABLED:"true"},{FINAL_PAY_SIGNED_REVIEW_ENABLED:"true"}])
   assert.throws(()=>requirePhase15Environment({...local(),...change}),/PHASE15_REFUSED/);
 for(const key of PHASE15_OFF)assert.throws(()=>requirePhase15Environment({...local(),[key]:"true"}),/PHASE15_REFUSED/);
 for(const url of [PHASE15_DATABASE.replace("127.0.0.1","db.example.invalid"),
   PHASE15_DATABASE.replace("app_db","postgres"),PHASE15_DATABASE+"?host=db.example.invalid",
   PHASE15_DATABASE.replace("127.0.0.1","localhost")])
   assert.throws(()=>requirePhase15Environment({...local(),DATABASE_URL:url}),/PHASE15_REFUSED/);
});

test("local server identity refuses tunnels, other PostgreSQL majors and populated databases",()=>{
 assert.doesNotThrow(()=>requirePhase15Database(state,"local-disposable-pg16-only"));
 for(const change of [{version:180000},{employers:1},{database:"shared"},
   {serverAddress:"10.0.0.8"},{clientAddress:"10.0.0.9"},{serverAddress:null}])
   assert.throws(()=>requirePhase15Database({...state,...change},"local-disposable-pg16-only"),/PHASE15_REFUSED/);
 // Docker service address is permitted only in the explicitly existing CI mode.
 assert.doesNotThrow(()=>requirePhase15Database({...state,serverAddress:"172.18.0.2"},"github-actions-pg16-only"));
});

test("unsafe harness targets are refused before the application pool or engine is imported",()=>{
 const result=spawnSync(process.execPath,["--import","tsx","scripts/golden-payroll-phase15.ts"],{
   encoding:"utf8",timeout:15000,env:{...process.env,...local(),CI:"",GITHUB_ACTIONS:"",DATABASE_URL:"postgresql://fictional:must-not-be-logged@db.example.invalid/shared"},
 });
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/PHASE15_REFUSED: exact local disposable database required/);
 assert.doesNotMatch(result.stderr,/getaddrinfo|ENOTFOUND|ECONNREFUSED/);
 assert.doesNotMatch(result.stderr,/must-not-be-logged|db.example.invalid/);
});

test("local bootstrap validates the target before SQL and pins only the reviewed baseline",()=>{
 const source=readFileSync("scripts/qa/golden-phase15-local-bootstrap.ts","utf8");
 assert.ok(source.indexOf("requirePhase15Environment(process.env)")<source.indexOf('await import("pg")'));
 assert.ok(source.indexOf("requirePhase15Database({...identity,employers},mode)")<source.indexOf("const push=spawnSync"));
 assert.ok(source.includes('createHash("sha256")'));
 assert.doesNotMatch(source,/DROP DATABASE|ALTER DATABASE|GITHUB_ACTIONS\s*=/i);
});

test("oracle rejects a one-cent or fractional-cent change and the former A cutoff-21 withholding",()=>{
 const spec={withholdingEachCutoff:484.95,withholdingOverrides:{"21":1434.10,"22":1834.10},
   status:"Exception",noBreakdownFlagFrom:null,poolFlagFrom:13};
 const seen={withholding:1434.10,status:"Exception",noBreakdownFlag:false,poolFlag:true,flags:["pool review"]};
 assert.deepEqual(phase15CutoffFailures("A",spec,21,seen),[]);
 for(const amount of [1434.09,1434.11,484.95])assert.ok(phase15CutoffFailures("A",spec,21,{...seen,withholding:amount}).length);
 assert.throws(()=>phase15Centavos(1434.101,"A"),/exact centavos/);
 for(const change of [{status:"Ready"},{poolFlag:false},{noBreakdownFlag:true}])
   assert.ok(phase15CutoffFailures("A",spec,21,{...seen,...change}).length);
 const control={withholdingEachCutoff:503.70,status:"Ready",noBreakdownFlagFrom:null,poolFlagFrom:null};
 const own={withholding:503.70,status:"Ready",noBreakdownFlag:false,poolFlag:false,flags:[]};
 assert.deepEqual(phase15CutoffFailures("D",control,13,own),[]);
 assert.ok(phase15CutoffFailures("D",control,13,{...own,status:"Exception"}).length);
 assert.ok(phase15CutoffFailures("D",control,13,{...own,flags:["unexpected"]}).length);
});

test("failure stops before release, retains actual evidence, and cannot erase a failed fictional dataset",()=>{
 const source=readFileSync("scripts/golden-payroll-phase15.ts","utf8");
 const validate=source.indexOf("phase15CutoffFailures(id,spec.cutoffs,cutoff");
 const stop=source.indexOf("assert.equal(failuresById.size,0",validate);
 const release=source.indexOf('set({status:"Released"})',stop);
 assert.ok(validate>0&&stop>validate&&release>stop);
 assert.ok(source.includes("const cutoffs=Object.fromEntries(observed.get(id)!)"));
 assert.ok(source.includes("runId:run.id,entryId:row.id,employeeId:row.employeeId"));
 assert.ok(source.includes("yearEnd:yearEnds.get(id)??null"));
 assert.ok(source.includes("if(completed){\n      await db.delete(yearEndAdjustments)"));
 assert.ok(source.includes("PHASE15_STOP: email or payout state appeared"));
});
