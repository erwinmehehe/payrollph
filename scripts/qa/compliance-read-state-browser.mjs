#!/usr/bin/env node
/**
 * Disposable component-browser proof for PR #1303.
 * Renders the actual statutory React components, not static mockup HTML.
 * Flag-off HTML must equal the exact pre-flag PR source for every state.
 * No auth tokens, database or provider access.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const baselineSha = "e920562cc869a8fd6402423cf3949c0ae7a63cee";
const calendar = "src/components/workspace/compliance-calendar-panel.tsx";
const proof = "src/components/workspace/statutory-payment-proof.tsx";
const baseline = new Map([
  ["qa-legacy-calendar", { content: execFileSync("git", ["show", baselineSha + ":" + calendar], {encoding:"utf8"}), path: calendar }],
  ["qa-legacy-proof", { content: execFileSync("git", ["show", baselineSha + ":" + proof], {encoding:"utf8"}), path: proof }],
]);
const hookStub = [
  'export function useScopedAsyncResource(key) {',
  '  const mode = new URLSearchParams(location.search).get("mode") || "error";',
  '  const state = { loading: mode === "loading", error: null, data: null, reload: () => Promise.resolve() };',
  '  if (mode === "error") state.error = new Error(key.startsWith("compliance-calendar")',
  '    ? "Payroll month obligations could not be verified." : "Payment proof read was incomplete.");',
  '  if (mode === "empty") state.data = key.startsWith("compliance-calendar")',
  '    ? { today:"2026-10-21", applicableMonths:[],items:[],ruleWatch:["sss","philhealth","pagibig","bir-withholding","wage-orders"].map(family => ({ family, label:family, status:"current", currentVersion:"fictional", sourceDocument:null, lastVerifiedOn:null, detail:"Synthetic source rule" })),',
  '        note:"No payroll runs on record for this fictional employer." }',
  '    : { organizationId:41,batchId:22,evidence:[],active:null };',
  '  return state;',
  '}',
].join("\n");
const plugin = {
  name:"qa-source-stubs",
  setup(b) {
    b.onResolve({filter:/^qa-legacy-(calendar|proof)$/}, args =>
      ({path:args.path,namespace:"qa-legacy"}));
    b.onLoad({filter:/.*/,namespace:"qa-legacy"}, args => {
      const value=baseline.get(args.path);
      return {contents:value.content,loader:"tsx",resolveDir:dirname(resolve(value.path))};
    });
    b.onResolve({filter:/use-scoped-async-resource$/},() =>
      ({path:"use-scoped-async-resource",namespace:"qa-hook"}));
    b.onLoad({filter:/.*/,namespace:"qa-hook"},() =>
      ({contents:hookStub,loader:"js"}));
  },
};
async function bundle(variant) {
  const cal=variant==="legacy"?"qa-legacy-calendar":"./"+calendar;
  const pr=variant==="legacy"?"qa-legacy-proof":"./"+proof;
  const entry=[
    'import React from "react";',
    'import {createRoot} from "react-dom/client";',
    'import {ComplianceCalendarPanel} from '+JSON.stringify(cal)+';',
    'import {StatutoryPaymentProof} from '+JSON.stringify(pr)+';',
    'createRoot(document.getElementById("root")).render(',
    '  <main><ComplianceCalendarPanel organizationId={41}/>',
    '    <StatutoryPaymentProof organizationId={41} batchId={22}',
    '      batchStatus="open" notify={()=>{}} /></main>',
    ');',
  ].join("\n");
  const result=await build({
    stdin:{contents:entry,sourcefile:"qa-compliance.tsx",resolveDir:process.cwd(),loader:"tsx"},
    bundle:true,platform:"browser",format:"iife",write:false,
    define:{"process.env.NEXT_PUBLIC_COMPLIANCE_READ_STATE_UI_ENABLED":variant==="on"?'"true"':'"false"'},
    plugins:[plugin],logLevel:"warning",
  });
  return result.outputFiles.find(f=>f.path.endsWith(".js"))?.text ?? result.outputFiles[0].text;
}
const assets=Object.fromEntries(await Promise.all(["legacy","off","on"].map(async v=>[v,await bundle(v)])));
const css=["src/app/globals.css","src/app/workspace-theme.css","src/app/workspace-panels.css"]
  .map(f=>readFileSync(f,"utf8")).join("\n");
const server=createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/test.js"){res.setHeader("Content-Type","text/javascript");res.end(assets[url.searchParams.get("variant")]??"");return;}
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'
    +css+'</style></head><body><div id="root"></div><script src="/test.js?variant='
    +encodeURIComponent(url.searchParams.get("variant")??"off")+'"></script></body></html>');
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const url="http://127.0.0.1:"+server.address().port;
mkdirSync("qa-artifacts",{recursive:true});
const report={sha:process.env.PR_HEAD_SHA??"local",baselineSha,screenWidths:[1280,390],
  modes:["loading","error","empty"],variants:["legacy","off","on"],
  checks:[],flagOffMatchesLegacy:false,synthetic:true};
const browser=await chromium.launch({headless:true,
  ...(process.env.QA_CHROMIUM_EXECUTABLE
    ? {executablePath:process.env.QA_CHROMIUM_EXECUTABLE} : {}),
});
try {
  for(const width of report.screenWidths) for(const mode of report.modes){
    const html={};
    for(const variant of report.variants){
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(url+"/?mode="+mode+"&variant="+variant,{waitUntil:"load"});
      await page.locator("[data-compliance-calendar]").waitFor();
      await page.locator("[data-statutory-payment-proof]").waitFor();
      html[variant]=await page.locator("#root").innerHTML();
      const txt=await page.locator("#root").innerText();
      assert.deepEqual(errors,[],variant+" "+width+"px "+mode+" page errors");
      const metrics=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
      assert.ok(metrics.scrollWidth<=width+1,"Horizontal overflow: "+JSON.stringify({variant,mode,...metrics}));
      if(mode==="error"){
        assert.match(txt,/Calendar unavailable/);
        assert.match(txt,/Payment proof unavailable/);
        assert.equal(await page.locator('input[type="file"]').count(),0,
          "Unverified payment evidence must not expose upload");
        if(variant==="on"){
          assert.match(txt,/No all-clear is implied/);
          assert.match(txt,/Payment evidence cannot be accepted as filed/);
        } else {
          assert.doesNotMatch(txt,/No all-clear is implied/);
        }
      }
      if(mode==="empty") assert.match(txt,/No calendar items need attention/);
      if(mode==="loading") assert.match(txt,/Loading compliance obligations/);
      await page.screenshot({path:"qa-artifacts/compliance-read-"+mode+"-"+variant+"-"+width+".png",fullPage:true});
      report.checks.push({width,mode,variant,overflow:false,pageErrors:0});
      await page.close();
    }
    assert.equal(html.off,html.legacy,mode+" "+width+"px: flag-OFF markup changed");
    if(mode!=="error") assert.equal(html.on,html.off,mode+" "+width+"px: flag must affect error explanation only");
  }
  report.flagOffMatchesLegacy=true;
  report.result="PASS";
  console.log("PASS: exact flag-off DOM parity vs pre-flag #1303, actual React error/loading/empty UI at desktop/390px, no overflow/errors.");
} finally {
  writeFileSync("qa-artifacts/compliance-read-state-browser-report.json",JSON.stringify(report,null,2)+"\n");
  await browser.close();
  await new Promise(r=>server.close(r));
}
