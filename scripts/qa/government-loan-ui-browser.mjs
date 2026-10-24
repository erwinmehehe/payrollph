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
    let loanCalls = 0;
    window.__qaRequests = [];
    window.fetch = async (input, options) => {
      const url = String(input);
      window.__qaRequests.push({url, method: options?.method || 'GET', body: options?.body || null});
      if (url.includes('/api/legal-entities?')) {
        if (mode === 'loading') return new Promise(()=>{});
        const denied = mode === 'selector-denied';
        return {ok: !denied, status: denied ? 403 : 200,
          json: async () => ({organizationId: mode === 'selector-foreign' ? 99 : 7,
            legalEntities: [{id:18,code:'PRIMARY',displayName:'Fictional Employer',active:true,primaryEntity:true},
              ...(mode === 'multi' ? [{id:19,code:'SECOND',displayName:'Second Fictional Employer',active:true,primaryEntity:false}] : [])]})};
      }
      if (mode === "loading") return new Promise(()=>{});
      loanCalls++;
      const failed = mode === 'error' || (mode === 'retry' && loanCalls === 1);
      const foreign = mode === 'foreign';
      const selected = Number(new URL(url,'http://fixture.test').searchParams.get('legalEntityId') || 18);
      if (mode === 'multi' && selected === 18 && window.__qaHoldLoanRead) {
        // Transport deliberately ignores AbortSignal: a late old-employer error
        // must not poison the currently selected employer's verified evidence.
        return new Promise(resolve => { window.__qaReleaseLoanRead = () => resolve({
          ok:false, status:503, json:async()=>({})
        }); });
      }
      return {ok: !failed && mode !== 'denied', status: mode === 'denied' ? 403 : failed ? 503 : 200,
        json: async () => ({organizationId: foreign ? 99 : 7, legalEntityId: selected,
          today:'2026-10-21', legalEntity:{id:selected, code:null, displayName:'Fictional Employer'}, batches:[],members:[]})};
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
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE ?? "playwright");
  const browser = await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE ? {executablePath:process.env.QA_CHROMIUM_EXECUTABLE} : {})});
  const report = {head:process.env.PR_HEAD_SHA??"local",synthetic:true,checks:[]};
  try {
    for (const width of [1280,390]) for (const mode of ["loading","error","empty","foreign","denied","retry","multi","selector-denied","selector-foreign"]) {
      const html = {};
      for (const variant of ["legacy","off","on"]) {
        const page = await browser.newPage({viewport:{width,height:900}});
        const errors=[];page.on("pageerror",e=>errors.push(e.message));
        await page.goto(url+"/?variant="+variant+"&mode="+mode);
        await page.locator("#root main").waitFor({state:"attached"});
        if (mode !== "loading") {
          // Wait for the authorized selector and then the scoped loan read.
          if (variant === "on" && mode === "multi") {
            await page.getByRole("combobox",{name:"Legal employer for government loan remittances"}).waitFor();
          } else if (variant === "on" && mode === "empty") {
            await page.getByText(/No remittance batch is recorded/).waitFor();
          } else if (variant === "on") {
            await page.getByRole("alert").first().waitFor();
          } else if (["error","foreign","denied","retry"].includes(mode)) {
            await page.getByRole("heading",{name:"Government loan remittances unavailable"}).waitFor();
          } else {
            await page.getByText(/No remittance batch is recorded/).waitFor();
          }
        }
        html[variant] = await page.locator("#root").innerHTML();
        if (variant !== "on" && ["error","foreign","denied","retry"].includes(mode)) {
          assert.equal(await page.getByRole("button",{name:/Open.*loan remittance/}).count(),0);
          if(mode === "retry") {
            await page.getByRole("button",{name:"Retry remittances"}).click();
            await page.getByText(/No remittance batch is recorded/).waitFor();
            assert.equal(await page.getByRole("button",{name:"Open SSS loan remittance",exact:true}).isEnabled(),true);
          }
        }
        if (variant === "on") {
          if (mode === "loading") await page.getByText(/Checking authorized legal employers/).waitFor();
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
          if (mode.startsWith("selector-")) {
            assert.equal(await page.getByRole("button",{name:/Open.*loan remittance/}).count(),0);
            assert.equal((await page.evaluate(()=>window.__qaRequests)).filter(call=>call.url.includes('/government-loan-remittances')).length,0);
          }
          if (mode === "multi") {
            const select = page.getByRole("combobox",{name:"Legal employer for government loan remittances"});
            assert.equal(await page.getByRole("button",{name:/Open.*loan remittance/}).count(),0);
            await select.selectOption("18");
            await page.getByText(/No remittance batch is recorded/).waitFor();
            await page.getByRole("button",{name:"Open SSS loan remittance",exact:true}).click();
            await page.getByText(/may already have been recorded/).waitFor();
            const submitted = await page.evaluate(()=>window.__qaRequests.filter(call=>call.method === 'POST'));
            assert.equal(JSON.parse(submitted[0].body).legalEntityId,18);
            await select.selectOption("19");
            await page.getByText(/No remittance batch is recorded/).waitFor();
            const reads = await page.evaluate(()=>window.__qaRequests.filter(call=>call.url.includes('/government-loan-remittances') && call.method === 'GET'));
            assert.ok(reads.some(call=>call.url.includes('legalEntityId=18')));
            assert.ok(reads.some(call=>call.url.includes('legalEntityId=19')));
            await select.selectOption("18");
            await page.getByText(/No remittance batch is recorded/).waitFor();
            await page.evaluate(()=>{window.__qaHoldLoanRead=true;});
            await page.getByRole("button",{name:"Refresh",exact:true}).click();
            await page.waitForFunction(()=>typeof window.__qaReleaseLoanRead === 'function');
            await select.selectOption("19");
            await page.getByText(/No remittance batch is recorded/).waitFor();
            await page.evaluate(()=>{window.__qaHoldLoanRead=false;window.__qaReleaseLoanRead();});
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            assert.equal(await page.getByRole("button",{name:"Open SSS loan remittance",exact:true}).isEnabled(),true);
            assert.equal(await page.getByRole("alert").count(),0,"Late old-employer errors cannot replace the new employer's verified read");
          }
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
    console.log("PASS: 54 desktop/390px actual-component states, flag-off parity, granted employer selection, denied/foreign selector handling and retry.");
  } finally {
    writeFileSync("qa-artifacts/government-loan-browser-report.json",JSON.stringify(report,null,2)+"\n");
    await browser.close();await new Promise(r=>server.close(r));
  }
}
