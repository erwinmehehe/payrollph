import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir,readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {build} from "esbuild";

const require=createRequire(import.meta.url);
const {chromium}=require("playwright");
await mkdir("qa-artifacts",{recursive:true});
await build({
  entryPoints:["tests/fixtures/wfm-staffing-policy-browser.jsx"],
  bundle:true,platform:"browser",jsx:"automatic",
  outfile:"qa-artifacts/wfm-staffing-policy-browser.js",
});
const bundle=await readFile("qa-artifacts/wfm-staffing-policy-browser.js");
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
  await page.getByRole("heading",{name:"Propose, submit and independently approve staffing assumptions"}).waitFor();
  const admin=page.locator("[data-wfm-policy-admin]");
  const planner=page.locator("[data-wfm-demand-staffing]");
  assert.equal(await planner.locator("tbody tr").count(),0);
  await admin.locator('input[type="date"]').first().fill("2099-01-01");
  await admin.locator('input[type="date"]').last().fill("2099-01-07");
  await admin.locator('input[type="number"]').first().fill("10.5");
  await admin.locator('input[type="number"]').last().fill("90");
  await admin.getByLabel("Policy evidence and rationale").fill(
    "Synthetic evidence: transaction counts and approved service coverage assumption.");
  await admin.locator('input[type="checkbox"]').check();
  await admin.getByRole("button",{name:"Save immutable draft"}).click();
  await admin.getByText(/Draft #12 v1 saved/).waitFor();
  await admin.getByRole("button",{name:"Submit for approval"}).click();
  await admin.getByText(/Policy #12 status: submitted/).waitFor();
  await admin.getByLabel("Decision justification").fill(
    "Independent checker confirmed policy source, exact role and effective period.");
  await admin.locator('input[type="checkbox"]').check();
  await admin.getByRole("button",{name:"Approve",exact:true}).click();
  await admin.getByText("Independent owner/admin approver required.").waitFor();
  await page.evaluate(()=>{window.actor="checker";});
  await admin.getByRole("button",{name:"Approve",exact:true}).click();
  await admin.getByText(/Policy #12 status: approved/).waitFor();

  await planner.getByLabel("Demand planner assumption source").selectOption("approved");
  await planner.getByText(/Approved planning rule/).waitFor();
  await planner.locator('input[type="checkbox"]').first().check();
  await planner.getByText("Baseline demand scenario").waitFor();
  assert.equal(await planner.locator("tbody tr").count(),1);
  await page.screenshot({path:"qa-artifacts/wfm-staffing-policy-375px.png",fullPage:true});
  await page.evaluate(()=>{window.policyCorrupt=true;});
  await planner.getByRole("button",{name:"Refresh issued forecasts"}).click();
  await planner.getByText(/Policy provenance or effective-date coverage needs independent review/).waitFor();
  assert.equal(await planner.locator("tbody tr").count(),0);
  await planner.getByLabel("Demand planner worksite").selectOption("6");
  await planner.getByText(/No issued demand forecast exists for this worksite/).waitFor();
  assert.equal(await planner.locator("tbody tr").count(),0);
  await page.evaluate(()=>window.renderTenant(200));
  await planner.getByRole("alert").getByText("Workforce manager access is required.").waitFor();
  assert.equal(await planner.locator("tbody tr").count(),0);
  const requests=await page.evaluate(()=>window.requests);
  assert.ok(requests.every(q=>[
    "/api/workforce/demand-staffing/policies",
    "/api/workforce/demand-observations/issued",
  ].includes(q.path)));
  assert.ok(requests.filter(q=>q.method!=="GET").every(q=>
    q.path==="/api/workforce/demand-staffing/policies"),
    "Only governed policy proposal/approval writes may occur.");
  assert.deepEqual(errors,[],"No uncaught policy/planner UI exceptions.");
  console.log("WFM staffing policy QA PASS: fictional maker/checker, immutable draft, manager approved exact scope, hash-tamper and tenant/site isolation, no schedule/payroll writes, 375px.");
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
