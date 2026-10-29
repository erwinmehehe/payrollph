#!/usr/bin/env node
/**
 * Bounded, read-only HEADERS+HTML+Chromium benchmark against two independently
 * attested immutable Vercel QA previews. Does not deploy, login, mutate, or
 * fetch production application routes.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import {
  ROUTES, PRODUCTION_HOSTNAME, stageConfiguration, nonceEvidence, seoEvidence, seoParity,
  cacheSafety, safeHeaderSet, htmlFingerprint, quantile,
} from "./csp-hosted-stage-contract.mjs";

const base = "qa-artifacts/csp-hosted-stage";
const SAMPLE_COUNT = 20;
const WARMUP_COUNT = 2;
const SAFE_HTML_LIMIT_BYTES = 2 * 1024 * 1024;
await mkdir(base + "/screenshots", {recursive:true});
const report = {
  kind:"hosted-staging-read-only", sourceSha:process.env.GITHUB_SHA,
  createdAt:new Date().toISOString(), requestBudget:ROUTES.length * 2 *
    (SAMPLE_COUNT + WARMUP_COUNT),
  measuredSamplesPerModePerRoute:SAMPLE_COUNT, warmups:WARMUP_COUNT,
  pages:[], browser:[], failures:[], result:"UNVERIFIED",
  productionTouched:false, productionApproved:false,
  realPayrollAccessed:false, deploymentCreated:false,
  scaleLoadTested:false, providerCostMeasured:false,
};
const head = [["route","off-p50","on-p50","delta-p50","off-p95",
  "on-p95","delta-p95","off-HIT","on-HIT","SEO parity"]];

function collectHeaders(response) {
  return safeHeaderSet(response.headers);
}
function stageBrowserRoute(url) {
  const result = new URL(url);
  // Main document origin is only the previously attested immutable Vercel URL.
  return result.origin;
}
function browserEventText(msg) {
  return String(msg).slice(0,250).replace(/[\r\n]/g," ");
}

async function oneGet(stage, path, bypass, recordSample) {
  const url = stage.origin + path;
  assert.equal(stageBrowserRoute(url),stage.origin,"Read-only GET must remain within attested preview");
  const headers = { Accept:"text/html", "User-Agent":"LinawCspHostedQaReadOnly/1.0" };
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  const start = performance.now();
  const response = await fetch(url, {
    method:"GET", redirect:"manual", headers, signal:AbortSignal.timeout(30000),
  });
  const ttfbMs = +(performance.now()-start).toFixed(2);
  assert.equal(response.status,200,stage.mode + " " + path +
    ": served HTTP " + response.status + "; preview/protection might be misconfigured");
  const type = response.headers.get("content-type") || "";
  assert.ok(type.includes("text/html"),stage.mode + " " + path + ": not HTML");
  const html = await response.text();
  assert.ok(Buffer.byteLength(html) < SAFE_HTML_LIMIT_BYTES,
    stage.mode + " " + path + ": HTML too large for bounded evidence");
  const totalMs = +(performance.now()-start).toFixed(2);
  const publicHeaders = collectHeaders(response);
  const csp = response.headers.get("content-security-policy") || "";
  const nonce = nonceEvidence(csp,html,stage.mode==="on");
  const cache = cacheSafety(publicHeaders,stage.mode==="on");
  assert.ok(nonce.pass,stage.mode + " " + path + ": CSP/SSR script nonce mismatch");
  assert.ok(cache.pass,stage.mode + " " + path + ": nonce HTML cached or lacks private/no-store");
  return {
    mode:stage.mode, path, status:response.status,
    ttfbMs,totalMs,headers:publicHeaders,
    cspScriptPolicy:nonce.policy, nonce:nonce.nonce,
    nonceScripts:nonce.scriptCount, matchingNonceScripts:nonce.matching,
    nonceMissing:nonce.missing, nonceMismatched:nonce.mismatched,
    htmlBytes:Buffer.byteLength(html), htmlSha256:htmlFingerprint(html),
    seo:seoEvidence(html), cachePass:cache.pass,
    // No HTML body, cookie, token, request secret or employee data in artifacts.
    measured:recordSample,
  };
}
function timingStats(samples) {
  const measured=samples.filter(x=>x.measured);
  assert.equal(measured.length,SAMPLE_COUNT);
  return {
    ttfbP50Ms:quantile(measured.map(x=>x.ttfbMs),0.5),
    ttfbP95Ms:quantile(measured.map(x=>x.ttfbMs),0.95),
    totalP50Ms:quantile(measured.map(x=>x.totalMs),0.5),
    totalP95Ms:quantile(measured.map(x=>x.totalMs),0.95),
    cacheStateCounts:measured.reduce((counts,x)=>{
      const state=(x.headers.vercelCache||"MISSING").toUpperCase();
      counts[state]=(counts[state]||0)+1;
      return counts;
    },{}),
  };
}

async function measure(config,bypass) {
  for (const path of ROUTES) {
    const samples={off:[],on:[]};
    // Equal load and alternating mode order reduce sequential benchmarking bias.
    for (let i=0;i<WARMUP_COUNT+SAMPLE_COUNT;i++) {
      const order=i%2===0?[config.off,config.on]:[config.on,config.off];
      for (const stage of order)
        samples[stage.mode].push(await oneGet(stage,path,bypass,i>=WARMUP_COUNT));
    }
    assert.equal(samples.off.length,WARMUP_COUNT+SAMPLE_COUNT);
    assert.equal(samples.on.length,WARMUP_COUNT+SAMPLE_COUNT);
    const offSeo=samples.off[WARMUP_COUNT].seo;
    const onSeo=samples.on[WARMUP_COUNT].seo;
    assert.ok(seoParity(offSeo,onSeo),path + ": SEO metadata/H1 changed between builds");
    const uniqueOnNonces=new Set(samples.on.map(x=>x.nonce));
    assert.equal(uniqueOnNonces.size,samples.on.length,
      path + ": CSP nonce repeated across separate hosted HTML requests");
    assert.ok(!uniqueOnNonces.has(null),path + ": missing CSP nonce");
    const off=timingStats(samples.off);
    const on=timingStats(samples.on);
    report.pages.push({
      path, off,on,
      deltaP50Ms:+(on.ttfbP50Ms-off.ttfbP50Ms).toFixed(2),
      deltaP95Ms:+(on.ttfbP95Ms-off.ttfbP95Ms).toFixed(2),
      seoParity:true,seo:offSeo,distinctOnNonceCount:uniqueOnNonces.size,
      offSamples:samples.off.filter(x=>x.measured),
      onSamples:samples.on.filter(x=>x.measured),
    });
    // This is only a read-only, single-threaded sample; not a load test.
    console.log("MEASURED " + path + " OFF/ON p95 " +
      off.ttfbP95Ms + "/" + on.ttfbP95Ms + " ms, nonce unique=" + uniqueOnNonces.size);
  }
}

async function testBrowser(browser,stage,bypass,path) {
  const context=await browser.newContext({
    viewport:{width:1440,height:900},
    serviceWorkers:"block",
  });
  // Block ALL non-read requests, including unsolicited browser analytics
  // posts. Send optional protection bypass ONLY to the attested exact origin.
  // No password submit, payroll writes, POST telemetry or external tokens.
  let blockedNonReadRequests=0;
  let blockedExternalDocuments=0;
  let blockedProductionRequests=0;
  await context.route("**/*",async route=>{
    const request=route.request();
    const method=request.method().toUpperCase();
    if (method!=="GET" && method!=="HEAD") {
      blockedNonReadRequests++;
      await route.abort("blockedbyclient");
      return;
    }
    const target=new URL(request.url());
    if (target.hostname===PRODUCTION_HOSTNAME) {
      blockedProductionRequests++;
      await route.abort("blockedbyclient");
      return;
    }
    if (request.isNavigationRequest() && target.origin!==stage.origin) {
      blockedExternalDocuments++;
      await route.abort("blockedbyclient");
      return;
    }
    try {
      if (bypass && target.origin===stage.origin) {
        const h={...route.request().headers(),"x-vercel-protection-bypass":bypass};
        await route.continue({headers:h});
      } else await route.continue();
    } catch { await route.continue().catch(()=>{}); }
  });
  const page=await context.newPage();
  const entry={
    mode:stage.mode,path,status:null,pass:false,
    cspViolations:[],consoleErrors:[],pageErrors:[],
    screenshot:base+"/screenshots/"+stage.mode+"-"+(
      path==="/"?"home":path.slice(1).replace(/[^a-z0-9-]/g,"-"))+".png",
  };
  page.on("pageerror",err=>entry.pageErrors.push(browserEventText(err.message)));
  page.on("console",msg=>{if(msg.type()==="error")
    entry.consoleErrors.push(browserEventText(msg.text()));});
  await page.addInitScript(()=>{
    window.__cspStageViolations=[];
    document.addEventListener("securitypolicyviolation",e=>{
      window.__cspStageViolations.push({
        violatedDirective:e.violatedDirective,
        blockedUri:e.blockedURI,sourceFile:e.sourceFile,lineNumber:e.lineNumber,
      });
    });
  });
  try {
    const response=await page.goto(stage.origin+path,{
      waitUntil:"domcontentloaded",timeout:45000,
    });
    assert.ok(response,stage.mode+" "+path+" browser document missing");
    entry.status=response.status();
    assert.equal(entry.status,200,stage.mode+" "+path+" browser document not 200");
    assert.equal(new URL(page.url()).origin,stage.origin,
      "Browser left attested QA preview origin");
    await page.waitForTimeout(1200);
    if(path==="/login") {
      const password=page.locator('input[autocomplete="current-password"]');
      await password.waitFor({timeout:20000});
      assert.equal(await password.getAttribute("type"),"password");
      await page.getByTestId("password-visibility").click();
      assert.equal(await password.getAttribute("type"),"text",
        "Real React hydration did not activate login visibility control");
      await page.getByTestId("password-visibility").click();
      assert.equal(await password.getAttribute("type"),"password");
      entry.hydrationProof="login React visibility onClick toggled twice";
    } else {
      await page.locator("h1").first().waitFor({timeout:20000});
      entry.hydrationProof="public page rendered; no interactive click asserted";
    }
    entry.cspViolations=await page.evaluate(()=>window.__cspStageViolations||[]);
    entry.blockedNonReadRequests=blockedNonReadRequests;
    entry.blockedExternalDocuments=blockedExternalDocuments;
    entry.blockedProductionRequests=blockedProductionRequests;
    assert.equal(blockedNonReadRequests,0,
      stage.mode+" "+path+": browser attempted non-read request; review integration");
    assert.equal(blockedExternalDocuments,0,
      stage.mode+" "+path+": browser attempted an external document navigation");
    assert.equal(blockedProductionRequests,0,
      stage.mode+" "+path+": browser tried to contact production origin");
    const relevantErrors=[...entry.consoleErrors,...entry.pageErrors]
      .filter(text=>/content security policy|refused to (load|execute)|hydration|react error #|minified react error/i.test(text));
    assert.equal(entry.cspViolations.length,0,stage.mode+" "+path+" CSP violations");
    assert.equal(relevantErrors.length,0,stage.mode+" "+path+" hydration/CSP console errors");
    entry.pass=true;
  } catch(error) {
    entry.error=error instanceof Error?error.message:String(error);
    entry.cspViolations=await page.evaluate(()=>window.__cspStageViolations||[]).catch(()=>[]);
  } finally {
    await page.screenshot({path:entry.screenshot,fullPage:true}).catch(err=>{
      entry.screenshotError=String(err);
    });
    await context.close();
  }
  return entry;
}
async function browsers(config,bypass) {
  const browser=await chromium.launch({headless:true});
  try {
    for (const stage of [config.off,config.on]) {
      for (const path of ROUTES) {
        const result=await testBrowser(browser,stage,bypass,path);
        report.browser.push(result);
        if (!result.pass) throw new Error(stage.mode+" "+path+
          ": real hosted Chromium failed; see browser[] evidence");
      }
    }
  } finally {await browser.close();}
}

