import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

/** Fictional browser acceptance; no actual device, biometric capture or payroll. */
const base = "http://127.0.0.1:3000";
const offBase = "http://127.0.0.1:3001";
assert.equal(process.env.CI,"true");
assert.equal(process.env.GITHUB_ACTIONS,"true");
assert.equal(process.env.OFFLINE_CLAIM_CONNECTED_MODE,"isolated-ci-only");
assert.equal(process.env.QA_URL,base);
assert.equal(process.env.FACE_OFFLINE_PUNCH_UI_ENABLED,"true");
const db = new URL(process.env.DATABASE_URL ?? "");
assert.equal(db.hostname,"127.0.0.1");
assert.equal(db.pathname,"/app_db");
const fixture = JSON.parse(readFileSync("qa-artifacts/.offline-claims-synthetic-auth.json","utf8"));
assert.ok(fixture.password && fixture.employeeEmail && fixture.hrEmail);

mkdirSync("qa-artifacts",{recursive:true});
const checks = [];
const widths = [320,375,390,430];
const reportPath = "qa-artifacts/offline-claims-mobile-acceptance.json";
let result = "BLOCKED", failure = "none";
const browser = await chromium.launch({headless:true,args:[
  "--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream",
]});
let employeeState;
let hrState;
const login = async (context,email) => {
  const r = await context.request.post(base + "/api/auth/login",{
    data:{email,password:fixture.password},
    headers:{origin:base,"sec-fetch-site":"same-origin"},
  });
  assert.equal(r.status(),200,"Fictional browser login must use the real route");
};
const assertModalFits = async (page,width) => {
  const bounds = await page.getByRole("dialog",{name:"Web Bundy Time Clock"}).evaluate(el => {
    const r=el.getBoundingClientRect();
    const viewportWidth=document.documentElement.clientWidth;
    return {left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),viewportWidth};
  });
  assert.ok(bounds.left>=-2 && bounds.right<=width+2,
    "Offline time clock must stay inside narrow viewport: "+width+"; "+JSON.stringify(bounds));
};
async function employeeAt(width) {
  const context=await browser.newContext({
    viewport:{width,height:844},timezoneId:"Asia/Manila",
    ...(employeeState?{storageState:employeeState}:{}),
  });
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(String(error.message).slice(0,120)));
  try {
    if(!employeeState) {
      await login(context,fixture.employeeEmail);
      employeeState=await context.storageState();
    }
    await page.goto(base+"/app",{waitUntil:"domcontentloaded"});
    await page.getByRole("button",{name:"Open time clock"}).waitFor({timeout:60000});
    await page.getByRole("button",{name:"Open time clock"}).click();
    await page.getByRole("heading",{name:"Camera preview and offline attendance claims"}).waitFor({timeout:20000});
    await assertModalFits(page,width);
    const consent=page.getByRole("checkbox",{name:/I consent to an on-device camera preview/});
    assert.equal(await consent.isChecked(),false,"Consent is never preselected");
    assert.equal(await page.getByRole("button",{name:"Open camera preview"}).isDisabled(),true);
    await consent.check();

    // Explicitly test both the accessible denial fallback and an ephemeral fake
    // camera stream. No frame is recorded, uploaded, hashed or retained.
    if(width===320){
      await context.grantPermissions([],{origin:base});
      await page.getByRole("button",{name:"Open camera preview"}).click();
      await page.getByText(/You may continue without camera/).waitFor({timeout:15000});
      checks.push("320px camera denied; accessible manual fallback");
    }
    if(width===390) {
      await context.grantPermissions(["camera"],{origin:base});
      await page.getByRole("button",{name:"Open camera preview"}).click();
      await page.getByText(/Camera preview ready. No photos recorded/).waitFor({timeout:20000});
      await page.getByRole("button",{name:"Stop camera"}).click();
      assert.equal(await page.getByRole("button",{name:"Stop camera"}).count(),0);
      checks.push("390px fictional camera preview stopped; no photo stored");
    }

    if(width===375){
      await context.setOffline(true);
      await page.getByRole("button",{name:"Queue claimed clock-in"}).waitFor({timeout:15000});
      await page.getByRole("button",{name:"Queue claimed clock-in"}).click();
      const entry=await page.evaluate(key=>{
        const raw=localStorage.getItem(key);
        return raw?JSON.parse(raw):[];
      },"linaw-unverified-offline-claims-v1:"+fixture.organizationId+":"+fixture.employeeId);
      assert.equal(entry.length,1);
      assert.deepEqual(Object.keys(entry[0]).sort(),["actionType","claimedAt","clientEventId"],
        "Only unverified event metadata can be saved on the device");
      assert.equal(entry[0].actionType,"clock_in");
      await context.setOffline(false);
      await page.getByRole("button",{name:"Send queued claims for HR review"}).waitFor({timeout:15000});
      await page.getByRole("button",{name:"Send queued claims for HR review"}).click();
      await page.getByText(/Submitted for independent HR review/).waitFor({timeout:20000});
      checks.push("375px disconnected claim persists locally and submits once on reconnect");
    }
    assert.deepEqual(errors,[],"Unhandled browser errors at "+width+"px");
    await page.screenshot({path:"qa-artifacts/offline-claims-employee-"+width+".png"});
    checks.push("employee modal, explicit consent, no horizontal dialog overflow at "+width+"px");
  } finally { await context.close(); }
}
async function hrReview() {
  const context=await browser.newContext({
    viewport:{width:390,height:844},timezoneId:"Asia/Manila",
    ...(hrState?{storageState:hrState}:{}),
  });
  const page=await context.newPage();
  try {
    if(!hrState){
      await login(context,fixture.hrEmail);
      hrState=await context.storageState();
    }
    await page.goto(base+"/app?organizationId="+fixture.organizationId,
      {waitUntil:"domcontentloaded"});
    await page.getByRole("button",{name:"Open navigation"}).click();
    await page.locator('button[data-nav-name="Time & attendance"]:visible').first().click();
    await page.getByRole("heading",{name:"Unverified offline punch claims"}).waitFor({timeout:30000});
    const queue=page.getByRole("article",{name:"Offline attendance claim reviewer queue"});
    await queue.getByRole("button",{name:/Review claim #/}).first().click();
    await page.getByRole("textbox",{name:"Reviewer evidence and rationale"})
      .fill("Fictional HR reviewer: offline claim requires normal correction workflow.");
    await page.getByRole("button",{name:"Flag for HR correction"}).click();
    await page.getByText(/Flagged for a governed attendance correction/).waitFor({timeout:20000});
    await page.screenshot({path:"qa-artifacts/offline-claims-hr-390.png"});
    checks.push("390px real HR session reviews disconnected employee claim; no automatic punch");
  } finally { await context.close(); }
}
async function flagOffComparison() {
  const disabledGet=await fetch(offBase+"/api/attendance/offline-claims?organizationId="+fixture.organizationId);
  assert.equal(disabledGet.status,404);
  const disabledPost=await fetch(offBase+"/api/attendance/offline-claims",{
    method:"POST",headers:{origin:offBase,"content-type":"application/json"},body:"{}",
  });
  assert.equal(disabledPost.status,404);
  const context=await browser.newContext({
    viewport:{width:375,height:844},timezoneId:"Asia/Manila",storageState:employeeState,
  });
  try{
    const page=await context.newPage();
    await page.goto(offBase+"/app",{waitUntil:"domcontentloaded"});
    await page.getByRole("button",{name:"Open time clock"}).waitFor({timeout:60000});
    await page.getByRole("button",{name:"Open time clock"}).click();
    await page.getByRole("dialog",{name:"Web Bundy Time Clock"}).waitFor({timeout:15000});
    assert.equal(await page.getByRole("heading",{name:"Camera preview and offline attendance claims"}).count(),0);
    checks.push("default-OFF route 404 and employee UI absent without widening other features");
  }finally{await context.close();}
}
try {
  for(const width of widths)await employeeAt(width);
  await hrReview();
  await flagOffComparison();
  result="PASS";
} catch(err) {
  failure=err instanceof Error ? err.name : "BROWSER_ACCEPTANCE_FAILED";
  throw err;
} finally {
  await browser.close();
  writeFileSync(reportPath,JSON.stringify({
    kind:"offline-claim-Chromium-fictional-employee-HR-acceptance",
    sourceSha:process.env.PR_HEAD_SHA ?? process.env.GITHUB_SHA ?? "local",
    githubRunId:process.env.GITHUB_RUN_ID ?? "local",
    result,failureCode:failure,widths,checks,
    mode:"synthetic-local-Chromium-not-a-physical-device",
    camera:"ephemeral-preview-no-images-saved",
    actualPayrollOrTimePunchWrite:false,
    independentHumanUat:"NOT_RUN",physicalDeviceUat:"NOT_RUN",
    productionActivation:"PROHIBITED",
  },null,2)+"\n");
}
