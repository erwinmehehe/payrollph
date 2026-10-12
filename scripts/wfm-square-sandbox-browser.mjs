import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require=createRequire(import.meta.url);
const {chromium}=require("playwright");
await mkdir("qa-artifacts",{recursive:true});
await build({
  entryPoints:["tests/fixtures/wfm-square-sandbox-browser.jsx"],
  bundle:true,platform:"browser",jsx:"automatic",
  outfile:"qa-artifacts/wfm-square-sandbox-browser.js",
});
const bundle=await readFile("qa-artifacts/wfm-square-sandbox-browser.js");
const server=createServer((req,res)=>{
  res.setHeader("Content-Type",req.url==="/bundle.js"?"text/javascript":"text/html");
  res.end(req.url==="/bundle.js"?bundle:
    '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:375,height:812},reducedMotion:"reduce"});
const errors=[];
page.on("pageerror",err=>errors.push(err.message));
try{
  await page.goto("http://127.0.0.1:"+server.address().port);
  const panel=page.locator("[data-wfm-square-sandbox]");
  await panel.getByRole("heading",{name:"Square completed-payment activity"}).waitFor();
  await panel.getByText("Not a live POS connector.").waitFor();
  assert.equal(await panel.getByRole("button",{name:"Import changed counts"}).isDisabled(),true);
  await panel.getByLabel("Square sandbox historical date").fill("2026-09-20");
  await panel.locator('input[type="checkbox"]').check();
  await panel.getByRole("button",{name:"Preview aggregates"}).click();
  await panel.getByText(/Read-only source preview completed/).waitFor();
  await panel.getByText(/3 completed sandbox payment/).waitFor();
  assert.equal(await page.evaluate(()=>window.imported),false);
  await panel.getByRole("button",{name:"Import changed counts"}).click();
  await panel.getByText(/Aggregate correction scan completed/).waitFor();
  assert.equal(await page.evaluate(()=>window.imported),true);
  await panel.getByText(/Last server-checked sandbox source: 2026-10-12/).waitFor();
  await page.screenshot({path:"qa-artifacts/wfm-square-sandbox-375px.png",fullPage:true});
  await page.evaluate(()=>{window.failProvider=true;});
  await panel.locator('input[type="checkbox"]').check();
  await panel.getByRole("button",{name:"Preview aggregates"}).click();
  await panel.getByText(/Sandbox source incomplete or unavailable/).waitFor();
  await panel.getByLabel("Square sandbox worksite").selectOption("6");
  await panel.getByText(/Sandbox location or consent binding unavailable/).waitFor();
  await page.evaluate(()=>window.renderTenant(200));
  await panel.getByText(/Sandbox location or consent binding unavailable/).waitFor();
  const requests=await page.evaluate(()=>window.requests);
  assert.ok(requests.every(q=>q.path==="/api/workforce/demand-observations/square-sandbox"));
  assert.ok(requests.some(q=>q.method==="POST"),"Expected explicit user action");
  assert.ok(requests.every(q=>["GET","POST"].includes(q.method)));
  assert.deepEqual(errors,[],"No uncaught browser errors");
  console.log("WFM Square sandbox QA PASS: 375px, explicit preview/import, freshness, source error, worksite and tenant isolation; no scheduling/payroll calls.");
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
