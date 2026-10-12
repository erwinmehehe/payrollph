import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Browser and database must remain disposable. Never run this against a live app.
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.HRIS_JOURNEY_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["127.0.0.1","localhost"].includes(dbUrl.hostname));
assert.equal(dbUrl.pathname, "/app_db");
const base = process.env.HRIS_JOURNEY_ACCEPTANCE_URL ?? "http://127.0.0.1:3000";
const baseUrl = new URL(base);
assert.ok(["127.0.0.1","localhost"].includes(baseUrl.hostname));
const fixture = JSON.parse(await readFile("qa-artifacts/first-payroll-zero-tenant.json","utf8"));
assert.equal(fixture.label,"disposable-synthetic-only");
assert.ok(Number.isSafeInteger(fixture.organizationId) && fixture.organizationId > 2);
const report = { mode:"synthetic-local-browser-only", employerId:fixture.organizationId,
  roles:["owner","hr","payroll"],steps:[], result:"FAIL",
  verifiedNoPayments:true, realDevice:false, realEmployer:false, production:false };
const browser=await chromium.launch({headless:true});
let active=null;
const contexts=[];
async function enter(email){
  const context=await browser.newContext({viewport:{width:375,height:812}});
  contexts.push(context);
  const response=await context.request.post(base+"/api/auth/login",{
    headers:{origin:base,"sec-fetch-site":"same-origin"},
    data:{email,password:"Synthetic-HCM-QA-Password-Only-2026!"},
  });
  assert.equal(response.status(),200,"Synthetic user must authenticate: "+email);
  active=await context.newPage();
  await active.goto(base+"/app?organizationId="+fixture.organizationId,{waitUntil:"domcontentloaded"});
  const card=active.getByRole("region",{name:"First payroll setup readiness"});
  await card.waitFor({timeout:60000});
  const steps=card.getByRole("list",{name:"Guided first payroll journey"}).getByRole("listitem");
  assert.equal(await steps.count(),7,"All seven inline steps must be available");
  return {card,steps};
}
try{
  const owner=await enter("first-payroll-owner@example.test");
  assert.match(await owner.card.innerText(),/Add active employees|Add people and payout details/);

  const employerStep=owner.steps.nth(0);
  await employerStep.getByRole("button",{name:"Review company"}).click();
  const companyPanel=employerStep.locator('[aria-label="company inline setup"]');
  await companyPanel.waitFor();
  await companyPanel.getByLabel("Pay schedule").selectOption("ph_semi_monthly");
  await companyPanel.getByRole("button",{name:"Save legal employer and schedule"}).click();
  await companyPanel.getByText("Legal employer and pay schedule confirmed.").waitFor({timeout:45000});
  assert.equal(new URL(active.url()).pathname,"/app","Company completed without page navigation");
  report.steps.push("owner: primary legal employer and pay calendar saved inline");

  const peopleStep=owner.steps.nth(1);
  await peopleStep.getByRole("button",{name:"Open people"}).click();
  const peoplePanel=peopleStep.locator('[aria-label="people inline setup"]');
  await peoplePanel.waitFor();
  await peoplePanel.getByRole("button",{name:"Add employee inline"}).click();
  const hire=peoplePanel.locator('section[aria-label="Add employee"]');
  await hire.waitFor();
  await hire.getByLabel("First name").fill("Synthetic");
  await hire.getByLabel("Last name").fill("Firstpay");
  await hire.getByLabel("Job title").fill("Office Staff");
  await hire.getByLabel(/BIR TIN/).fill("123456789");
  await hire.getByLabel("Bank / payout code").fill("BPI");
  await hire.getByLabel("Account number").fill("synthetic-0000012345");
  await hire.getByLabel("Monthly rate").fill("30000");
  await hire.getByLabel("Start date").fill("2026-01-01");
  await hire.getByLabel("Rest day").selectOption({label:"Sunday"});
  const [created]=await Promise.all([
    active.waitForResponse(res=>res.url().endsWith("/api/employees") && res.request().method()==="POST",{timeout:45000}),
    hire.getByRole("button",{name:/Create & onboard/}).click(),
  ]);
  assert.equal(created.status(),200,"Inline employee create: "+(await created.text()));
  assert.equal(new URL(active.url()).pathname,"/app","Employee created without page navigation");
  report.steps.push("owner: first employee and pay profile created inline, with synthetic TIN/bank");

  const hr=await enter("hcm-hr@example.test");
  const timeStep=hr.steps.nth(2);
  await timeStep.getByRole("button",{name:"Review attendance"}).click();
  const timePanel=timeStep.locator('[aria-label="time inline setup"]');
  await timePanel.waitFor();
  await timePanel.getByLabel("Pay period start").fill("2026-10-01");
  await timePanel.getByLabel("Pay period end").fill("2026-10-15");
  await timePanel.getByRole("checkbox").check();
  await timePanel.getByRole("button",{name:"Record authorized human review"}).click();
  await timePanel.getByText("Period-specific HR review recorded.").waitFor({timeout:45000});
  assert.equal(new URL(active.url()).pathname,"/app","HR reviewed period inline");
  report.steps.push("HR: independent period-specific human review saved and resumable");

  const payroll=await enter("hcm-payroll@example.test");
  const payrollStep=payroll.steps.nth(4);
  await payrollStep.getByRole("button",{name:/Prepare payroll|Open payroll run/}).click();
  const panel=payrollStep.locator('[aria-label="payroll inline setup"]');
  await panel.waitFor();
  await panel.getByLabel("Period start").fill("2026-10-01");
  await panel.getByLabel("Period end").fill("2026-10-15");
  await panel.getByLabel("Pay date").fill("2026-10-15");
  const [previewResponse]=await Promise.all([
    active.waitForResponse(res=>res.url().includes("/api/first-payroll/preview?") && res.request().method()==="GET",{timeout:45000}),
    panel.getByRole("button",{name:"Preview first payroll (no writes)"}).click(),
  ]);
  assert.equal(previewResponse.status(),200,"Preview endpoint refused safe inputs");
  const preview=await previewResponse.json();
  assert.equal(preview.dryRun,true);
  assert.equal(preview.persisted,false);
  assert.equal(preview.previewReady,true,"Preview blockers: "+JSON.stringify(preview.blockers));
  assert.equal(preview.rows.length,1);
  assert.ok(preview.rows[0].gross>0);
  assert.ok(preview.rows[0].net>=0);
  await panel.getByText("Preview ready for reconciliation").waitFor();
  report.steps.push("payroll: read-only preview ready with all statutory deduction columns");

  const [draftResponse]=await Promise.all([
    active.waitForResponse(res=>res.url().endsWith("/api/payroll-runs") && res.request().method()==="POST",{timeout:45000}),
    panel.getByRole("button",{name:"Create actual draft payroll (writes a draft record)"}).click(),
  ]);
  assert.ok([200,201].includes(draftResponse.status()),
    "Explicit draft creation refused: "+(await draftResponse.text()));
  assert.equal(new URL(active.url()).pathname,"/app","Payroll draft action remained inline");
  report.steps.push("payroll: explicit, separately confirmed draft run; no release or money movement");
  report.result="PASS";
}catch(error){
  await active?.screenshot({path:"qa-artifacts/first-payroll-zero-tenant-failed.png",fullPage:true}).catch(()=>{});
  throw error;
}finally{
  await writeFile("qa-artifacts/first-payroll-zero-tenant-browser.json",JSON.stringify(report,null,2)+"\n");
  for(const context of contexts)await context.close().catch(()=>{});
  await browser.close();
}
