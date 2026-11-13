/**
 * Three real fictional logins, hydrated Chromium UI, server GET/POST,
 * source digest, unsigned PDF and revoked/foreign-employer isolation.
 * The database and browser are NEVER accessed before both hard guards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE, API, certificateUrl, assertUnsignedPdf, assertNoProtectedMarkers,
  assertDeniedResult, requireDisposableBrowserPdf, verifyBrowserPdfSources,
} from "./tenant-2316-browser-pdf-contract.mjs";

const plain = x => JSON.parse(JSON.stringify(x));
const PASSWORD = "FICTIONAL-2316-BROWSER-ONLY-SCRYPT-2026!";
const TAX_YEAR = 2026;
const SUMMARY = Object.freeze({
  grossCompensation:"10000.00", nonTaxable:"0.00", taxableIncome:"10000.00",
  taxDue:"0.00", taxWithheld:"0.00", adjustment:"0.00", mwe:false,
});
const moneyLines = () => [{ code:"WHT", amount:"0.00", label:"Withholding tax" }];
function bodyUrl(actor,worker=actor.worker,separation=actor.separation) {
  return ORIGIN + API + certificateUrl(actor,worker,separation);
}
function pageUrl(actor,worker=actor.worker,separation=actor.separation) {
  return ORIGIN + PAGE + certificateUrl(actor,worker,separation);
}
async function api(context,url,method="GET",data,extraHeaders={}) {
  assert.ok(url.startsWith(ORIGIN+API+"?"),"Only the local 2316 API may be called");
  const headers=method==="POST"?
    {origin:ORIGIN,"sec-fetch-site":"same-origin",...extraHeaders}:extraHeaders;
  const response=method==="POST"?
    await context.request.post(url,{headers,data,failOnStatusCode:false,timeout:45000}):
    await context.request.get(url,{headers,failOnStatusCode:false,timeout:45000});
  const contentType=response.headers()["content-type"]||"";
  const bytes=await response.body();
  const text=contentType.includes("application/pdf")?"":bytes.toString("utf8");
  let json=null;
  if(contentType.includes("json")){try{json=JSON.parse(text)}catch{}}
  return {status:response.status(),contentType,headers:response.headers(),text,json,bytes};
}
async function login(context,actor,generateTotp) {
  const response=await context.request.post(ORIGIN+"/api/auth/login",{
    data:{email:actor.owner.email,password:PASSWORD,totpCode:generateTotp(actor.totpSecret)},
    headers:{origin:ORIGIN,"sec-fetch-site":"same-origin"},
    failOnStatusCode:false,timeout:45000,
  });
  const status=response.status(),json=await response.json();
  assert.equal(status,200,"Real local password+TOTP login required: "+(json?.code||json?.error||status));
  assert.equal(json.user.email,actor.owner.email);
  const cookies=await context.cookies(ORIGIN);
  assert.ok(cookies.some(c=>c.name==="__Host-linaw_session"&&c.value.length>=32),
    "Browser must have a real authenticated production-mode session cookie");
  return cookies;
}

async function seedReleased(db,s,actor,worker,entity,reviewActors,nominal) {
  const [run]=await db.insert(s.payrollRuns).values({
    organizationId:actor.org.id,legalEntityId:entity.id,
    periodLabel:"Synthetic Aug 2026 "+actor.label,
    periodStart:"2026-08-01",periodEnd:"2026-08-15",
    payDate:"2026-08-15",status:"Released",
  }).returning();
  const [entry]=await db.insert(s.payrollEntries).values({
    payrollRunId:run.id,employeeId:worker.id,grossPay:"10000.00",
    deductions:"0.00",netPay:"10000.00",status:"Released",
    lineItems:moneyLines(),trace:{},
  }).returning();
  const sourceFingerprint={
    employeeLegalEntityId:entity.id,
    released:[{
      entryId:entry.id,runId:run.id,payDate:run.payDate,
      periodStart:run.periodStart,periodEnd:run.periodEnd,
      grossPay:Number(entry.grossPay),lineItems:entry.lineItems,trace:entry.trace,
    }],
  };
  const frozen={
    sourceFingerprint,
    annualization:{...SUMMARY},
    appliedTaxCollection:"0.00",unpaidTaxWithholding:"0.00",
  };
  const [separation]=await db.insert(s.separationRecords).values({
    organizationId:actor.org.id,employeeId:worker.id,
    separationType:"resignation",noticeDate:"2026-09-01",
    lastDay:"2026-09-30",status:"released",
    releasedAt:new Date("2026-09-30T12:00:00.000Z"),
    approvedAt:new Date("2026-09-29T12:00:00.000Z"),
    releaseReference:"FICTIONAL-2316-"+nominal,
    preparedByUserId:actor.owner.id,
    approvedByUserId:reviewActors[0].id,
    releasedByUserId:reviewActors[1].id,
    grossFinalPay:"0.00",netFinalPay:"0.00",taxAdjustment:"0.00",
    computationSnapshot:frozen,
  }).returning();
  assert.ok(separation.id>0&&entry.id>0&&run.id>0);
  return {separation,run,entry,frozen};
}

export async function prove2316BrowserPdf() {
  // Fail before ANY DB/Next/Playwright module import.
  requireDisposableBrowserPdf();
  verifyBrowserPdfSources();
  const [database,s,orm,fixture,browserModule,cryptoModule,totpModule,secretModule,
    governmentIdModule,certificateFixture,certificateModule,certificateServer]=await Promise.all([
      import("../../src/db/index.ts"),
      import("../../src/db/schema.ts"),
      import("drizzle-orm"),
      import("./tenant-table-http.mjs"),
      import("playwright"),
      import("../../src/lib/crypto.ts"),
      import("../../src/lib/totp.ts"),
      import("../../src/lib/security-secret.ts"),
      import("../../src/lib/government-id-crypto.ts"),
      import("../../tests/fixtures/bir-2316-certificate.ts"),
      import("../../src/lib/bir-2316-certificate.ts"),
      import("../../src/lib/bir-2316-certificate-server.ts"),
    ]);
  const {db,pool}=database;
  const {chromium}=browserModule;
  const {hashPassword}=cryptoModule;
  const {generateTotp,generateTotpSecret}=totpModule;
  const {encryptTotpSecret}=secretModule;
  const {encryptGovernmentId}=governmentIdModule;
  const {certificateReview}=certificateFixture;
  const {prepare2316Certificate}=certificateModule;
  const {load2316CertificateSource}=certificateServer;
  let browser;
  try {
    const pg16=Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg16>=160000&&pg16<170000,"Actual localhost PostgreSQL 16 required");
    assert.deepEqual(await db.select().from(s.organizations).limit(1),[],
      "Refuse pre-populated organization data");
    assert.deepEqual(await db.select().from(s.users).limit(1),[],
      "Refuse pre-populated user data");
    const nonce=randomUUID().replaceAll("-","").slice(0,10);
    const a={...(await fixture.seedEmployer("ATTA",nonce,fixture.standaloneMakeSession)),label:"A"};
    const b={...(await fixture.seedEmployer("ATTB",nonce,fixture.standaloneMakeSession)),label:"B"};
    const [otherEntity]=await db.insert(s.legalEntities).values({
      organizationId:a.org.id,code:"NOT-GRANTED-"+nonce,
      legalName:"Fictional inaccessible employer "+nonce,
      displayName:"Private fictional entity",primaryEntity:false,
      birTin:"909090909",birBranchCode:"0004",
    }).returning();
    const [otherUnit]=await db.insert(s.orgUnits).values({
      organizationId:a.org.id,legalEntityId:otherEntity.id,
      type:"department",code:"PRIVATE-"+nonce,name:"Private "+nonce,
    }).returning();
    const [otherWorker]=await db.insert(s.employees).values({
      organizationId:a.org.id,legalEntityId:otherEntity.id,orgUnitId:otherUnit.id,
      employeeNo:"2316-PRIVATE-"+nonce,firstName:"Hidden",
      lastName:"Fictional-"+nonce,title:"Synthetic",avatarInitials:"HF",
      basicRate:"20000.00",startDate:"2026-01-05",
    }).returning();
    const victim={...(await fixture.seedEmployer("VICTIM",nonce,fixture.standaloneMakeSession)),label:"Victim"};
    const actors=[a,b,victim];
    assert.equal(new Set(actors.map(x=>x.org.id)).size,3);
    for(const target of [a,b])for(const field of ["org","entity","worker","owner"])
      assert.ok(victim[field].id>target[field].id,"Genuine higher-ID victim "+field);
    assert.ok(victim.worker.id>otherWorker.id);
    const tinValues=["111222333","444555666","777888999"];
    for (let i=0;i<actors.length;i++) {
      const actor=actors[i];
      actor.totpSecret=generateTotpSecret();
      await db.update(s.users).set({
        passwordHash:hashPassword(PASSWORD),
        totpSecret:encryptTotpSecret(actor.totpSecret),
        totpEnabled:true,
      }).where(orm.eq(s.users.id,actor.owner.id));
      await db.update(s.legalEntities).set({
        birTin:tinValues[i],birBranchCode:"000"+(i+1),
      }).where(orm.eq(s.legalEntities.id,actor.entity.id));
      await db.update(s.employees).set({
        tin:encryptGovernmentId("33322211"+(i+1),{required:true}),
        tinBranchCode:encryptGovernmentId("0000",{required:true}),
        birthDate:"1990-02-03",
      }).where(orm.eq(s.employees.id,actor.worker.id));
      await db.insert(s.userLegalEntityGrants).values({
        userId:actor.owner.id,organizationId:actor.org.id,
        legalEntityId:actor.entity.id,
      });
      const staff=[];
      for(let j=0;j<2;j++){
        const [person]=await db.insert(s.users).values({
          email:"synthetic-2316-"+i+"-"+j+"-"+nonce+"@example.invalid",
          name:"Fictional 2316 checker "+i+"-"+j,
          passwordHash:"non-login-fixture",role:"hr",
        }).returning();
        await db.insert(s.userOrganizations).values({
          userId:person.id,organizationId:actor.org.id,role:"hr",active:true,
        });
        staff.push(person);
      }
      actor.reviewActors=staff;
      const receipt=await seedReleased(db,s,actor,actor.worker,actor.entity,staff,actor.label);
      actor.separation=receipt.separation;
      actor.ledger=receipt;
      assert.equal(new Set([actor.owner.id,...staff.map(x=>x.id)]).size,3);
    }
    await db.update(s.employees).set({
      tin:encryptGovernmentId("999888777",{required:true}),
      tinBranchCode:encryptGovernmentId("0000",{required:true}),
      birthDate:"1991-04-05",
    }).where(orm.eq(s.employees.id,otherWorker.id));
    const otherReceipt=await seedReleased(db,s,a,otherWorker,otherEntity,a.reviewActors,"OTHER");
    const secrets=[...actors,{
      org:a.org,entity:otherEntity,worker:otherWorker,marker:otherWorker.employeeNo,
    }];
    const formReview=certificateReview();
    formReview.detailItems["34"]="0.00";
    formReview.detailItems["35"]="0.00";
    formReview.detailItems["39"]="10000.00";
    formReview.text.categoryReference="FICTIONAL-2316-PAYROLL-LEDGER";
    formReview.text.peraReference="FICTIONAL-2316-PERA-ZERO-REVIEW";
    // Independently verify the real persisted PG16 source and all values before
    // opening Chromium. A source-less 200 or an unverified zero is not success.
    for(const actor of actors){
      const source=await load2316CertificateSource({
        organizationId:actor.org.id,employeeId:actor.worker.id,
        taxYear:TAX_YEAR,separationId:actor.separation.id,
      });
      assert.equal(source.legalEntityId,actor.entity.id);
      assert.equal(source.employerName,actor.entity.legalName);
      assert.equal(source.scope.employeeId,actor.worker.id);
      assert.equal(source.summary.taxableIncome,"10000.00");
      assert.equal(source.withholding?.actualPresentWithheld,"0.00");
      assert.equal(source.withholding?.appliedAdjustment,"0.00");
      assert.deepEqual(source.withholding?.issues,[]);
      assert.equal(source.withholding?.entryIds.length,1);
      const prepared=prepare2316Certificate(source,formReview);
      assert.equal(prepared.ok,true,"Seeded BIR mapping failed: "+prepared.issues.join(","));
    }
    const tables=[
      "organizations","legalEntities","employees","userOrganizations",
      "userLegalEntityGrants","separationRecords","yearEndPriorEvidence",
      "payrollRuns","auditEvents",
    ];
    async function snapshot(orgId) {
      const data={};
      for(const key of tables){
        const t=s[key];
        assert.ok(t?.id,"Missing real PG16 "+key);
        data[key]=plain(await db.select().from(t)
          .where(orm.eq(key==="organizations"?t.id:t.organizationId,orgId))
          .orderBy(orm.asc(t.id)));
      }
      data.payrollEntries=plain(await db.select().from(s.payrollEntries)
        .innerJoin(s.payrollRuns,orm.eq(s.payrollEntries.payrollRunId,s.payrollRuns.id))
        .where(orm.eq(s.payrollRuns.organizationId,orgId))
        .orderBy(orm.asc(s.payrollEntries.id)));
      return data;
    }
    async function freeze() {
      return new Map(await Promise.all(actors.map(async actor=>
        [actor.org.id,await snapshot(actor.org.id)])));
    }
    let baseline=await freeze();
    async function unchanged(label,allowOwnAudit=false) {
      for(const actor of actors){
        const prior=plain(baseline.get(actor.org.id));
        const after=await snapshot(actor.org.id);
        if(allowOwnAudit) {
          delete prior.auditEvents;
          delete after.auditEvents;
        }
        assert.deepEqual(after,prior,label+": protected employer, payroll or worker SQL changed");
      }
    }
    browser=await chromium.launch({headless:true});
    const contexts=[];
    for(const actor of actors){
      const context=await browser.newContext({acceptDownloads:true,
        viewport:{width:1440,height:900}});
      contexts.push(context);
      // Browser must never contact third-party hosts.
      await context.route("**/*",route=>{
        const requestUrl=new URL(route.request().url());
        return requestUrl.origin===ORIGIN?route.continue():route.abort();
      });
      await login(context,actor,generateTotp);
      actor.context=context;
    }
    // Logins deliberately write their own session/audit events.
    baseline=await freeze();
    let ownSource=0,ownPdf=0,apiDenials=0,pageDenials=0,stale=0;
    for(const actor of actors) {
      const response=await api(actor.context,bodyUrl(actor));
      assert.equal(response.status,200,"Each owner must load own nonempty PG16 2316 source");
      assert.match(response.contentType,/application\/json/);
      assert.equal(response.headers["cache-control"],"private, no-store");
      assert.equal(response.json?.source?.scope.organizationId,actor.org.id);
      assert.equal(response.json?.source?.scope.employeeId,actor.worker.id);
      assert.equal(response.json?.source?.employerName,actor.entity.legalName);
      assert.equal(response.json?.source?.withholding?.entryIds.length,1);
      assert.equal(response.json?.source?.withholding?.actualPresentWithheld,"0.00");
      assert.ok(/^[a-f0-9]{64}$/.test(response.json?.sourceDigest??""),
        "Server-issued source digest required");
      actor.digest=response.json.sourceDigest;
      ownSource++;
      assertNoProtectedMarkers(response.text,secrets.filter(s=>
        s.org.id!==actor.org.id || s.worker.id!==actor.worker.id),
        "own API only");
      await unchanged("Own source GET",true);
    }
    // Real browser navigation, hydration, source fetch, keyboard/form controls.
    const page=await a.context.newPage();
    const pageResponse=await page.goto(pageUrl(a),{
      waitUntil:"domcontentloaded",timeout:60000,
    });
    assert.equal(pageResponse?.status(),200);
    await page.getByRole("heading",{name:"Prepare an unsigned Form 2316"}).waitFor();
    assert.equal(await page.locator('input[name="employeeId"]').inputValue(),String(a.worker.id));
    assert.equal(await page.locator('input[name="taxYear"]').inputValue(),"2026");
    const sourceButton=page.getByRole("button",{name:"Load source records"});
    await sourceButton.focus();
    assert.equal(await sourceButton.evaluate(el=>el===document.activeElement),true);
    await sourceButton.click();
    await page.getByRole("heading",{name:a.marker+", Table"}).waitFor({timeout:60000});
    const summary=page.getByRole("region",{name:"Server payroll evidence"});
    assert.ok((await summary.innerText()).includes(a.entity.legalName));
    assert.ok((await summary.innerText()).includes("Posted present-employer withholding: 0.00"));
    for(const [key,value] of Object.entries(formReview.text)){
      const input=page.locator('input[name="'+key+'"]');
      assert.equal(await input.count(),1,"Real reviewer input missing: "+key);
      await input.fill(value);
    }
    for(const [key,value] of Object.entries(formReview.detailItems)){
      const input=page.locator('input[name="item'+key+'"]');
      assert.equal(await input.count(),1,"Actual numbered BIR field missing: "+key);
      await input.fill(value);
    }
    await page.locator("#certificate-employer-type").selectOption("main");
    await page.locator("#certificate-previous-employer").selectOption("none-confirmed");
    await page.locator('input[name="pera"]').fill("0.00");
    await page.getByRole("checkbox").check();
    await page.getByRole("button",{name:"Check totals and generate unsigned PDF"}).click();
    const downloadLink=page.getByRole("link",{name:"Download unsigned PDF"});
    await downloadLink.waitFor({timeout:60000});
    const downloadWait=page.waitForEvent("download",{timeout:60000});
    await downloadLink.click();
    const downloaded=await downloadWait;
    assert.equal(downloaded.suggestedFilename(),"bir-2316-unsigned-2026.pdf");
    const stream=await downloaded.createReadStream();
    assert.ok(stream,"Real in-memory browser download expected");
    const buffers=[];
    for await(const chunk of stream)buffers.push(Buffer.from(chunk));
    const downloadedBytes=Buffer.concat(buffers);
    await assertUnsignedPdf(downloadedBytes,a.entity.legalName);
    ownPdf++;
    await unchanged("Hydrated browser own PDF",true);
    const audit=await db.select().from(s.auditEvents).where(orm.and(
      orm.eq(s.auditEvents.organizationId,a.org.id),
      orm.eq(s.auditEvents.action,"Unsigned BIR 2316 preparer preview generated"),
    ));
    assert.equal(audit.length,1,"One genuinely generated preview must be audited");
    assert.equal(audit[0].metadata.unsigned,true);
    assert.ok(/^[a-f0-9]{64}$/.test(audit[0].metadata.sha256));
    assert.ok(!JSON.stringify(audit[0].metadata).includes("333222111"),
      "Never persist synthetic full employee TIN in audit");
    // Check responsive page controls in a 390px separate authenticated context.
    const mobile=await browser.newContext({viewport:{width:390,height:844}});
    contexts.push(mobile);
    await mobile.addCookies(await a.context.cookies(ORIGIN));
    await mobile.route("**/*",route=>{
      const target=new URL(route.request().url());
      return target.origin===ORIGIN?route.continue():route.abort();
    });
    const mobilePage=await mobile.newPage();
    const mobileResponse=await mobilePage.goto(pageUrl(a),{waitUntil:"domcontentloaded"});
    assert.equal(mobileResponse?.status(),200);
    await mobilePage.getByRole("button",{name:"Load source records"}).waitFor();
    const widths=await mobilePage.evaluate(()=>({
      width:window.innerWidth,scroll:document.documentElement.scrollWidth,
    }));
    assert.ok(widths.scroll<=widths.width+1,
      "Actual 390px certificate browser must not overflow horizontally");

    // Positive historical API survives a later transfer but worker-only current
    // employer access is not silently expanded.
    await db.update(s.employees).set({legalEntityId:otherEntity.id})
      .where(orm.and(orm.eq(s.employees.organizationId,a.org.id),
        orm.eq(s.employees.id,a.worker.id)));
    baseline=await freeze();
    const history=await api(a.context,bodyUrl(a));
    assert.equal(history.status,200);
    assert.equal(history.json.source.legalEntityId,a.entity.id);
    assert.equal(history.json.source.employerName,a.entity.legalName);
    const transferredPdf=await api(a.context,bodyUrl(a),"POST",{
      sourceDigest:history.json.sourceDigest,review:formReview,
    });
    assert.equal(transferredPdf.status,200,"Current employer transfer cannot erase frozen historical 2316");
    assert.match(transferredPdf.contentType,/application\/pdf/);
    await assertUnsignedPdf(transferredPdf.bytes,a.entity.legalName);
    ownPdf++;
    await unchanged("Historical PDF after transfer",true);
    const deferred=await api(a.context,ORIGIN+API+
      "?organizationId="+a.org.id+"&employeeId="+a.worker.id+"&taxYear=2026");
    assert.equal(deferred.status,409,"Multi-entity worker-only API must defer annual certificate");
    assert.equal(deferred.json?.code,"ENTITY_YEAR_END_DEFERRED");

    // A genuine previous source token may NOT be used after an actual bound
    // annualization source change (source digest invalidation, not a fake UUID).
    const oldFrozen=b.ledger.frozen;
    const changed={...oldFrozen,annualization:{...oldFrozen.annualization,
      grossCompensation:"20000.00",taxableIncome:"20000.00"}};
    await db.update(s.separationRecords).set({computationSnapshot:changed})
      .where(orm.eq(s.separationRecords.id,b.separation.id));
    baseline=await freeze();
    const staleResponse=await api(b.context,bodyUrl(b),"POST",{
      sourceDigest:b.digest,review:formReview,
    });
    assert.equal(staleResponse.status,409,"Changed source must invalidate a real earlier digest");
    assert.equal(staleResponse.json?.code,"CERTIFICATE_SOURCE_CHANGED");
    stale++;
    await unchanged("Stale source digest refused");
    await db.update(s.separationRecords).set({computationSnapshot:oldFrozen})
      .where(orm.eq(s.separationRecords.id,b.separation.id));
    baseline=await freeze();

    const incomplete=await api(a.context,bodyUrl(a),"POST",{
      sourceDigest:history.json.sourceDigest,
      review:{...formReview,acknowledged:false},
    });
    assert.equal(incomplete.status,422,"Unacknowledged mapping must not generate PDF");
    assert.ok(incomplete.json?.issues?.includes("REVIEW_ACKNOWLEDGEMENT_REQUIRED"));
    const forged=await api(a.context,bodyUrl(a),"POST",{
      sourceDigest:"0".repeat(64),review:formReview,
    });
    assert.equal(forged.status,409,"Forged digest must not render PDF");
    assert.equal(forged.json?.code,"CERTIFICATE_SOURCE_CHANGED");
    const crossSite=await api(a.context,bodyUrl(a),"POST",{
      sourceDigest:history.json.sourceDigest,review:formReview,
    },{"origin":"https://evil.example.invalid","sec-fetch-site":"cross-site"});
    assert.equal(crossSite.status,403,"Browser cross-site POST must be rejected");
    await unchanged("Invalid review/digest/origin requests");

    async function denied(context,url,label,isPost=false,review=formReview) {
      const response=await api(context,url,isPost?"POST":"GET",
        isPost?{sourceDigest:history.json.sourceDigest,review}:undefined);
      assertDeniedResult(response,secrets,label);
      apiDenials++;
      await unchanged(label);
    }
    for(const attacker of [a,b]){
      await denied(attacker.context,bodyUrl(victim),"Other employer GET");
      await denied(attacker.context,bodyUrl(victim),"Other employer POST",true);
      await denied(attacker.context,bodyUrl({
        ...attacker,worker:victim.worker,separation:victim.separation,
      }),"Forged worker under own employer");
    }
    await denied(a.context,bodyUrl(a,otherWorker,otherReceipt.separation),
      "Same-parent ungranted worker GET");
    await denied(a.context,bodyUrl(a,otherWorker,otherReceipt.separation),
      "Same-parent ungranted worker POST",true);
    const deniedPage=await page.goto(pageUrl(victim),{waitUntil:"domcontentloaded"});
    assert.equal(deniedPage?.status(),404);
    assertNoProtectedMarkers(await page.content(),[victim],
      "Browser foreign worker 404");
    pageDenials++;
    await unchanged("Foreign browser navigation");

    // Active session stays valid after frozen legal employer grant revocation.
    const revoked=await db.delete(s.userLegalEntityGrants).where(orm.and(
      orm.eq(s.userLegalEntityGrants.userId,a.owner.id),
      orm.eq(s.userLegalEntityGrants.organizationId,a.org.id),
      orm.eq(s.userLegalEntityGrants.legalEntityId,a.entity.id),
    )).returning({id:s.userLegalEntityGrants.id});
    assert.equal(revoked.length,1);
    baseline=await freeze();
    await denied(a.context,bodyUrl(a),"Revoked frozen employer GET");
    await denied(a.context,bodyUrl(a),"Revoked frozen employer POST",true);
    const revokedPage=await page.goto(pageUrl(a),{waitUntil:"domcontentloaded"});
    assert.equal(revokedPage?.status(),404);
    pageDenials++;
    await unchanged("Revoked grant browser denial");

    const membership=await db.update(s.userOrganizations).set({active:false})
      .where(orm.and(orm.eq(s.userOrganizations.userId,b.owner.id),
        orm.eq(s.userOrganizations.organizationId,b.org.id),
        orm.eq(s.userOrganizations.active,true)))
      .returning({id:s.userOrganizations.id});
    assert.equal(membership.length,1);
    baseline=await freeze();
    await denied(b.context,bodyUrl(b),"Revoked membership GET");
    await denied(b.context,bodyUrl(b),"Revoked membership POST",true);
    const bPage=await b.context.newPage();
    const revokedMembershipPage=await bPage.goto(pageUrl(b),{waitUntil:"domcontentloaded"});
    assert.equal(revokedMembershipPage?.status(),404);
    pageDenials++;
    await unchanged("Revoked membership browser denial");

    const result={
      kind:"form2316-hydrated-browser-api-unsigned-pdf",
      fictionalEmployerOwners:3,realPasswordTotpLogins:3,
      ownApiSources:ownSource,ownPdfDownloads:ownPdf,
      browserDownloadedPdf:true,completeMappedForm:true,
      realNonzeroPayrollItem39:true,
      forgedOrForeignApiDenials:apiDenials,
      deniedBrowserNavigations:pageDenials,
      realSourceDigestRevocation:stale,
      priorSourceImmutableHistoryAfterTransfer:true,
      sameParentUngrantableWorkerDenied:true,
      revokedGrantAndMembershipDenied:true,
      databaseSnapshotTables:tables.length+1,
      pageCredits:0,apiMethodCredits:0,
      independentSecurityReview:"PENDING",productionCertified:false,
    };
    console.log("TENANT_2316_BROWSER_PDF_COMPLETE "+JSON.stringify(result));
    return result;
  } finally {
    if(browser)await browser.close();
    await pool.end();
  }
}
if(process.argv[1]?.replaceAll("\\","/").endsWith(
  "scripts/qa/tenant-2316-browser-pdf-http.mjs")) {
  prove2316BrowserPdf().catch(error=>{
    console.error("TENANT_2316_BROWSER_PDF_FAILED "+
      (error instanceof Error?error.stack:String(error)));
    process.exitCode=1;
  });
}
