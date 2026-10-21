import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

// Actual React component with synthetic transport only; no database or credentials.
const assets = {};
for (const variant of ["legacy", "off", "on"]) {
  const component = variant === "legacy" ? "government-loan-remittance-panel-legacy" : "government-loan-remittance-panel";
  const result = await build({stdin: {contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {GovernmentLoanRemittancePanel} from './src/components/${component}';
    const mode = new URLSearchParams(location.search).get('mode');
    let calls = 0;
    window.fetch = async () => {
      calls++;
      if (mode === 'loading') return new Promise(()=>{});
      const failed = mode === 'error' || (mode === 'retry' && calls === 1);
      const foreign = mode === 'foreign';
      return {ok: !failed && mode !== 'denied', status: mode === 'denied' ? 403 : failed ? 503 : 200,
        json: async () => ({organizationId: foreign ? 99 : 7, legalEntityId: 18,
          today:'2026-10-21', legalEntity:{id:18, code:null, displayName:'Fictional Employer'}, batches:[],members:[]})};
    };
    const notice = () => {};
    createRoot(document.getElementById('root')).render(<main><GovernmentLoanRemittancePanel organizationId={7} setNotice={notice}/></main>);
  `,sourcefile:"qa-loan.tsx",resolveDir:process.cwd(),loader:"tsx"}, bundle:true,platform:"browser",format:"iife",write:false,jsx:"automatic",
    define:{"process.env.NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED":JSON.stringify(variant === "on" ? "true" : "false")},logLevel:"warning"});
  assets[variant] = result.outputFiles[0].text;
}
const css = ["src/app/globals.css","src/app/workspace-theme.css","src/app/workspace-panels.css"].map(p=>readFileSync(p,"utf8")).join("\n");
const server = createServer((req,res)=>{
  const url = new URL(req.url,"http://localhost");
  if (url.pathname === "/test.js") {res.setHeader("Content-Type","text/javascript");res.end(assets[url.searchParams.get("variant")] ?? assets.on);return;}
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+':root{--font-inter:Arial;--font-jetbrains-mono:monospace}</style><div id="root"></div><script src="/test.js?variant='+encodeURIComponent(url.searchParams.get("variant")??"on")+'"></script>');
});
await new Promise(r=>server.listen(process.env.QA_PORT ? Number(process.env.QA_PORT) : 0,"127.0.0.1",r));
const url = "http://127.0.0.1:"+server.address().port;
console.log("Synthetic component fixture: "+url);
if (!process.argv.includes("--serve")) {
  mkdirSync("qa-artifacts",{recursive:true});
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE ? {executablePath:process.env.QA_CHROMIUM_EXECUTABLE} : {})});
  const report = {head:process.env.PR_HEAD_SHA??"local",synthetic:true,checks:[]};
  try {
    for (const width of [1280,390]) for (const mode of ["loading","error","empty","foreign","denied","retry"]) {
      const html = {};
      for (const variant of ["legacy","off","on"]) {
        const page = await browser.newPage({viewport:{width,height:900}});
        const errors=[];page.on("pageerror",e=>errors.push(e.message));
        await page.goto(url+"/?variant="+variant+"&mode="+mode);
        await page.locator("#root main").waitFor({state:"attached"});
        if (mode !== "loading") {
          // Wait for the component's async read rather than an arbitrary delay.
          if (variant === "on") await page.getByRole(mode === "empty" ? "status" : "alert").first().waitFor();
          else if (mode === "denied") await page.waitForFunction(()=>document.querySelector("#root main")?.textContent === "");
        }
        html[variant] = await page.locator("#root").innerHTML();
        if (variant === "on") {
          if (mode === "loading") await page.getByText(/Verifying employer-scoped/).waitFor();
          if (["error","foreign","retry"].includes(mode)) {
            await page.getByText(/could not be verified/).waitFor();
            assert.equal(await page.getByRole("button",{name:"Open SSS loan remittance",exact:true}).isDisabled(),true);
          }
          if (mode === "denied") assert.equal(await page.getByRole("button",{name:/Open.*loan remittance/}).count(),0);
          if (mode === "retry") {
            await page.getByRole("button",{name:"Retry evidence read"}).click();
            await page.getByText(/No remittance batch is recorded/).waitFor();
            assert.equal(await page.getByRole("button",{name:"Open SSS loan remittance",exact:true}).isEnabled(),true);
          }
          if (mode === "empty") await page.getByText(/not proof that loan liabilities are zero/).waitFor();
        }
        assert.deepEqual(errors,[]);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),`${variant}/${mode}/${width}: overflow`);
        await page.screenshot({path:`qa-artifacts/government-loan-${variant}-${mode}-${width}.png`,fullPage:true});
        report.checks.push({width,mode,variant,passed:true});
        await page.close();
      }
      assert.equal(html.off,html.legacy,`${mode}/${width}: flag-off must retain legacy DOM`);
    }
    report.result="PASS";
    console.log("PASS: 36 desktop/390px actual-component states, exact flag-off DOM parity, denied actions, foreign evidence rejection and retry recovery.");
  } finally {
    writeFileSync("qa-artifacts/government-loan-browser-report.json",JSON.stringify(report,null,2)+"\n");
    await browser.close();await new Promise(r=>server.close(r));
  }
}
