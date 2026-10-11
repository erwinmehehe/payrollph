import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
// Local runtime fallback; CI installs its own pinned Playwright.
const { chromium } = require(process.env.WFM_BROWSER_PLAYWRIGHT_MODULE ?? "playwright");
await mkdir("qa-artifacts", { recursive: true });
await build({
  entryPoints: ["tests/fixtures/wfm-request-lifecycle.jsx"], bundle: true,
  outfile: "qa-artifacts/wfm-request-lifecycle.js", platform: "browser", jsx: "automatic",

});
const bundle = await readFile("qa-artifacts/wfm-request-lifecycle.js");
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/bundle.js" ? bundle : '<div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  executablePath: process.env.WFM_BROWSER_EXECUTABLE || undefined });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const base = `http://127.0.0.1:${server.address().port}`;
async function requestId(fragment, method = "GET") {
  await page.waitForFunction(({ fragment, method }) => window.pending.some(r => !r.done && !r.options.signal?.aborted && r.url.includes(fragment) && (r.options.method ?? "GET") === method), { fragment, method });
  return page.evaluate(({ fragment, method }) => window.pending.findLastIndex(r => !r.done && !r.options.signal?.aborted && r.url.includes(fragment) && (r.options.method ?? "GET") === method), { fragment, method });
}
async function complete(id, body, status = 200) { await page.evaluate(({id,body,status}) => window.complete(id,body,status), {id,body,status}); }
async function visible(text) { await page.getByText(text, { exact: true }).waitFor(); }
async function absent(text) { assert.equal(await page.getByText(text, { exact: true }).count(), 0, `Unexpected stale text: ${text}`); }
function policy(minutes) { return {minimumRestMinutes:minutes,maxConsecutiveWorkingDays:6,rollingSevenDayMinutes:2880,enforcementMode:"advisory",active:true}; }
function overtime(id, reason) { return {id,employeeId:id,workDate:"2026-10-11",requestedMinutes:60,reason,requestKind:"pre_approved",status:"pending",requestedBy:"Synthetic employee"}; }
function swap(id, reason) { return {id,requesterEmployeeId:id,counterpartyEmployeeId:id+1,requesterWorkDate:"2026-10-11",counterpartyWorkDate:"2026-10-12",reason,status:"pending",requestedBy:"Synthetic employee"}; }
async function render(view, organizationId, canManage = true) { await page.evaluate(({view,organizationId,canManage}) => window.renderView(view, organizationId, canManage), {view,organizationId,canManage}); }

try {
  await page.goto(base);
  await render("guardrails",1);
  await visible("Loading schedule guardrails");
  const retiredRead = await requestId("schedule-guardrails?organizationId=1");
  await render("guardrails",2);
  await complete(retiredRead,{policy:policy(900),configured:true});
  assert.equal(await page.getByRole("spinbutton",{name:"Minimum rest minutes"}).count(),0);
  await complete(await requestId("schedule-guardrails?organizationId=2"),{policy:policy(300),configured:true});
  const rest = page.getByRole("spinbutton",{name:"Minimum rest minutes"});
  await rest.fill("360");
  await page.getByRole("button",{name:"Save guardrails"}).click();
  const retiredSave = await requestId("/api/workforce/schedule-guardrails","POST");
  assert.equal(await page.evaluate(id=>JSON.parse(window.pending[id].options.body).organizationId,retiredSave),2);
  await render("guardrails",3);
  assert.equal(await rest.count(),0,"No prior policy may remain editable during employer loading");
  await complete(await requestId("schedule-guardrails?organizationId=3"),{policy:policy(600),configured:true});
  await complete(retiredSave,{policy:policy(360),configured:true});
  assert.equal(await rest.inputValue(),"600","A late save must not overwrite another employer's policy");
  assert.equal(await page.evaluate(()=>window.saved),0,"Retired save must not emit a current-view saved callback");
  await rest.fill("630");
  await page.getByRole("button",{name:"Save guardrails"}).click();
  await complete(await requestId("/api/workforce/schedule-guardrails","POST"),{policy:policy(630),configured:true});
  assert.equal(await rest.inputValue(),"630");
  assert.equal(await page.evaluate(()=>window.saved),1);
  await render("guardrails",3,false);
  assert.equal(await rest.count(),0,"Access changes must hide the edited policy immediately");
  await complete(await requestId("schedule-guardrails?organizationId=3"),{error:"Synthetic guardrail outage"},503);
  await visible("Synthetic guardrail outage");
  await page.getByRole("button",{name:"Retry guardrails"}).click();
  await complete(await requestId("schedule-guardrails?organizationId=3"),{policy:policy(600),configured:true});
  assert.equal(await rest.inputValue(),"600","Retry must use a fresh server policy, not a retired draft");
  assert.equal(await rest.isDisabled(),true);
  assert.equal(await page.getByRole("button",{name:"Save guardrails"}).count(),0);

  await render("overtime",1);
  await complete(await requestId("overtime?organizationId=1"),{requests:[overtime(11,"Employer A overtime")],budgets:[],managers:[],canManageBudgets:false});
  await visible("Pre-approved · Employer A overtime");
  await page.getByRole("checkbox",{name:"Select overtime request #11",exact:true}).check();
  await page.getByRole("button",{name:"Approve selected (1)",exact:true}).click();
  const oldOTSave = await requestId("/api/workforce/overtime","POST");
  await render("overtime",2);
  await absent("Pre-approved · Employer A overtime");
  await complete(await requestId("overtime?organizationId=2"),{requests:[overtime(21,"Employer B overtime")],budgets:[],managers:[],canManageBudgets:false});
  await page.getByRole("checkbox",{name:"Select overtime request #21",exact:true}).check();
  await complete(oldOTSave,{});
  await visible("Approve selected (1)");
  assert.equal(await page.getByRole("combobox",{name:"Employee",exact:true}).inputValue(),"21");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent("Pre-approved · Employer B overtime");
  await complete(await requestId("overtime?organizationId=2"),{error:"Synthetic overtime outage"},503);
  await visible("Synthetic overtime outage");
  assert.equal(await page.getByRole("checkbox",{name:"Select overtime request #21",exact:true}).count(),0);

  await render("swaps",1);
  const oldSwap = await requestId("schedule-swaps?organizationId=1");
  await render("swaps",2);
  await complete(oldSwap,{swaps:[swap(11,"STALE_SWAP")]});
  await absent("STALE_SWAP");
  await complete(await requestId("schedule-swaps?organizationId=2"),{swaps:[swap(21,"Current swap")]});
  await visible("Current swap");
  assert.equal(await page.getByRole("combobox",{name:"Employee A",exact:true}).inputValue(),"21");
  assert.equal(await page.getByRole("combobox",{name:"Employee B",exact:true}).inputValue(),"22");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent("Current swap");
  await complete(await requestId("schedule-swaps?organizationId=2"),{error:"Synthetic swap outage"},503);
  await visible("Synthetic swap outage");
  await absent("Current swap");
  assert.deepEqual(errors,[]);
  const notices = await page.evaluate(()=>window.notices);
  assert.ok(!notices.some(value=>value.includes("STALE")));
  console.log("WFM request lifecycle browser QA passed: guardrail draft/read/save ownership, employer/access switches, retry, overtime selections/late save, swap defaults and refresh failures (StrictMode; transport ignores abort).");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
