/**
 * Prior-employer review: synthetic real HTTP + hydrated client action boundary.
 * Uses only the existing disposable PG16 / localhost Chromium CI job after
 * the independent Form 2316 browser proof. No method/page credit is awarded.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  requireDisposableBrowserPdf, verifyBrowserPdfSources,
} from "./tenant-2316-browser-pdf-contract.mjs";
import { verifyPriorWorkerSource } from "./tenant-prior-review-worker-contract.mjs";

// Refuse unsafe DB/provider targets BEFORE application and database imports.
requireDisposableBrowserPdf();
verifyBrowserPdfSources();
verifyPriorWorkerSource();

const [{ db, pool }, s, orm, { seedEmployer, standaloneMakeSession, standaloneRequest }, { chromium }] =
  await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("playwright"),
  ]);
const ORIGIN = "http://localhost:3000";
const TAX_YEAR = 2026;
const uuid = randomUUID().slice(0, 8);

const scopeFor = (orgId, workerId) =>
  "/api/year-end/prior-evidence?organizationId=" + orgId +
  "&employeeId=" + workerId + "&taxYear=" + TAX_YEAR;
const pageFor = (orgId, workerId) =>
  ORIGIN + "/workspace/prior-employer?organizationId=" + orgId +
  "&employeeId=" + workerId + "&taxYear=" + TAX_YEAR;
const evidence = label => ({
  status: "verified",
  employerName: "Fictional Previous Employer " + label,
  employerTin: "123456789-0000",
  periodFrom: "2025-01-01",
  periodTo: "2025-12-31",
  taxableIncome: "100000.00",
  taxWithheld: "10000.00",
  exemptBenefits: "0.00",
  sourceReference: "private:fictional-prior-" + label,
  sourceSha256: "a".repeat(64),
  peraCredit: "0.00",
  peraReference: "",
  peraSha256: "",
});

async function prove() {
  const v = await pool.query("SHOW server_version_num");
  assert.equal(Math.floor(Number(v.rows[0].server_version_num) / 10000), 16,
    "Only disposable PostgreSQL 16 is permitted");
  // Existing 2316 browser proof may have already seeded its own fictional rows:
  // identify all of this test's employers by new random names, not by IDs.
  const actors = [];
  for (const label of ["ATTA", "ATTB", "VICTIM"]) {
    const actor = await seedEmployer(label, uuid, standaloneMakeSession);
    await db.insert(s.userLegalEntityGrants).values({
      organizationId: actor.org.id, userId: actor.owner.id,
      legalEntityId: actor.entity.id,
    });
    actors.push(actor);
  }
  const [ownerA, ownerB, actualVictim] = actors;
  assert.ok(actualVictim.org.id > ownerA.org.id && actualVictim.org.id > ownerB.org.id);
  assert.ok(actualVictim.worker.id > ownerA.worker.id &&
    actualVictim.worker.id > ownerB.worker.id,
    "Use genuinely persisted higher-ID victim worker, not an invented number");

  // Independent same-employer checker, not a second session for the maker.
  const [checker] = await db.insert(s.users).values({
    email: "prior-checker-" + uuid + "@example.invalid",
    name: "Fictional Independent Checker " + uuid,
    role: "owner", passwordHash: "fictional-only", totpEnabled: true,
  }).returning();
  await db.insert(s.userOrganizations).values({
    userId: checker.id, organizationId: ownerA.org.id, role: "owner", active: true,
  });
  await db.insert(s.userLegalEntityGrants).values({
    userId: checker.id, organizationId: ownerA.org.id, legalEntityId: ownerA.entity.id,
  });
  const checkerSession = await standaloneMakeSession(checker.id);
  await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
    .where(orm.eq(s.sessions.id, checkerSession.id));

  // Same-parent legal entity deliberately NOT granted to owner A.
  const [otherEntity] = await db.insert(s.legalEntities).values({
    organizationId: ownerA.org.id, code: "OTHER-" + uuid,
    displayName: "Restricted " + uuid, legalName: "Restricted Employer " + uuid,
    primaryEntity: false,
  }).returning();
  const [otherUnit] = await db.insert(s.orgUnits).values({
    organizationId: ownerA.org.id, legalEntityId: otherEntity.id, type: "department",
    code: "UNIT-" + uuid, name: "Restricted Unit " + uuid,
  }).returning();
  const [ungrantedWorker] = await db.insert(s.employees).values({
    organizationId: ownerA.org.id, legalEntityId: otherEntity.id, orgUnitId: otherUnit.id,
    employeeNo: "UNGRANTED-PRIOR-" + uuid,
    firstName: "Restricted", lastName: "Tax Marker", title: "Fictional",
    avatarInitials: "RT", basicRate: "20000.00", startDate: "2026-01-05",
  }).returning();
  assert.ok(ungrantedWorker.id > ownerA.worker.id);

  const tables = [
    ["organizations", s.organizations], ["legalEntities", s.legalEntities],
    ["employees", s.employees], ["userLegalEntityGrants", s.userLegalEntityGrants],
    ["userOrganizations", s.userOrganizations], ["yearEndPriorEvidence", s.yearEndPriorEvidence],
    ["separationRecords", s.separationRecords], ["payrollRuns", s.payrollRuns],
    ["auditEvents", s.auditEvents],
  ];
  async function snapshot(orgId) {
    const result = {};
    for (const [name, table] of tables) result[name] = await db.select()
      .from(table).where(orm.eq(table.organizationId, orgId))
      .orderBy(table.id ?? table.organizationId);
    return result;
  }
  async function request(path, cookie, method="GET", body) {
    const response = await standaloneRequest(path, { cookie, method, body });
    const cache = response.headers.get("cache-control") ?? "";
    assert.doesNotMatch(cache, /\bpublic\b/i,
      "No response may advertise the private prior tax source as publicly cacheable");
    if (response.status === 200 || response.status === 409)
      assert.match(cache, /no-store/i,
        "Private prior evidence and source-error bodies must not be cached");
    return response;
  }
  const allProtected = await Promise.all(actors.map(actor => snapshot(actor.org.id)));
  async function victimsUnchanged(label) {
    const now = await Promise.all(actors.map(actor => snapshot(actor.org.id)));
    assert.deepEqual(now[2], allProtected[2], label + ": genuine victim SQL mutated");
  }
  let browser;
  try {
    let ownSaves = 0, ownLoads = 0, denied = 0, browserActions = 0;
    const initialA = evidence("A-" + uuid), initialB = evidence("B-" + uuid);
    for (const [actor, input] of [[ownerA, initialA], [ownerB, initialB]]) {
      const save = await request(scopeFor(actor.org.id, actor.worker.id),
        actor.cookie, "POST", { action: "save", evidence: input, expectedDigest: "" });
      assert.equal(save.status, 200, "Own real prior-evidence POST must save a nonempty draft");
      assert.equal(save.json?.record?.saved, true);
      ownSaves++;
      const load = await request(scopeFor(actor.org.id, actor.worker.id), actor.cookie);
      assert.equal(load.status, 200);
      assert.equal(load.json?.record?.revision, 1);
      assert.equal(load.json?.record?.approved, false);
      assert.equal(load.json?.record?.evidence?.employerName, input.employerName);
      assert.match(load.json?.record?.digest ?? "", /^[a-f0-9]{64}$/);
      ownLoads++;
      assert.ok(!load.text.includes(actualVictim.worker.employeeNo));
      await victimsUnchanged("Own evidence lifecycle");
    }

    const sameMaker = await request(scopeFor(ownerA.org.id, ownerA.worker.id),
      ownerA.cookie, "POST", {
        action: "approve", expectedDigest: (await request(
          scopeFor(ownerA.org.id, ownerA.worker.id), ownerA.cookie)).json.record.digest,
      });
    assert.equal(sameMaker.status, 409,
      "Maker may not be their own checker");
    denied++;

    const otherOrg = await request(scopeFor(ownerB.org.id, ownerB.worker.id), ownerA.cookie);
    assert.ok([403,404].includes(otherOrg.status),
      "Real foreign-employer source must be refused");
    assert.ok(!otherOrg.text.includes(initialB.employerName));
    denied++;
    const sameParent = await request(
      scopeFor(ownerA.org.id, ungrantedWorker.id), ownerA.cookie);
    assert.equal(sameParent.status, 409,
      "Real same-parent ungranted worker must not yield private prior tax evidence");
    assert.ok(!sameParent.text.includes(ungrantedWorker.employeeNo));
    denied++;
    await victimsUnchanged("Cross-employer and same-parent denial");

    // Hydrated browser uses one actual persisted session but does not claim
    // a real password/TOTP login; that proof belongs to independent browser QA.
    browser = await chromium.launch({headless:true});
    const context = await browser.newContext({viewport:{width:1280,height:800}});
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return url.origin === ORIGIN ? route.continue() : route.abort();
    });
    await context.addCookies([{
      name: "__Host-linaw_session", value: ownerA.cookie.split("=")[1],
      url: ORIGIN, httpOnly: true, secure: true, sameSite: "Lax",
    }]);
    const page = await context.newPage();
    const response = await page.goto(pageFor(ownerA.org.id,ownerA.worker.id),
      {waitUntil:"domcontentloaded",timeout:60000});
    assert.equal(response?.status(),200,"Own selected prior-employer SSR must mount");
    await page.getByRole("heading",{name:"Previous employer & PERA review"}).waitFor();
    await page.getByRole("button",{name:"Load evidence"}).click();
    await page.getByText("Current source loaded.").waitFor({timeout:60000});
    assert.equal(await page.getByLabel("Previous employer registered name").inputValue(),
      initialA.employerName);
    browserActions++;
    const revisedName = "Fictional Browser Revised " + uuid;
    await page.getByLabel("Previous employer registered name").fill(revisedName);
    await page.getByRole("button",{name:"Save draft / revision"}).click();
    await page.getByText("Draft saved. A different payroll operator must approve this exact source.")
      .waitFor({timeout:60000});
    browserActions++;
    let latest = await request(scopeFor(ownerA.org.id,ownerA.worker.id),ownerA.cookie);
    assert.equal(latest.status,200);
    assert.equal(latest.json.record.revision,2);
    assert.equal(latest.json.record.approved,false);
    assert.equal(latest.json.record.evidence.employerName,revisedName);
    assert.ok(!latest.text.includes(initialB.employerName));

    // Approval must be a different persisted authorized user, bound to the
    // current hash after the UI revision; a stale digest cannot be reused.
    const stale = await request(scopeFor(ownerA.org.id,ownerA.worker.id),
      ownerA.cookie,"POST",{
        action:"save",evidence:initialA,expectedDigest:"0".repeat(64),
      });
    assert.equal(stale.status,409);
    denied++;
    const check = await request(scopeFor(ownerA.org.id,ownerA.worker.id),
      checkerSession.cookie,"POST",{
        action:"approve",expectedDigest:latest.json.record.digest,
      });
    assert.equal(check.status,200,"Independent actual checker must approve revised source");
    const approved = await request(scopeFor(ownerA.org.id,ownerA.worker.id),ownerA.cookie);
    assert.equal(approved.status,200);
    assert.equal(approved.json.record.approved,true);
    assert.equal(approved.json.record.revision,2);
    assert.equal(approved.json.record.evidence.employerName,revisedName);
    await page.getByRole("button",{name:"Load evidence"}).click();
    await page.getByText("Current source loaded.").waitFor({timeout:60000});
    assert.ok((await page.locator("main.prior-review").innerText()).includes("Approved"));
    browserActions++;
    await victimsUnchanged("Hydrated revision and independent checker");

    const deniedPage = await context.newPage();
    const bad = await deniedPage.goto(pageFor(ownerA.org.id,ungrantedWorker.id),
      {waitUntil:"domcontentloaded",timeout:60000});
    assert.equal(bad?.status(),404,"Foreign same-parent worker must not mount prior UI");
    assert.ok(!(await deniedPage.content()).includes(revisedName));
    denied++;

    // Revoke the maker's real legal-entity grant while keeping their session.
    const deleted = await db.delete(s.userLegalEntityGrants).where(orm.and(
      orm.eq(s.userLegalEntityGrants.organizationId,ownerA.org.id),
      orm.eq(s.userLegalEntityGrants.userId,ownerA.owner.id),
      orm.eq(s.userLegalEntityGrants.legalEntityId,ownerA.entity.id),
    )).returning({id:s.userLegalEntityGrants.id});
    assert.equal(deleted.length,1);
    const revoked = await request(scopeFor(ownerA.org.id,ownerA.worker.id),ownerA.cookie);
    assert.notEqual(revoked.status,200,"Revoked entity grant cannot read approved tax data");
    assert.ok(!revoked.text.includes(revisedName));
    denied++;
    const revokedPage = await context.newPage();
    const refused = await revokedPage.goto(pageFor(ownerA.org.id,ownerA.worker.id),
      {waitUntil:"domcontentloaded",timeout:60000});
    assert.equal(refused?.status(),404);
    denied++;
    await victimsUnchanged("Revoked grant");

    assert.ok(denied>=6 && ownSaves===2 && ownLoads===2 && browserActions===3,
      "All source lifecycle and foreign-denial checks must execute");
    const result = {
      family:"prior-evidence-hydrated-actions-real-api-pg16",
      independentEmployerOwners:3,genuineHigherIdVictim:true,
      ownSavePositives:ownSaves,ownSourceLoads:ownLoads,hydratedBrowserActions:browserActions,
      rejectedForeignOrStaleActions:denied,
      exactDigestRevisionAndIndependentChecker:true,
      revokedLegalEmployerDenied:true,protectedSqlTables:tables.length,
      realProviderCalls:0,pageActionCredits:0,apiMethodCredits:0,
      independentSecurityReview:"PENDING",productionCertified:false,
    };
    console.log("TENANT_PRIOR_EVIDENCE_ACTION_COMPLETE "+JSON.stringify(result));
    return result;
  } finally {
    if(browser) await browser.close();
    await pool.end();
  }
}
prove().catch(error => {
  console.error("TENANT_PRIOR_EVIDENCE_ACTION_FAILED " +
    (error instanceof Error ? error.stack : String(error)));
  process.exitCode=1;
});