function reportMarkdown() {
  const lines=[
    "# Hosted nonce CSP benchmark: exact-preview evidence",
    "",
    "**Result: "+report.result+"**",
    "",
    "Read-only runner against two separately attested immutable preview deployments in fictional QA project.",
    "Source SHA: "+report.sourceSha+". No production flag or deployment changes.",
    "Measured "+SAMPLE_COUNT+" sequential requests per route/mode after "+WARMUP_COUNT+
      " warmups, alternating OFF/ON order; never a scale load test.",
    "",
    "| Route | OFF p50 ms | ON p50 ms | Delta p50 ms | OFF p95 ms | ON p95 ms | Delta p95 ms | OFF CDN HIT | ON CDN HIT | SEO parity |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...report.pages.map(p=>"| "+p.path+" | "+
      p.off.ttfbP50Ms+" | "+p.on.ttfbP50Ms+" | "+p.deltaP50Ms+
      " | "+p.off.ttfbP95Ms+" | "+p.on.ttfbP95Ms+" | "+p.deltaP95Ms+
      " | "+(p.off.cacheStateCounts.HIT||0)+" | "+(p.on.cacheStateCounts.HIT||0)+
      " | "+(p.seoParity?"yes":"NO")+" |"),
    "",
    "Raw JSON preserves each response-header timing, cache-control, age, CDN cache state,",
    "HTML bytes/hash, SEO fields, nonce matching, screenshot pointers and Chromium CSP events.",
    "No HTML response bodies, cookies, auth tokens or real employee payroll information are recorded.",
    "",
    "## Scope and release gate",
    "",
    "Results cover public marketing and login pages only. No authenticated payroll/HCM,",
    "physical mobile browsers, CDN traffic distributions, production function memory/CPU",
    "or real billing were measured. CDN cache HIT is observational; OFF mode's routes",
    "may already be dynamic and therefore may not hit the cache.",
    "",
    "**Production decision: NO-GO pending Security/Web/SEO owner review, representative hosted",
    "traffic and cost estimates, third-party/mobile browser checks and rollback approval.**",
    "The default NEXT_CSP_ENABLED remains OFF.",
    "",
    ...report.failures.map(f=>"- Failure: "+f),
  ];
  return lines.join("\n")+"\n";
}

