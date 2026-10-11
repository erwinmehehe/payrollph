import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HCM_BROWSER_PLAYWRIGHT_MODULE ?? "playwright");
await mkdir("qa-artifacts",{recursive:true});
await build({entryPoints:["tests/fixtures/payout-profile-lifecycle.jsx"],bundle:true,
  outfile:"qa-artifacts/payout-profile-lifecycle.js",platform:"browser",jsx:"automatic"});
const bundle = await readFile("qa-artifacts/payout-profile-lifecycle.js");
const server = createServer((request,response)=>{
  response.setHeader("Content-Type",request.url === "/bundle.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/bundle.js" ? bundle : '<div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser = await chromium.launch({headless:true,args:["--no-sandbox"],executablePath:process.env.HCM_BROWSER_EXECUTABLE || undefined});
const page = await browser.newPage();
const errors = []; page.on("pageerror",error=>errors.push(error.message));
async function requestId(fragment, method = "GET") {
  await page.waitForFunction(({fragment,method})=>window.pending.some(r=>!r.done && !r.options.signal?.aborted && r.url.includes(fragment) && (r.options.method ?? "GET") === method),{fragment,method});
  return page.evaluate(({fragment,method})=>window.pending.findLastIndex(r=>!r.done && !r.options.signal?.aborted && r.url.includes(fragment) && (r.options.method ?? "GET") === method),{fragment,method});
}
async function complete(id,body,status = 200) { await page.evaluate(({id,body,status})=>window.complete(id,body,status),{id,body,status}); }
async function visible(text) { await page.getByText(text,{exact:true}).waitFor(); }
async function absent(text) { assert.equal(await page.getByText(text,{exact:true}).count(),0,`Unexpected retired result: ${text}`); }
function entity(id,name,code) { return {legalEntity:{id,displayName:name,code:name,active:true,
  disbursementBankCode:"SYNTHETIC",disbursementAccountName:name+" funding",disbursementAccount:"MASKED-"+name},
  profile:{id:100+id,legalEntityId:id,defaultMethod:"manual",active:false,companyCode:code}}; }
function payload(...profiles) { return {profiles,adapters:[]}; }
const codeField = ()=>page.getByLabel("Company code",{exact:true});
async function noNoticeOrRefresh(count) {
  assert.deepEqual(await page.evaluate(()=>window.notices),[]);
  assert.equal(await page.evaluate(()=>window.pending.length),count,"Retired save must not refresh the new view");
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(()=>window.renderView({organizationId:1}));
  await visible("Loading company payout profiles…");
  await absent("No legal employers found.");
  const oldRead = await requestId("payout-profiles?organizationId=1");
  await page.evaluate(()=>window.renderView({organizationId:2}));
  await complete(oldRead,payload(entity(11,"EMPLOYER A","A-CODE")));
  await absent("EMPLOYER A");
  await complete(await requestId("payout-profiles?organizationId=2"),payload(entity(11,"EMPLOYER B","B-CODE"),entity(22,"B SECOND","SECOND-CODE")));
  assert.equal(await codeField().inputValue(),"B-CODE","Reused entity IDs cannot retain another employer's form");
  await codeField().fill("B DRAFT");
  await page.getByRole("button",{name:/B SECOND/}).click();
  assert.equal(await codeField().inputValue(),"SECOND-CODE");
  await codeField().fill("SECOND DRAFT");
  await page.getByRole("button",{name:"Save payout profile",exact:true}).click();
  const oldEntitySave = await requestId("/api/payout-profiles","PATCH");
  const sent = await page.evaluate(index=>JSON.parse(window.pending[index].options.body),oldEntitySave);
  assert.equal(sent.organizationId,2); assert.equal(sent.legalEntityId,22); assert.equal(sent.companyCode,"SECOND DRAFT");
  await page.getByRole("button",{name:/EMPLOYER B/}).click();
  await codeField().fill("CURRENT ENTITY DRAFT");
  let count = await page.evaluate(()=>window.pending.length);
  await complete(oldEntitySave,{ok:true});
  await noNoticeOrRefresh(count);
  assert.equal(await codeField().inputValue(),"CURRENT ENTITY DRAFT");
  await page.getByRole("button",{name:"Save payout profile",exact:true}).click();
  const oldTenantSave = await requestId("/api/payout-profiles","PATCH");
  await page.evaluate(()=>window.renderView({organizationId:1}));
  assert.equal(await codeField().count(),0);
  await absent("EMPLOYER B");
  await complete(await requestId("payout-profiles?organizationId=1"),payload(entity(11,"EMPLOYER A","A-CODE"),entity(12,"A SECOND","A-SECOND")));
  count = await page.evaluate(()=>window.pending.length);
  await complete(oldTenantSave,{error:"STALE_PROFILE_SAVE"},409);
  await noNoticeOrRefresh(count);
  assert.equal(await codeField().inputValue(),"A-CODE");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  assert.equal(await codeField().count(),0);
  await absent("EMPLOYER A");
  await complete(await requestId("payout-profiles?organizationId=1"),payload(entity(11,"EMPLOYER A","UPDATED SAME PROFILE"),entity(12,"A SECOND","A-SECOND")));
  assert.equal(await codeField().inputValue(),"UPDATED SAME PROFILE","Refresh must update form fields even when profile ID is unchanged");
  await page.getByRole("button",{name:/A SECOND/}).click();
  await codeField().fill("REMOVED ENTITY DRAFT");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await complete(await requestId("payout-profiles?organizationId=1"),payload(entity(11,"EMPLOYER A","UPDATED SAME PROFILE")));
  assert.equal(await codeField().count(),0,"Removed explicit entity requires reselection");
  await page.getByRole("button",{name:/EMPLOYER A/}).click();
  assert.equal(await codeField().inputValue(),"UPDATED SAME PROFILE");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await complete(await requestId("payout-profiles?organizationId=1"),{error:"Current payout profile unavailable"},503);
  await visible("Current payout profile unavailable");
  await absent("No legal employers found.");
  assert.equal(await codeField().count(),0);
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent("Current payout profile unavailable");
  await complete(await requestId("payout-profiles?organizationId=1"),{});
  await visible("Company payout profile records could not be verified.");
  await absent("No legal employers found.");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await complete(await requestId("payout-profiles?organizationId=1"),payload());
  await visible("No legal employers found.");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  const unmountedRead = await requestId("payout-profiles?organizationId=1");
  await page.evaluate(()=>window.unmountView());
  await complete(unmountedRead,payload(entity(11,"UNMOUNTED PAYOUT VIEW","RETIRED")));
  await absent("UNMOUNTED PAYOUT VIEW");
  assert.deepEqual(errors,[]);
  console.log("Payout profile browser QA passed: tenant/entity editor isolation, late reads/saves, unchanged-profile refresh, removed selection, failure/empty distinctions and unmount (StrictMode; fictional masked data).");
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
