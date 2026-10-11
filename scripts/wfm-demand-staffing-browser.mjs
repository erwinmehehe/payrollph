import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
await mkdir("qa-artifacts", {recursive:true});
await build({
  entryPoints:["tests/fixtures/wfm-demand-staffing-browser.jsx"],
  bundle:true,platform:"browser",jsx:"automatic",
  outfile:"qa-artifacts/wfm-demand-staffing-browser.js",
});
const bundle = await readFile("qa-artifacts/wfm-demand-staffing-browser.js");
const server = createServer((req,res) => {
  res.setHeader("Content-Type",req.url==="/bundle.js"?"text/javascript":"text/html");
  res.end(req.url==="/bundle.js"?bundle:
    '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser = await chromium.launch({headless:true,args:["--no-sandbox"]});
const page = await browser.newPage({viewport:{width:375,height:812},reducedMotion:"reduce"});
const errors = [];
page.on("pageerror",err=>errors.push(err.message));
try {
  await page.goto("http://127.0.0.1:"+server.address().port);
  await page.getByRole("heading",{name:"Turn forecast workload into a staffing review"}).waitFor();
  assert.equal(await page.locator("[data-wfm-demand-staffing] tbody tr").count(),0,
    "Unacknowledged/incomplete manager assumptions must never create scenario.");
  await page.getByLabel("Hypothetical productive activities per worker-hour").fill("10");
  await page.getByLabel("Hypothetical service coverage percentage").fill("100");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("heading",{name:"Baseline demand scenario"}).waitFor();
  await page.getByRole("heading",{name:"Higher activity scenario"}).waitFor();
  await page.getByText("₱300.00").first().waitFor();
  assert.equal(await page.locator("[data-wfm-demand-staffing] tbody tr").count(),1);
  assert.match(await page.locator("[data-wfm-demand-staffing] tbody").innerText(),/4 \/ 5/);
  await page.screenshot({path:"qa-artifacts/wfm-demand-staffing-375px.png",fullPage:true});

  await page.evaluate(()=>{window.missingSlot=true;});
  await page.getByRole("button",{name:"Refresh issued forecasts"}).click();
  await page.getByText("Unknown / Unknown").first().waitFor();
  assert.match(await page.locator("[data-wfm-demand-staffing] tbody").innerText(),/Unverified/);

  await page.evaluate(()=>{window.missingSlot=false;window.corrupt=true;});
  await page.getByRole("button",{name:"Refresh issued forecasts"}).click();
  await page.getByText(/Forecast hash integrity failed/).waitFor();
  assert.equal(await page.locator("[data-wfm-demand-staffing] tbody tr").count(),0,
    "Tampered forecast cannot remain visible as a staffing scenario.");

  await page.getByLabel("Demand planner worksite").selectOption("6");
  await page.getByText(/No issued demand forecast exists for this worksite/).waitFor();
  assert.equal(await page.locator("[data-wfm-demand-staffing] tbody tr").count(),0);

  await page.evaluate(()=>window.renderTenant(200));
  await page.getByRole("alert").getByText("Workforce manager access is required.").waitFor();
  assert.equal(await page.locator("[data-wfm-demand-staffing] tbody tr").count(),0);
  const requests = await page.evaluate(()=>window.requests);
  assert.ok(requests.every(r=>r.method==="GET" &&
    r.path==="/api/workforce/demand-observations/issued"));
  assert.deepEqual(errors,[],"No uncaught client exceptions.");
  console.log("WFM demand-to-staffing Chromium PASS: 375px, zero defaults, scenario comparison, missing forecast, hash integrity, worksite/tenant switch, no writes.");
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