try {
  assert.equal(process.env.GITHUB_ACTIONS,"true");
  assert.equal(process.env.GITHUB_REF,"refs/heads/main");
  const config=stageConfiguration(process.env);
  const approved=JSON.parse(await readFile(base+"/attestation.json","utf8"));
  assert.equal(approved.result,"ATTESTED_PREVIEW_ONLY");
  assert.equal(approved.sourceSha,config.sourceSha);
  assert.equal(approved.previewEnvTargetAuditPassed,true,
    "Preview environment targets must be isolated before any app GET");
  // Existing HCM staging attestation queries ONLY marker, DB identity and
  // transaction_read_only with an independent read-only credential.
  // A preview project name alone never proves synthetic data isolation.
  const dbProof=JSON.parse(await readFile(base+"/db-readonly-attestation.json","utf8"));
  assert.equal(dbProof.gate,"PASS","Synthetic staging DB attestation required");
  assert.equal(dbProof.projectMatched,true);
  assert.equal(dbProof.productionUrlDifferent,true);
  assert.equal(dbProof.databaseMarkerMatched,true);
  assert.equal(dbProof.dbReadOnly,true);
  assert.equal(dbProof.realEmployerAccepted,false);
  assert.equal(dbProof.releaseApproved,false);
  report.dbIsolation=dbProof;
  for (const stage of [config.off,config.on]) {
    const a=approved.deploymentTargets?.find(x=>x.mode===stage.mode);
    assert.equal(a?.origin,stage.origin,"Attested immutable origin mismatch");
    assert.equal(a?.deploymentId,stage.deploymentId,"Attested deployment identity mismatch");
    assert.equal(a?.target,"preview","Attested target must be preview");
  }
  report.attestation=approved;
  const bypass=process.env.CSP_STAGE_BYPASS_SECRET||"";
  await measure(config,bypass);
  await browsers(config,bypass);
  assert.equal(report.pages.length,ROUTES.length);
  assert.equal(report.browser.length,ROUTES.length*2);
  assert.ok(report.browser.every(x=>x.pass));
  report.result="STAGING_TECHNICAL_PASS_PRODUCTION_NO_GO";
} catch(error) {
  const reason=error instanceof Error?error.message:String(error);
  report.failures.push(reason.slice(0,450));
  report.result="BLOCKED_OR_FAILED_PRODUCTION_NO_GO";
  process.exitCode=1;
} finally {
  await writeFile(base+"/result.json",JSON.stringify(report,null,2)+"\n");
  await writeFile(base+"/report.md",reportMarkdown());
  console.log(JSON.stringify({
    result:report.result,sourceSha:report.sourceSha,measuredRoutes:report.pages.length,
    browserPasses:report.browser.filter(x=>x.pass).length,failures:report.failures,
    productionTouched:false,productionApproved:false,
  },null,2));
}
