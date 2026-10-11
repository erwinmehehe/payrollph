import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HCM_BROWSER_PLAYWRIGHT_MODULE ?? "playwright");
await mkdir("qa-artifacts", { recursive: true });
await build({ entryPoints: ["tests/fixtures/wfm-review-lifecycle.jsx"], bundle: true,
  outfile: "qa-artifacts/wfm-review-lifecycle.js", platform: "browser", jsx: "automatic" });
const bundle = await readFile("qa-artifacts/wfm-review-lifecycle.js");
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
async function requestId(fragment, method = "GET") {
  await page.waitForFunction(({ fragment, method }) => window.pending.some(r => !r.done && !r.options.signal?.aborted && r.url.includes(fragment) && (r.options.method ?? "GET") === method), { fragment, method });
  return page.evaluate(({ fragment, method }) => window.pending.findLastIndex(r => !r.done && !r.options.signal?.aborted && r.url.includes(fragment) && (r.options.method ?? "GET") === method), { fragment, method });
}
async function complete(id, body, status = 200) { await page.evaluate(({id,body,status}) => window.complete(id,body,status), {id,body,status}); }
async function visible(text) { await page.getByText(text, { exact: true }).waitFor(); }
async function absent(text) { assert.equal(await page.getByText(text, { exact: true }).count(), 0, `Unexpected stale text: ${text}`); }
const workerA = {id:11,employeeNo:"A-11",name:"Synthetic worker A"};
const workerB = {id:22,employeeNo:"B-22",name:"Synthetic worker B"};
function receipt(employee, account) { return {employee,account,days:[],summary:null,boundary:"Synthetic receipt boundary"}; }
function batch(id, reason) { return {id,reason,workDate:"2031-01-02",shiftDefinitionId:1,status:"pending",requestedBy:"Synthetic maker",requestedByUserId:5,employees:[],overrideCount:0}; }
const deniedIdentity = "Multiple active employee sign-ins need an HR identity review before receipt status can be interpreted.";
const missingIdentity = "This employee does not have one active employee self-service sign-in. A missing receipt must not be treated as noncompliance.";
const batchProps = {organizationId:1,currentUserId:7,enabled:true,refreshKey:0};

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(props=>window.renderView("receipt",props), {organizationId:1,employee:workerA});
  await visible("Checking current employee schedule and receipt records…");
  const oldReceipt = await requestId("schedule-receipt-review?organizationId=1");
  await page.evaluate(props=>window.renderView("receipt",props), {organizationId:2,employee:workerB});
  await complete(oldReceipt,receipt(workerA,"not_enrolled"));
  await absent(missingIdentity);
  await complete(await requestId("schedule-receipt-review?organizationId=2"),receipt(workerB,"identity_review"));
  await visible(deniedIdentity);
  const reads = await page.evaluate(()=>window.pending.length);
  await page.evaluate(props=>window.renderView("receipt",props), {organizationId:2,employee:{...workerB}});
  assert.equal(await page.evaluate(()=>window.pending.length),reads,"Equivalent worker objects must not trigger another fetch");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent(deniedIdentity);
  await visible("Checking current employee schedule and receipt records…");
  await complete(await requestId("schedule-receipt-review?organizationId=2"),{},503);
  await visible("Current schedule receipt status could not be verified.");
  await absent(deniedIdentity);
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent("Current schedule receipt status could not be verified.");
  await complete(await requestId("schedule-receipt-review?organizationId=2"),receipt(workerA,"identity_review"));
  await visible("The receipt review source returned incomplete evidence.");
  await absent(deniedIdentity);

  await page.evaluate(props=>window.renderView("batches",props),batchProps);
  await visible("Loading authorized review queue…");
  await absent("No staged roster batches in this employer.");
  await complete(await requestId("roster-batches?organizationId=1"),{batches:[batch(31,"Employer A private batch")]});
  await visible("Employer A private batch");
  await page.getByRole("button",{name:"Review",exact:true}).click();
  await page.getByLabel("Checker decision note").fill("Employer A private rationale");
  await page.getByRole("checkbox").check();
  await page.getByRole("button",{name:"Approve and publish batch"}).click();
  const oldDecision = await requestId("/api/workforce/roster-batches","POST");
  const currentProps = {...batchProps,organizationId:2};
  await page.evaluate(props=>window.renderView("batches",props),currentProps);
  await absent("Employer A private batch");
  await complete(await requestId("roster-batches?organizationId=2"),{batches:[batch(32,"Employer B private batch")]});
  await page.getByRole("button",{name:"Review",exact:true}).click();
  assert.equal(await page.getByLabel("Checker decision note").inputValue(),"");
  assert.equal(await page.getByRole("checkbox").isChecked(),false);
  const pendingCount = await page.evaluate(()=>window.pending.length);
  await complete(oldDecision,{error:"STALE_DECISION_FAILURE"},409);
  await absent("STALE_DECISION_FAILURE");
  assert.equal(await page.evaluate(()=>window.pending.length),pendingCount,"Retired decision must not refresh the current employer");
  await page.getByLabel("Checker decision note").fill("Employer B private rationale");
  await page.getByRole("checkbox").check();
  await page.evaluate(props=>window.renderView("batches",props),{...currentProps,enabled:false});
  await absent("Employer B private batch");
  assert.equal(await page.getByLabel("Checker decision note").count(),0);
  await page.evaluate(props=>window.renderView("batches",props),currentProps);
  await visible("Loading authorized review queue…");
  await complete(await requestId("roster-batches?organizationId=2"),{batches:[batch(32,"Employer B private batch")]});
  await page.getByRole("button",{name:"Review",exact:true}).click();
  assert.equal(await page.getByLabel("Checker decision note").inputValue(),"");
  assert.equal(await page.getByRole("checkbox").isChecked(),false);
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent("Employer B private batch");
  await complete(await requestId("roster-batches?organizationId=2"),{},503);
  await visible("Could not load governed roster batches.");
  await absent("No staged roster batches in this employer.");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await complete(await requestId("roster-batches?organizationId=2"),{batches:[]});
  await visible("No staged roster batches in this employer.");
  await page.evaluate(props=>window.renderView("batches",props),{...currentProps,refreshKey:1});
  await absent("No staged roster batches in this employer.");
  const unmountedRead = await requestId("roster-batches?organizationId=2");
  await page.evaluate(()=>window.unmountView());
  await complete(unmountedRead,{batches:[batch(32,"UNMOUNTED_BATCH")]});
  await absent("UNMOUNTED_BATCH");
  assert.deepEqual(errors,[]);
  console.log("WFM review browser QA passed: scope/feature/editor isolation, retired decisions, refresh failure clearing, receipt validation, stable worker props and unmount (StrictMode; transport ignores abort).");
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
