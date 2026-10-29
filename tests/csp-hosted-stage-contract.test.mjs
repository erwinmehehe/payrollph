import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  QA_PROJECT_ID, QA_TEAM_ID, PRODUCTION_PROJECT_ID,
  PRODUCTION_HOSTNAME, ROUTES, checkedStageUrl,
  stageConfiguration, attestPreview, getScriptPolicy,
  nonceEvidence, seoEvidence, seoParity, quantile,
  cacheSafety, safeHeaderSet, htmlFingerprint,
} from "../scripts/qa/csp-hosted-stage-contract.mjs";

const SHA="a".repeat(40);
const ids=["dpl_SyntheticPreviewOff123","dpl_SyntheticPreviewOn456"];
const urls=["https://fictional-csp-off-123.vercel.app","https://fictional-csp-on-456.vercel.app"];
function env() {
  return {
    GITHUB_ACTIONS:"true", GITHUB_REF:"refs/heads/main",
    GITHUB_SHA:SHA, CSP_STAGE_SOURCE_SHA:SHA,
    CSP_STAGE_PROJECT_ID:QA_PROJECT_ID, CSP_STAGE_TEAM_ID:QA_TEAM_ID,
    CSP_STAGE_OFF_URL:urls[0], CSP_STAGE_ON_URL:urls[1],
    CSP_STAGE_OFF_DEPLOYMENT_ID:ids[0],
    CSP_STAGE_ON_DEPLOYMENT_ID:ids[1],
  };
}
function deployment(mode) {
  const n=mode==="off"?0:1;
  return {
    id:ids[n],projectId:QA_PROJECT_ID,target:"preview",readyState:"READY",
    url:new URL(urls[n]).hostname,meta:{githubCommitSha:SHA},
    alias:[],
  };
}
function expectReject(fn,pattern) {
  assert.throws(fn,pattern);
}

test("both immutable preview URLs require HTTPS, origin-only, Vercel and cannot be production",()=>{
  assert.equal(checkedStageUrl(urls[0],"OFF"),urls[0]);
  for(const target of [
    "http://fictional-csp-off-123.vercel.app",
    "https://fictional-csp-off-123.vercel.app/path",
    "https://fictional-csp-off-123.vercel.app?x=1",
    "https://user:pass@fictional-csp-off-123.vercel.app",
    "https://fictional-csp-off-123.vercel.app:8443",
    "https://example.org",
    "https://"+PRODUCTION_HOSTNAME,
    "https://fictional-csp-off-123.vercel.app/#fragment",
  ]) expectReject(()=>checkedStageUrl(target,"ON"),/./);
});

test("stage configuration rejects wrong branch, project, SHA, repeated deployment and URL",()=>{
  const valid=stageConfiguration(env());
  assert.equal(valid.sourceSha,SHA);
  assert.equal(valid.projectId,QA_PROJECT_ID);
  assert.equal(valid.off.mode,"off");
  for (const [key,value] of [
    ["GITHUB_ACTIONS","false"],
    ["GITHUB_REF","refs/heads/feature"],
    ["GITHUB_SHA","b".repeat(40)],
    ["CSP_STAGE_SOURCE_SHA","b".repeat(40)],
    ["CSP_STAGE_PROJECT_ID",PRODUCTION_PROJECT_ID],
    ["CSP_STAGE_TEAM_ID","team_Foreign"],
    ["CSP_STAGE_OFF_URL",urls[1]],
    ["CSP_STAGE_OFF_DEPLOYMENT_ID",ids[1]],
    ["CSP_STAGE_ON_DEPLOYMENT_ID","bad_id"],
  ]) {
    const copy={...env(),[key]:value};
    expectReject(()=>stageConfiguration(copy),/./);
  }
});

test("only READY preview in designated QA project, exact SHA, URL and deployment passes",()=>{
  const config=stageConfiguration(env());
  const a=attestPreview(deployment("off"),config.off,config);
  const b=attestPreview(deployment("on"),config.on,config);
  assert.equal(a.target,"preview"); assert.equal(b.sourceSha,SHA);
  const bad=[
    {target:"production"},
    {readyState:"ERROR"},
    {projectId:PRODUCTION_PROJECT_ID},
    {url:PRODUCTION_HOSTNAME},
    {url:new URL(urls[1]).hostname},
    {meta:{githubCommitSha:"b".repeat(40)}},
    {id:"dpl_Foreign"},
    {alias:[PRODUCTION_HOSTNAME]},
  ];
  for(const change of bad)expectReject(()=>attestPreview({
    ...deployment("off"),...change,
  },config.off,config),/./);
  expectReject(()=>attestPreview({id:ids[0]},config.off,config),/./);
});

test("nonce contract rejects missing, reused policy, unsafe script-src and mismatched rendered scripts",()=>{
  const nonce=Buffer.from("synthetic-but-unique-csp-nonce").toString("base64");
  const csp="default-src 'self'; script-src 'self' 'nonce-"+nonce+"' 'strict-dynamic'";
  const html="<html><script nonce=\""+nonce+"\">window.foo=1;</script>"+
    "<script type=\"application/ld+json\">{}</script>"+
    "<script nonce=\""+nonce+"\" src=\"/_next/static/main.js\"></script></html>";
  const good=nonceEvidence(csp,html,true);
  assert.equal(good.pass,true);
  assert.equal(good.scriptCount,2);
  assert.equal(good.matching,2);
  assert.equal(good.missing,0);
  assert.equal(good.mismatched,0);
  assert.equal(getScriptPolicy(csp).startsWith("script-src "),true);
  assert.equal(nonceEvidence(csp,html.replace('nonce="'+nonce+'"','nonce="foreign"'),true).pass,false);
  assert.equal(nonceEvidence(csp,html.replace('nonce="'+nonce+'"',''),true).pass,false);
  assert.equal(nonceEvidence(csp+" 'unsafe-eval'",html,true).pass,false);
  assert.equal(nonceEvidence("script-src 'self' 'unsafe-inline'",html,false).pass,true);
  assert.equal(nonceEvidence("script-src 'self'",html,false).pass,false);
});

