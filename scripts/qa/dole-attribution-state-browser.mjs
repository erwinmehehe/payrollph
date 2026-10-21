#!/usr/bin/env node
/** Synthetic actual React DOM/browser checks for default-OFF DOLE state UX.
 * Server 503 remains unconditional regardless of this presentation flag.
 * Compare flag-off with the exact unmodified PR #1308 UI source.
 * No sign-in, DB, live DOLE account, filing or payment.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const baselineSha="694703b2745b5171df6da067ee433b2741ae2c63";
const path="src/components/workspace/dole-thirteenth-month-report-panel.tsx";
const old=execFileSync("git",["show",baselineSha+":"+path],{encoding:"utf8"});
const plugin={
  name:"qa-doctrine-baseline",
  setup(b) {
    b.onResolve({filter:/^qa-dole-baseline$/},args=>({path:args.path,namespace:"qa-baseline"}));
    b.onLoad({filter:/.*/,namespace:"qa-baseline"},()=>({
      contents:old,loader:"tsx",resolveDir:dirname(resolve(path)),
    }));
  },
};
async function compile(variant){
  const target=variant==="legacy"?"qa-dole-baseline":"./"+path;
  const entry=[
    'import React from "react";',
    'import {createRoot} from "react-dom/client";',
    'import {DoleThirteenthMonthReportPanel} from '+JSON.stringify(target)+';',
    'createRoot(document.getElementById("root")).render(',
    '  <DoleThirteenthMonthReportPanel organizationId={41} notify={()=>{}} />);',
  ].join("\n");
  const output=await build({
    stdin:{contents:entry,sourcefile:"qa-dole.tsx",resolveDir:process.cwd(),loader:"tsx"},
    bundle:true,platform:"browser",format:"iife",write:false,logLevel:"warning",plugins:[plugin],
    define:{"process.env.NEXT_PUBLIC_DOLE_ATTRIBUTION_STATE_UI_ENABLED":variant==="on"?'"true"':'"false"'},
  });
  return output.outputFiles.find(x=>x.path.endsWith(".js"))?.text??output.outputFiles[0].text;
}
const bundles=Object.fromEntries(await Promise.all(["legacy","off","on"].map(async v=>[v,await compile(v)])));
const css=["src/app/globals.css","src/app/workspace-theme.css","src/app/workspace-panels.css"]
  .map(f=>readFileSync(f,"utf8")).join("\n");
const server=createServer((req,res)=>{
  const address=new URL(req.url,"http://localhost");
  if(address.pathname==="/test.js"){
    res.setHeader("Content-Type","text/javascript");
    res.end(bundles[address.searchParams.get("variant")]??"");return;
  }
  res.setHeader("Content-Type","text/html; charset=utf-8");
  const mode=JSON.stringify(address.searchParams.get("mode")??"blocked");
  const init='<script>window.fetch=async function(){'
    +'const mode='+mode+';'
    +'if(mode==="loading")return new Promise(()=>{});'
    +'if(mode==="blocked")return new Response(JSON.stringify({'
    +'code:"DOLE_ENTITY_SOURCE_ATTRIBUTION_REQUIRED",'
    +'error:"DOLE 13th-month reporting is unavailable until historical payroll, final pay and submission evidence can be attributed to one legal employer."'
    +'}),{status:503,headers:{"Content-Type":"application/json"}});'
    +'const year=new Date().getFullYear();const due=(year+1)+"-01-15";'
    +'const hash="a".repeat(64);'
    +'const body={organizationId:41,legalEntityId:null,'
    +'organization:{id:41,name:"Fictional Employer",legalName:"Fictional Inc."},'
    +'profile:null,report:{reportType:"13th_month_pay",taxYear:year,dueDate:due,establishmentName:"Fictional Inc.",'
    +'establishmentAddress:"",principalBusiness:"",totalEmployment:1,workersBenefited:1,totalBenefitsGranted:125.00,'
    +'contactName:"",contactPosition:"",contactPhone:"",employees:[{employeeNo:"E1",employeeName:"Fictional Worker",amountGranted:125}]},'
    +'reportHash:hash,profileComplete:false,readyToSubmit:false,reviewRows:[],incompleteBasicRows:[],'
    +'sourceNote:"Fictional demo only",submissionCurrent:false,currentSubmission:null,latestSubmission:null,'
    +'submissionHistory:[],officialSource:{label:"DOLE Online Compliance Portal",url:"https://reports.dole.gov.ph/",deadline:due}};'
    +'return new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}});'
    +'};</script>';
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<style>'+css+'</style></head><body><div id="root"></div>'+init
    +'<script src="/test.js?variant='+encodeURIComponent(address.searchParams.get("variant")??"off")+'"></script></body></html>');
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port;
mkdirSync("qa-artifacts",{recursive:true});
const results={head:process.env.PR_HEAD_SHA??"local",baselineSha,synthetic:true,
  widths:[1280,390],modes:["blocked","valid","loading"],variants:["legacy","off","on"],checks:[],flagOffParity:false};
const browser=await chromium.launch({headless:true});
try{
  for(const width of results.widths)for(const mode of results.modes){
    const markup={};
    for(const variant of results.variants){
      const page=await browser.newPage({viewport:{width,height:900},timezoneId:"Asia/Manila"});
      const errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(base+"/?mode="+mode+"&variant="+variant,{waitUntil:"load"});
      await page.locator("[data-dole-13th-month-report]").waitFor();
      if(mode==="blocked")await page.getByRole("button",{name:"Retry verified report"}).waitFor();
      if(mode==="valid")await page.getByText("Fictional Worker").waitFor();
      markup[variant]=await page.locator("#root").innerHTML();
      const text=await page.locator("#root").innerText();
      const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(size.scroll<=width+1,"Overflow: "+JSON.stringify({variant,mode,width,...size}));
      assert.deepEqual(errors,[],width+"px "+mode+" "+variant+" errors");
      if(mode==="blocked"){
        assert.match(text,/DOLE 13th-month reporting is unavailable/);
        assert.equal(await page.getByRole("link",{name:/Download source worksheet/}).count(),0);
        assert.equal(await page.getByRole("button",{name:/Record OCP submission/}).count(),0);
        if(variant==="on")assert.match(text,/Legal-employer attribution is required/);
        else assert.doesNotMatch(text,/Legal-employer attribution is required/);
      }
      if(mode==="valid")assert.match(text,/Fictional Worker/);
      await page.screenshot({path:"qa-artifacts/dole-state-"+mode+"-"+variant+"-"+width+".png",fullPage:true});
      results.checks.push({width,mode,variant,overflow:false,pageErrors:0});
      await page.close();
    }
    assert.equal(markup.off,markup.legacy,mode+" "+width+"px: flag-off must equal untouched UI");
    if(mode!=="blocked")assert.equal(markup.on,markup.off,mode+" "+width+"px: flag affects denied notice only");
  }
  results.flagOffParity=true;results.result="PASS";
  console.log("PASS DOLE actual React component: flag-off parity, optional unavailable notice, 1280/390px and no client-side actions on 503.");
}finally{
  writeFileSync("qa-artifacts/dole-attribution-state-browser-report.json",JSON.stringify(results,null,2)+"\n");
  await browser.close();
  await new Promise(r=>server.close(r));
}
