import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,mkdir} from "node:fs/promises";
import {createRequire} from "node:module";
import {build} from "esbuild";
const require=createRequire(import.meta.url);
const {chromium}=require("playwright");
await mkdir("qa-artifacts",{recursive:true});
await build({entryPoints:["tests/fixtures/wfm-loyverse-pos-browser.jsx"],
  bundle:true,platform:"browser",jsx:"automatic",
  outfile:"qa-artifacts/wfm-loyverse-pos-browser.js"});
const bundle=await readFile("qa-artifacts/wfm-loyverse-pos-browser.js");
const server=createServer((req,res)=>{
  res.setHeader("Content-Type",req.url==="/bundle.js"?"text/javascript":"text/html");
  res.end(req.url==="/bundle.js"?bundle:
    '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:375,height:812},reducedMotion:"reduce"});
const errors=[];page.on("pageerror",e=>errors.push(e.message));
try{
  await page.goto("http://127.0.0.1:"+server.address().port);
  const panel=page.locator("[data-wfm-loyverse-pos]");
  await panel.getByRole("heading",{name:"Loyverse POS receipt demand"}).waitFor();
  assert.equal(await panel.getByRole("button",{name:"Import changed counts"}).isDisabled(),true);
  await panel.getByLabel("Loyverse historical work date").fill("2026-09-20");
  await panel.locator('input[type="checkbox"]').check();
  await panel.getByRole("button",{name:"Preview without import"}).click();
  await panel.getByText(/Preview completed without aggregate import/).waitFor();
  assert.equal(await page.evaluate(()=>window.imported),false);
  await panel.getByRole("button",{name:"Import changed counts"}).click();
  await panel.getByText(/Aggregate source revisions checked/).waitFor();
  assert.equal(await page.evaluate(()=>window.imported),true);
  await panel.getByText(/source_reported_only/).waitFor();
  await page.screenshot({path:"qa-artifacts/wfm-loyverse-375px.png",fullPage:true});
  await page.evaluate(()=>{window.failSource=true;});
  await panel.locator('input[type="checkbox"]').check();
  await panel.getByRole("button",{name:"Preview without import"}).click();
  await panel.getByText(/Provider scan incomplete, nothing imported/).waitFor();
  await panel.getByLabel("Loyverse demand worksite").selectOption("6");
  await panel.getByRole("alert").getByText(/Merchant consent or store mapping unavailable/).waitFor();
  await page.evaluate(()=>window.render(200,true));
  await panel.getByRole("alert").getByText(/Merchant consent or store mapping unavailable/).waitFor();
  await page.evaluate(()=>window.render(100,false));
  await panel.getByRole("heading",{name:"Loyverse POS receipt demand"}).waitFor();
  assert.equal(await panel.getByRole("button",{name:"Import changed counts"}).count(),0);
  const requests=await page.evaluate(()=>window.requests);
  assert.ok(requests.every(q=>q.url==="/api/workforce/demand-observations/loyverse"));
  assert.ok(requests.every(q=>["POST","GET"].includes(q.method)));
  assert.ok(requests.some(q=>q.method==="POST"));
  assert.deepEqual(errors,[]);
  console.log("Loyverse POS 375px synthetic PASS: scoped read-only preview, explicit aggregate import, freshness, denied site/tenant, no schedule or payroll writes.");
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}