test("cache controls fail for non-private/non-store, HIT/STALE or positive Age",()=>{
  const ok={cacheControl:"private, no-store",age:null,vercelCache:"MISS"};
  assert.equal(cacheSafety(ok,true).pass,true);
  for(const change of [
    {cacheControl:"public, max-age=3600"},
    {cacheControl:"no-store"},
    {cacheControl:"private"},
    {vercelCache:"HIT"},
    {vercelCache:"STALE"},
    {age:"12"},
  ]) assert.equal(cacheSafety({...ok,...change},true).pass,false);
  assert.equal(cacheSafety({cacheControl:"public, max-age=0",vercelCache:"HIT"},false).pass,true);
  const h=new Headers({ "cache-control":"private, no-store",
    "x-vercel-cache":"MISS","set-cookie":"do-not-leak-value" });
  assert.deepEqual(safeHeaderSet(h).setsCookie,true);
  assert.equal(JSON.stringify(safeHeaderSet(h)).includes("do-not-leak-value"),false);
});

test("SEO parity uses title description canonical H1 and robots, not HTML nonce changes",()=>{
  const a='<title>Linaw | HRIS</title>'+
    '<meta name="description" content="Human resources">'+
    '<meta name="robots" content="index, follow">'+
    '<link rel="canonical" href="https://example.test/hris">'+
    '<h1><span>HRIS</span> Philippines</h1>';
  const b=a+'<script nonce="another">window.foo=1;</script>';
  const expected=seoEvidence(a);
  assert.equal(expected.h1,"HRIS Philippines");
  assert.equal(expected.robots,"index, follow");
  assert.equal(seoParity(expected,seoEvidence(b)),true);
  assert.equal(seoParity(expected,seoEvidence(b.replace("Human resources","Payroll"))),false);
  assert.notEqual(htmlFingerprint(a),htmlFingerprint(b));
});

test("nearest-rank p50 / p95 is explicit and does not mutate observations",()=>{
  const data=[1,3,2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
  assert.equal(quantile(data,0.5),10);
  assert.equal(quantile(data,0.95),19);
  assert.equal(quantile(data,1),20);
  assert.deepEqual(data.slice(0,4),[1,3,2,4]);
  expectReject(()=>quantile([],0.95),/No measurements/);
});

test("repository still blocks automatic preview/staging deploy and flag stays opt-in",()=>{
  const cfg=JSON.parse(readFileSync("vercel.json","utf8"));
  assert.equal(cfg.git.deploymentEnabled["**"],false);
  assert.equal(cfg.git.deploymentEnabled.main,true);
  assert.equal(cfg.git.deploymentEnabled.staging,false);
  assert.equal(cfg.git.deploymentEnabled.preview,false);
  const proxy=readFileSync("src/proxy.ts","utf8");
  const layout=readFileSync("src/app/layout.tsx","utf8");
  const nextConfig=readFileSync("next.config.ts","utf8");
  assert.ok(proxy.includes('process.env.NEXT_CSP_ENABLED !== "true"'));
  assert.ok(layout.includes('process.env.NEXT_CSP_ENABLED === "true"'));
  assert.ok(nextConfig.includes('process.env.NEXT_CSP_ENABLED === "true"'));
  assert.deepEqual(ROUTES,["/","/hris","/pricing","/hcm","/login"]);
});


test("hosted workflow proves isolated Preview env and read-only DB before any browser GET",()=>{
  const workflow=readFileSync(".github/workflows/csp-hosted-staging-benchmark.yml","utf8");
  const attest=readFileSync("scripts/qa/csp-hosted-stage-attest.mjs","utf8");
  const runner=readFileSync("scripts/qa/csp-hosted-stage-run.mjs","utf8");
  assert.ok(workflow.includes("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"));
  assert.ok(workflow.includes("environment: csp-hosted-staging"));
  assert.ok(workflow.includes("secrets.CSP_STAGE_READ_TOKEN"));
  assert.ok(workflow.includes("secrets.CSP_STAGE_READONLY_DATABASE_URL"));
  assert.ok(workflow.includes("secrets.CSP_STAGE_PRODUCTION_DATABASE_URL_SHA256"));
  const metadata=workflow.indexOf("Read-only metadata attestation BEFORE contacting staging URL");
  const db=workflow.indexOf("Independently attest synthetic staging DB identity and read-only user");
  const app=workflow.indexOf("Read-only staging cache/TTFB/SEO/nonce and real public Chromium proof");
  assert.ok(metadata>0 && db>metadata && app>db);
  assert.ok(attest.includes("auditPreviewIsolationMetadata(sanitizedEnv)"));
  assert.ok(runner.includes('db-readonly-attestation.json'));
  assert.ok(runner.includes('assert.equal(dbProof.dbReadOnly,true)'));
  assert.ok(runner.includes('assert.equal(approved.previewEnvTargetAuditPassed,true'));
  assert.ok(runner.includes('method!=="GET" && method!=="HEAD"'));
  assert.ok(runner.includes("blockedProductionRequests"));
  assert.ok(!workflow.includes("vercel deploy"));
  assert.ok(!workflow.includes("vercel --prod"));
  assert.ok(!workflow.includes("NEXT_CSP_ENABLED=true"));
});
