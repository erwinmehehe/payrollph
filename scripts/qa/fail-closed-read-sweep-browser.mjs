import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Actual default-path components, fictional fetch responses only. No hosted services.
const assets = {};
for (const area of ["loan", "dole"]) {
  const component = area === "loan"
    ? "GovernmentLoanRemittancePanel" : "DoleThirteenthMonthReportPanel";
  const path = area === "loan" ? "government-loan-remittance-panel-legacy"
    : "workspace/dole-thirteenth-month-report-panel-legacy";
  const result = await build({ stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {${component} as Panel} from './src/components/${path}';
    const mode = new URLSearchParams(location.search).get('mode');
    let calls = 0;
    window.fetch = async () => {
      calls++;
      const current = mode === 'retry' ? calls === 1 ? 'foreign' : 'empty'
        : mode === 'refresh' ? calls === 1 ? 'empty' : 'foreign' : mode;
      if (current === 'json') return new Response('malformed');
      const org = current === 'foreign' ? 99 : 7;
      const year = new Date().getFullYear();
      const body = ${JSON.stringify(area)} === 'loan' ? {
        organizationId: org, legalEntityId: 18, today:'2026-10-24',
        legalEntity:{id:18,code:null,displayName:'Fictional Employer'},batches:[],members:[],
      } : {
        organizationId:org,legalEntityId:null,organization:{id:org,name:'Fictional',legalName:'Fictional'},
        profile:null,report:{reportType:'13th_month_pay',taxYear:year,dueDate:(year+1)+'-01-15',
          establishmentName:'Fictional',establishmentAddress:'',principalBusiness:'',
          totalEmployment:0,workersBenefited:0,totalBenefitsGranted:0,
          contactName:'',contactPosition:'',contactPhone:'',employees:[]},
        reportHash:'a'.repeat(64),profileComplete:false,readyToSubmit:false,
        reviewRows:[],incompleteBasicRows:[],sourceNote:'Fictional worksheet',
        submissionCurrent:false,currentSubmission:null,latestSubmission:null,submissionHistory:[],
        officialSource:{label:'DOLE Online Compliance Portal',url:'https://reports.dole.gov.ph/',deadline:(year+1)+'-01-15'},
      };
      if(current === 'missing') {delete body.members;delete body.submissionHistory;}
      return new Response(JSON.stringify(body), {status:current === 'http' ? 503 : 200});
    };
    createRoot(document.getElementById('root')).render(<Panel organizationId={7} setNotice={()=>{}} notify={()=>{}}/>);
  `, sourcefile: "read-sweep.tsx", resolveDir: process.cwd(), loader: "tsx" },
  bundle:true, platform:"browser",format:"iife",write:false,jsx:"automatic",logLevel:"warning" });
  assets[area] = result.outputFiles[0].text;
}
const server = createServer((req,res) => {
  const url = new URL(req.url,"http://localhost");
  if(url.pathname === "/fixture.js") {
    res.setHeader("Content-Type","text/javascript");res.end(assets[url.searchParams.get("area")]);return;
  }
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/fixture.js?area='+url.searchParams.get("area")+'"></script>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const playwrightModule = process.env.READ_SWEEP_PLAYWRIGHT_MODULE;
const {chromium} = await import(playwrightModule ? pathToFileURL(playwrightModule + "/index.mjs").href : "playwright");
const browser = await chromium.launch({headless:true,...(process.env.READ_SWEEP_BROWSER ? {executablePath:process.env.READ_SWEEP_BROWSER} : {})});
const checks = [];
try {
  for(const area of ["loan","dole"]) for(const mode of ["empty","http","foreign","missing","json","retry","refresh"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?area=${area}&mode=${mode}`);
    const empty = area === "loan" ? page.getByText(/No remittance batch is recorded/)
      : page.getByText("Total employment",{exact:true});
    const unavailable = area === "loan" ? page.getByRole("heading",{name:"Government loan remittances unavailable"})
      : page.getByText(/DOLE report unavailable:/);
    if(mode === "empty" || mode === "refresh") {
      await empty.waitFor();
      if(mode === "refresh") {
        await page.getByRole("button",{name:"Refresh",exact:true}).click();
        await unavailable.waitFor();
        assert.equal(await empty.count(),0,"Failed refresh must hide earlier empty/totals state");
      }
    } else {
      await unavailable.waitFor();
      assert.equal(await empty.count(),0,"Unverified response must not render verified empty/totals");
      assert.equal(await page.getByRole("button",{name:/Open SSS loan remittance|Save reporting profile/}).count(),0);
      if(mode === "retry") {
        await page.getByRole("button",{name:area === "loan" ? "Retry remittances" : "Retry report"}).click();
        await empty.waitFor();
        assert.equal(await unavailable.count(),0);
      }
    }
    assert.deepEqual(errors,[]);
    checks.push({area,mode,passed:true});
    await page.close();
  }
  console.log(`PASS: ${checks.length} actual-component empty, HTTP, foreign, partial, JSON, retry and failed-refresh checks.`);
} finally {
  mkdirSync("outputs",{recursive:true});
  writeFileSync("outputs/fail-closed-read-sweep-browser.json",JSON.stringify(checks,null,2));
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
