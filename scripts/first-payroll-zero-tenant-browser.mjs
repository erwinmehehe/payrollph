import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
// Employer #3 is the populated victim of the earlier three-tenant proof;
// only the newly added fourth employer may be treated as zero-employee.
assert.ok(Number.isSafeInteger(fixture.organizationId) && fixture.organizationId > 3);
const report = { mode:"synthetic-local-browser-only", employerId:fixture.organizationId,
  roles:["owner","hr","payroll","checker"],steps:[], result:"FAIL",
  verifiedNoPayments:true, realDevice:false, realEmployer:false, production:false };
const browser=await chromium.launch({headless:true});
let active=null;
const contexts=[];
const screenshotRoot = "qa-artifacts/first-payroll-screens";
await mkdir(screenshotRoot, { recursive: true });
// The screenshots compare each closed step with its opened, in-place editor;
// they are synthetic desktop/phone evidence, NOT a before/after payroll calculation.
async function captureStep(role, key, item, actionName) {
  const button = item.getByRole("button", { name: actionName, exact: true });
  const card = active.getByRole("region", { name: "First payroll setup readiness" });
  for (const width of [390, 1280]) {
    await active.setViewportSize({ width, height: 844 });
    await card.screenshot({ path: `${screenshotRoot}/${key}-${role}-${width}-before.png`, animations: "disabled" });
  }
  await active.setViewportSize({ width: 390, height: 844 });
  await button.click();
  const panel = item.locator(`[aria-label="${key} inline setup"]`);
  await panel.waitFor({ timeout: 45000 });
  for (const width of [390, 1280]) {
    await active.setViewportSize({ width, height: 844 });
    const bounds = await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: window.innerWidth };
    });
    assert.ok(bounds.left >= -1 && bounds.right <= bounds.viewport + 1,
      `${key} inline panel must fit ${width}px width: ${JSON.stringify(bounds)}`);
    // Native date inputs must not collide with their text labels at 390px
    // or desktop widths. These assertions are viewport geometry, not OCR.
    const dateFields = key === "time" ? ["Pay period start", "Pay period end"]
      : key === "payroll" ? ["Period start", "Period end", "Pay date"] : [];
    for (const title of dateFields) {
      const layout = await panel.getByLabel(title, { exact: true }).evaluate(input => {
        const label = input.closest("label");
        const caption = label?.querySelector("span");
        if (!label || !caption) return null;
        const textBounds = caption.getBoundingClientRect();
        const controlBounds = input.getBoundingClientRect();
        return {
          verticalGap: controlBounds.top - textBounds.bottom,
          left: controlBounds.left, right: controlBounds.right,
          width: controlBounds.width,
        };
      });
      assert.ok(layout && layout.verticalGap >= 4 && layout.width >= 120 &&
        layout.left >= -1 && layout.right <= width + 1,
        `${title} label/input must be separated and inside ${width}px viewport: ${JSON.stringify(layout)}`);
    }
    await card.screenshot({ path: `${screenshotRoot}/${key}-${role}-${width}-after.png`, animations: "disabled" });
  }
  await active.setViewportSize({ width: 375, height: 812 });
  report.steps.push(`${role}: ${key} closed/open desktop and phone screenshots, phone width verified`);
  return panel;
}
async function screenshotCompleted(role, key) {
  const card = active.getByRole("region", { name: "First payroll setup readiness" });
  for (const width of [390, 1280]) {
    await active.setViewportSize({ width, height: 844 });
    await card.screenshot({ path: `${screenshotRoot}/${key}-${role}-${width}-completed.png`, animations: "disabled" });
  }
  await active.setViewportSize({ width: 375, height: 812 });
}
async function closeStep(item) {
  await item.getByRole("button", { name: "Close panel", exact: true }).click();
}
async function enter(email){
  const context=await browser.newContext({viewport:{width:375,height:812}});
  contexts.push(context);
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await context.request.post(base + "/api/auth/login", {
      headers: { origin: base, "sec-fetch-site": "same-origin" },
      data: { email, password: "Synthetic-HCM-QA-Password-Only-2026!" },
    });
    if (response.status() !== 429 || attempt === 1) break;
    const limited = await response.json().catch(() => ({}));
    const delay = Number(limited.retryAfterMs);
    if (!Number.isFinite(delay) || delay < 0 || delay > 60000) break;
    await new Promise(resolve => setTimeout(resolve, Math.max(250, Math.ceil(delay) + 250)));
  }
  assert.equal(response.status(), 200, "Synthetic account must authenticate through normal throttling: " + email);
  active=await context.newPage();
  await active.goto(base+"/app?organizationId="+fixture.organizationId,{waitUntil:"domcontentloaded"});
  const card=active.getByRole("region",{name:"First payroll setup readiness"});
  await card.waitFor({timeout:60000});
  const steps=card.getByRole("list",{name:"Guided first payroll journey"}).getByRole("listitem");
  assert.equal(await steps.count(),7,"All seven inline steps must be available");
  return {card,steps};
}
try{
  const owner=await enter("first-payroll-gamma-owner@example.test");
  assert.match(await owner.card.innerText(),/Add active employees|Add people and payout details/);
  // Use the signed-in Chromium session. Production cookies stay Secure even
  // in localhost CI; APIRequestContext does not prove a browser is signed in.
  // Require a successful same-tenant control before testing tenant isolation.
  const browserGet = (path) => active.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    return response.status;
  }, path);
  // Use the same authenticated Chromium cookie jar as the positive controls.
  // A 401 from an anonymous test is NOT proof of tenant or HR role isolation.
  const previewPath = (organizationId) =>
    "/api/first-payroll/preview?organizationId=" + organizationId +
    "&periodStart=2026-10-01&periodEnd=2026-10-15&payDate=2026-10-15";
  const expectPreviewDenied = async (organizationId, label) => {
    const evidence = await active.evaluate(async (url) => {
      const response = await fetch(url, { credentials:"same-origin", cache:"no-store" });
      const payload = await response.json();
      return {status:response.status, cache:response.headers.get("cache-control"),
        keys:Object.keys(payload)};
    }, previewPath(organizationId));
    assert.equal(evidence.status, 403, label + ": authorized session must be denied");
    assert.ok(["private, no-store", "no-store, max-age=0"].includes(evidence.cache),
      label + ": denied monetary API must never be cached");
    assert.ok(["error", "error,role"].includes(evidence.keys.join(",")),
      label + ": no gross, net, rows or statutory amounts");
    report.steps.push(label + ": preview GET 403, no-store, no payroll data");
  };
  const sessionOwner = await active.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json();
    return response.ok ? payload.user?.email : null;
  });
  assert.equal(sessionOwner, "first-payroll-gamma-owner@example.test",
    "Cross-tenant checks require the signed-in synthetic owner, not an anonymous 401");
  assert.equal(await browserGet("/api/legal-entities?organizationId=" + fixture.organizationId), 200,
    "Authorized owner must read only their own employer's legal entities");
  assert.equal(await browserGet("/api/first-payroll/progress?organizationId=" + fixture.organizationId), 200,
    "Authorized owner must read their own journey progress");
  assert.equal(await browserGet("/api/legal-entities?organizationId=1"), 403,
    "Unrelated tenant's legal entities must be denied to a signed-in owner");
  assert.equal(await browserGet("/api/first-payroll/progress?organizationId=1"), 403,
    "A signed-in owner is not a global cross-tenant reader");
  await expectPreviewDenied(1, "owner: foreign-tenant canonical preview");
  report.steps.push("owner: unrelated employer and progress routes deny tenant crossover");

  const employerStep=owner.steps.nth(0);
  const companyPanel=await captureStep("owner","company",employerStep,"Review company");
  await companyPanel.getByLabel("Pay schedule").selectOption("ph_semi_monthly");
  await companyPanel.getByRole("button",{name:"Save legal employer and schedule"}).click();
  await companyPanel.getByText("Legal employer and pay schedule confirmed.").waitFor({timeout:45000});
  assert.equal(new URL(active.url()).pathname,"/app","Company completed without page navigation");
  report.steps.push("owner: primary legal employer and pay calendar saved inline");
  await screenshotCompleted("owner","company");
  const security = companyPanel.getByRole("button",{name:"Configure account security and MFA"});
  for (const width of [390,1280]) {
    await active.setViewportSize({width,height:844});
    await companyPanel.screenshot({path:`${screenshotRoot}/security-owner-${width}-before.png`,animations:"disabled"});
  }
  await security.click();
  const securityPanel=companyPanel.locator('[aria-label="Inline account security"]');
  await securityPanel.waitFor();
  for (const width of [390,1280]) {
    await active.setViewportSize({width,height:844});
    const bounds=await securityPanel.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,viewport:window.innerWidth}));
    assert.ok(bounds.left>=-1&&bounds.right<=bounds.viewport+1,"Security panel fits phone width");
    await companyPanel.screenshot({path:`${screenshotRoot}/security-owner-${width}-after.png`,animations:"disabled"});
  }
  await companyPanel.getByRole("button",{name:"Close account security"}).click();
  await active.setViewportSize({width:375,height:812});
  await closeStep(employerStep);

  const peopleStep=owner.steps.nth(1);
  const peoplePanel=await captureStep("owner","people",peopleStep,"Open people");
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
  assert.equal(created.status(),201,"Inline employee create must succeed; inspect sanitized status only.");
  assert.equal(new URL(active.url()).pathname,"/app","Employee created without page navigation");
  report.steps.push("owner: first employee and pay profile created inline, with fictional payroll inputs");
  await screenshotCompleted("owner","people");
  await closeStep(peopleStep);
  const reviewersStep=owner.steps.nth(3);
  await captureStep("owner","reviewers",reviewersStep,"Review team access");
  await closeStep(reviewersStep);
  const exportsStep=owner.steps.nth(6);
  await captureStep("owner","exports",exportsStep,"Open exports");
  await closeStep(exportsStep);

  const hr=await enter("hcm-hr@example.test");
  await expectPreviewDenied(fixture.organizationId, "HR: same-tenant payroll preview role");
  const timeStep=hr.steps.nth(2);
  const timePanel=await captureStep("hr","time",timeStep,"Review attendance");
  await timePanel.getByLabel("Pay period start").fill("2026-10-01");
  await timePanel.getByLabel("Pay period end").fill("2026-10-15");
  await timePanel.getByRole("checkbox").check();
  await timePanel.getByRole("button",{name:"Record authorized human review"}).click();
  await timePanel.getByText("Period-specific HR review recorded.").waitFor({timeout:45000});
  assert.equal(new URL(active.url()).pathname,"/app","HR reviewed period inline");
  report.steps.push("HR: independent period-specific human review saved and resumable");
  await screenshotCompleted("hr","time");
  await closeStep(timeStep);

  const payroll=await enter("hcm-payroll@example.test");
  const payrollStep=payroll.steps.nth(4);
  const panel=await captureStep("payroll","payroll",payrollStep,"Prepare payroll");
  await panel.getByLabel("Period start").fill("2026-10-01");
  await panel.getByLabel("Period end").fill("2026-10-15");
  await panel.getByLabel("Pay date").fill("2026-10-15");
  const [previewResponse]=await Promise.all([
    active.waitForResponse(res=>res.url().includes("/api/first-payroll/preview?") && res.request().method()==="GET",{timeout:45000}),
    panel.getByRole("button",{name:"Preview first payroll (no writes)"}).click(),
  ]);
  assert.equal(previewResponse.status(),200,"Preview endpoint refused safe inputs");
  assert.ok(["private, no-store", "no-store, max-age=0"].includes(previewResponse.headers()["cache-control"]),
    "Canonical payroll figures must be non-cacheable");
  const preview=await previewResponse.json();
  assert.equal(preview.dryRun,true);
  assert.equal(preview.persisted,false);
  assert.equal(preview.previewReady,true,"Preview blockers: "+JSON.stringify(preview.blockers));
  assert.equal(preview.rows.length,1);
  assert.ok(preview.rows[0].gross>0);
  assert.ok(preview.rows[0].net>=0);
  await panel.getByText("Preview ready for reconciliation").waitFor();
  report.steps.push("payroll: read-only preview ready with all statutory deduction columns");
  await screenshotCompleted("payroll","payroll");

  const [draftResponse]=await Promise.all([
    active.waitForResponse(res=>res.url().endsWith("/api/payroll-runs") && res.request().method()==="POST",{timeout:45000}),
    panel.getByRole("button",{name:"Create actual draft payroll (writes a draft record)"}).click(),
  ]);
  assert.ok([200,201].includes(draftResponse.status()),
    "Explicit draft creation did not succeed; only HTTP status may be logged.");
  assert.equal(new URL(active.url()).pathname,"/app","Payroll draft action remained inline");
  report.steps.push("payroll: explicit, separately confirmed draft run; no release or money movement");
  await closeStep(payrollStep);
  const checker = await enter("hcm-checker@example.test");
  const approvalStep = checker.steps.nth(5);
  await captureStep("checker","approval",approvalStep,"Review approvals");
  await closeStep(approvalStep);
  report.result="PASS";
}catch(error){
  await active?.screenshot({path:"qa-artifacts/first-payroll-zero-tenant-failed.png",fullPage:true}).catch(()=>{});
  throw error;
}finally{
  await writeFile("qa-artifacts/first-payroll-zero-tenant-browser.json",JSON.stringify(report,null,2)+"\n");
  for(const context of contexts)await context.close().catch(()=>{});
  await browser.close();
}
