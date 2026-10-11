import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
// Local runtime fallback; CI installs its own pinned Playwright.
const { chromium } = require(process.env.HCM_BROWSER_PLAYWRIGHT_MODULE ?? "playwright");
await mkdir("qa-artifacts", { recursive: true });
await build({
  entryPoints: ["tests/fixtures/hcm-request-lifecycle.jsx"], bundle: true,
  outfile: "qa-artifacts/hcm-request-lifecycle.js", platform: "browser", jsx: "automatic",
  plugins: [{ name: "read-only-link-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react'; export default function Link(props) { return React.createElement('a', props); }", resolveDir: process.cwd() }));
  } }],
});
const bundle = await readFile("qa-artifacts/hcm-request-lifecycle.js");
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/bundle.js" ? bundle : '<div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  executablePath: process.env.HCM_BROWSER_EXECUTABLE || undefined });
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
function item(id, title) { return {id,title,detail:"",caseType:"follow_up",status:"open",ownerTeam:"HR Operations",ownerUserId:1,ownerName:"Synthetic owner",dueAt:null,escalateAt:null,escalationLevel:0,overdue:false}; }

try {
  await page.goto(base + "/?organizationId=1");
  await page.evaluate(() => window.renderView("queue"));
  await complete(await requestId("work-items?organizationId=1"), {items:[item(11,"Employer A case"),item(12,"Second A case")],owners:[{id:1,name:"Synthetic owner"}]});
  await visible("Employer A case");
  await page.getByRole("button", {name:"Assign / SLA"}).first().click();
  const oldHistory = await requestId("caseId=11");
  await page.getByRole("button", {name:"Cancel", exact:true}).click();
  await page.getByRole("button", {name:"Assign / SLA"}).nth(1).click();
  const currentHistory = await requestId("caseId=12");
  await complete(oldHistory, {events:[{id:1,eventType:"STALE_HISTORY",actorName:null,createdAt:"2026-10-11T00:00:00Z"}]});
  await complete(currentHistory, {events:[]});
  await visible("No history recorded.");
  assert.ok(!(await page.locator("body").innerText()).includes("STALE HISTORY"));
  await page.getByRole("button", {name:"Save changes"}).click();
  const oldSave = await requestId("/api/hcm/work-items", "PATCH");
  await page.getByRole("spinbutton", {name:"Organization ID"}).fill("2");
  await absent("Employer A case");
  assert.equal(await page.getByRole("dialog").count(), 0);
  const tenantBRead = await requestId("work-items?organizationId=2");
  await complete(oldSave, {});
  await complete(tenantBRead, {items:[item(21,"Employer B case")],owners:[]});
  await visible("Employer B case");
  assert.equal(await page.evaluate(() => window.pending.filter(r=>r.url.includes("work-items?organizationId=2")).length), 2, "StrictMode creates two reads; old save must not add another");
  await page.getByRole("button", {name:"Refresh",exact:true}).click();
  await absent("Employer B case");
  await absent("No work items found for this filter.");
  await complete(await requestId("work-items?organizationId=2"), {error:"Synthetic queue outage"}, 503);
  await visible("Synthetic queue outage");
  await absent("Employer B case");
  await page.getByRole("combobox", {name:"Queue",exact:true}).selectOption("resolved");
  await absent("Synthetic queue outage");
  await complete(await requestId("status=resolved"), {items:[],owners:[]});
  await visible("No work items found for this filter.");
  await page.getByRole("spinbutton", {name:"Organization ID"}).fill("");
  await visible("Choose a valid organization to load its queue.");

  // My Team already masks by full query scope; verify loading is render-derived.
  await page.evaluate(() => window.renderView("team", {organizationId:1}));
  const staleTeam = await requestId("my-team?organizationId=1");
  await page.evaluate(() => window.renderView("team", {organizationId:2}));
  await complete(staleTeam, {error:"STALE_TEAM_ERROR"}, 403);
  await complete(await requestId("my-team?organizationId=2"), {organizationId:2,query:"",statusFilter:"all",scope:{kind:"company"},items:[],page:{size:25,hasMore:false,nextCursor:null},summary:{employeeRecordsThisPage:0,pendingLeaveRecordsThisPage:0,pendingOvertimeRecordsThisPage:0},observedAt:"2026-10-11T00:00:00Z"});
  await visible("Employee records / this page");
  // Revisiting a tenant while the intervening tenant's request is still pending
  // must not reuse the retired tenant's completed response.
  await page.evaluate(() => window.renderView("team", {organizationId:1}));
  const interveningTeam = await requestId("my-team?organizationId=1");
  await page.evaluate(() => window.renderView("team", {organizationId:2}));
  await absent("Employee records / this page");
  await complete(interveningTeam, {error:"RETIRED_TEAM_ERROR"}, 403);
  await complete(await requestId("my-team?organizationId=2"), {organizationId:2,query:"",statusFilter:"all",scope:{kind:"company"},items:[],page:{size:25,hasMore:false,nextCursor:null},summary:{employeeRecordsThisPage:0,pendingLeaveRecordsThisPage:0,pendingOvertimeRecordsThisPage:0},observedAt:"2026-10-11T00:00:00Z"});
  await visible("Employee records / this page");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent("Employee records / this page");
  await complete(await requestId("my-team?organizationId=2"), {error:"unavailable"}, 503);
  await visible("Team records unavailable");

  await page.evaluate(() => window.renderView("worker", {organizationId:1,employeeId:11,initialAsOfDate:"2026-10-11"}));
  await complete(await requestId("worker-360?organizationId=1"), {}, 403);
  await visible("This worker is not available to your current employer and role.");
  await page.evaluate(() => window.renderView("worker", {organizationId:2,employeeId:22,initialAsOfDate:"2026-10-11"}));
  await absent("This worker is not available to your current employer and role.");
  await visible("Loading authorized worker records…");
  await complete(await requestId("worker-360?organizationId=2"), {}, 503);
  await visible("The Worker 360 source is currently unavailable.");

  await page.evaluate(() => window.renderView("inbox", {organizationId:1}));
  const staleInbox = await requestId("people-operations-inbox?organizationId=1");
  await page.evaluate(() => window.renderView("inbox", {organizationId:2}));
  await complete(staleInbox, {error:"STALE_INBOX_ERROR"}, 403);
  await complete(await requestId("people-operations-inbox?organizationId=2"), {error:"Current inbox unavailable"}, 503);
  await visible("Current inbox unavailable");
  await absent("STALE_INBOX_ERROR");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent("Current inbox unavailable");
  await visible("Loading tenant-scoped HR follow-ups…");
  assert.deepEqual(errors, []);
  console.log("HCM request lifecycle browser QA passed: tenant/filter/editor isolation, late history, stale save, refresh/failure states, My Team, Worker 360 and People Ops (StrictMode; transport ignores abort).");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
