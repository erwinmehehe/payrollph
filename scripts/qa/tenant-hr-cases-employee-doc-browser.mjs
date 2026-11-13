/**
 * Real fictional PG16 employee HR POST, COE document GET, and hydrated staff
 * Chromium proof. No external object PUT or actual certificate issuance.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  ORIGIN, refuseUnsafeHrEmployeeDoc, verifyHrEmployeeDocPins,
  assertOwnedDocument, assertDeniedPrivate, assertUnchanged,
} from "./tenant-hr-cases-employee-doc-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
async function http(path, cookie, method = "GET", body) {
  assert.ok(path === "/api/account" || path === "/api/hr-cases"
    || path.startsWith("/api/hr-cases?")
    || /^\/api\/documents\/[1-9][0-9]*$/.test(path), "Unapproved local HTTP target");
  const response = await fetch(ORIGIN + path, {
    method, redirect: "manual", cache: "no-store",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "POST" ? {
        origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json",
      } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Document is not JSON. */ }
  return { status: response.status, text, json, headers: response.headers };
}

export async function proveHrEmployeeDocumentsBrowser() {
  refuseUnsafeHrEmployeeDoc();
  verifyHrEmployeeDocPins();
  const [{ db, pool }, s, { and, asc, eq }, fixture, browserLib] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"), import("playwright"),
  ]);
  let browser;
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, "PostgreSQL 16 required");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const fillerEmployers = [];
    for (let i = 0; i < 7; i++)
      fillerEmployers.push(await fixture.seedEmployer(
        "HPOST-FILL" + i, nonce, fixture.standaloneMakeSession));
    // Real populated filler case/document rows keep the victim's case and COE
    // IDs above both attackers AND above the small-ID control floor. Never
    // fabricate high IDs or advance sequences without persisted records.
    for (const filler of fillerEmployers) {
      const [caseRow] = await db.insert(s.employeeHrCases).values({
        organizationId: filler.org.id, employeeId: filler.worker.id,
        createdByUserId: filler.owner.id, caseType: "coe",
        subject: "Synthetic filler COE " + filler.marker,
        description: "Fictional HR case evidence only",
        assignedRole: "hr", status: "resolved",
        slaDueAt: new Date(Date.now() + 86400000),
      }).returning({ id: s.employeeHrCases.id });
      const bytes = Buffer.from("FICTIONAL_FILLER_COE_" + filler.marker);
      await db.insert(s.documents).values({
        organizationId: filler.org.id, employeeId: filler.worker.id,
        kind: "coe", fileName: "filler-" + filler.marker + ".txt",
        mimeType: "text/plain; charset=utf-8", byteSize: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        scannedClean: true, scanNote: "PG16-only local filler",
        sourceType: "generated", sourceKey: "hr-case-coe:" + caseRow.id,
        uploadedBy: filler.owner.name, uploadedByUserId: filler.owner.id,
        content: bytes.toString("base64"), objectStorageKey: null,
      });
    }
    const actors = [];
    for (const label of ["HPOST-A", "HPOST-B", "HPOST-VICTIM"]) {
      const actor = await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession);
      const [employeeUser] = await db.insert(s.users).values({
        email: "hpost-employee-" + label.toLowerCase() + "-" + nonce + "@example.invalid",
        name: "Fictional linked worker " + label, role: "employee",
        employeeId: actor.worker.id, passwordHash: "fictional-session-only", totpEnabled: true,
      }).returning({ id: s.users.id });
      await db.insert(s.userOrganizations).values({
        userId: employeeUser.id, organizationId: actor.org.id,
        role: "employee", active: true,
      });
      const session = await fixture.standaloneMakeSession(employeeUser.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      actor.employee = { user: employeeUser, cookie: session.cookie };
      actors.push(actor);
    }
    const [a, b, victim] = actors;
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id, 6));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id, 6));
    assert.equal(new Set(actors.map(x => x.employee.cookie)).size, 3);

    async function createEvidence(actor) {
      const [general] = await db.insert(s.employeeHrCases).values({
        organizationId: actor.org.id, employeeId: actor.worker.id,
        createdByUserId: actor.owner.id, caseType: "general",
        subject: actor.marker + " approved staff case",
        description: actor.marker + " fictional internal employee request",
        assignedRole: "hr", status: "open",
        slaDueAt: new Date(Date.now() + 86400000),
      }).returning();
      await db.insert(s.employeeHrCaseMessages).values([
        { organizationId: actor.org.id, caseId: general.id,
          actorUserId: actor.owner.id, visibility: "internal",
          body: "INTERNAL-" + actor.marker },
        { organizationId: actor.org.id, caseId: general.id,
          actorUserId: actor.owner.id, visibility: "employee",
          body: "PUBLIC-" + actor.marker },
      ]);
      const [coe] = await db.insert(s.employeeHrCases).values({
        organizationId: actor.org.id, employeeId: actor.worker.id,
        createdByUserId: actor.owner.id, caseType: "coe",
        subject: actor.marker + " synthetic reviewed certificate",
        description: actor.marker + " fictional certificate source",
        assignedRole: "hr", status: "resolved",
        slaDueAt: new Date(Date.now() + 86400000),
      }).returning();
      const content = "FICTIONAL_APPROVED_COE_" + actor.marker + "_" + nonce;
      const bytes = Buffer.from(content);
      const [doc] = await db.insert(s.documents).values({
        organizationId: actor.org.id, employeeId: actor.worker.id,
        kind: "coe", fileName: "fictional-" + actor.marker + "-coe.txt",
        mimeType: "text/plain; charset=utf-8", byteSize: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        scannedClean: true, scanNote: "Synthetic PG16 fixture; no storage provider",
        sourceType: "generated", sourceKey: "hr-case-coe:" + coe.id,
        uploadedBy: actor.owner.name, uploadedByUserId: actor.owner.id,
        content: bytes.toString("base64"), objectStorageKey: null,
      }).returning();
      await db.update(s.employeeHrCases).set({ coeDocumentId: doc.id })
        .where(eq(s.employeeHrCases.id, coe.id));
      actor.general = general;
      actor.coe = coe;
      actor.document = { id: doc.id, content };
    }
    for (const actor of actors) await createEvidence(actor);
    assert.ok(victim.document.id > Math.max(a.document.id, b.document.id, 6));
    assert.ok(victim.general.id > Math.max(a.general.id, b.general.id, 6));

    const tables = ["employees", "employeeHrCases", "employeeHrCaseMessages",
      "documents", "auditEvents", "payrollRuns"];
    async function snapshot(orgId) {
      const state = {};
      for (const tableName of tables) {
        const table = s[tableName];
        state[tableName] = plain(await db.select().from(table)
          .where(eq(table.organizationId, orgId)).orderBy(asc(table.id)));
      }
      return state;
    }
    const baseline = new Map(await Promise.all(actors.map(async org =>
      [org.org.id, await snapshot(org.org.id)])));
    const victimBefore = baseline.get(victim.org.id);
    let docsAllowed = 0, docsDenied = 0, employeePosts = 0;

    for (const actor of [a, b]) {
      const own = await http("/api/documents/" + actor.document.id, actor.employee.cookie);
      assertOwnedDocument(own, actor.document.content,
        actors.filter(x => x !== actor).map(x => x.marker));
      docsAllowed++;
      const staff = await http("/api/documents/" + actor.document.id, actor.cookie);
      assertOwnedDocument(staff, actor.document.content,
        actors.filter(x => x !== actor).map(x => x.marker));
      docsAllowed++;
      for (const foreign of actors.filter(x => x !== actor)) {
        const blocked = await http("/api/documents/" + foreign.document.id, actor.employee.cookie);
        assertDeniedPrivate(blocked, 404, [foreign.marker], "Foreign employee COE download");
        const deniedStaff = await http("/api/documents/" + foreign.document.id, actor.cookie);
        assertDeniedPrivate(deniedStaff, 404, [foreign.marker], "Foreign staff COE download");
        docsDenied += 2;
        assertUnchanged(baseline.get(foreign.org.id),
          await snapshot(foreign.org.id), "Denied foreign COE, case, payroll and audit");
      }
      const ownBefore = await snapshot(actor.org.id);
      const forged = await http("/api/hr-cases", actor.employee.cookie, "POST", {
        caseType: "general", subject: actor.marker + " new private request",
        description: actor.marker + " employee-only synthetic description",
        organizationId: victim.org.id, employeeId: victim.worker.id,
        createdByUserId: victim.owner.id, assignedRole: "payroll",
      });
      assert.equal(forged.status, 201, "Linked employee POST must create a real own case");
      assert.equal(forged.json?.case?.organizationId, actor.org.id,
        "Forged employer must never select victim");
      assert.equal(forged.json?.case?.employeeId, actor.worker.id,
        "Forged worker must never select victim");
      assert.equal(forged.json?.case?.createdByUserId, actor.employee.user.id);
      assert.equal(forged.json?.case?.assignedRole, "hr",
        "Forged assignedRole must not override server case classification");
      const persisted = await snapshot(actor.org.id);
      assert.equal(persisted.employeeHrCases.length, ownBefore.employeeHrCases.length + 1);
      assert.equal(persisted.employeeHrCaseMessages.length,
        ownBefore.employeeHrCaseMessages.length + 1);
      assert.equal(persisted.auditEvents.length, ownBefore.auditEvents.length + 1);
      assert.equal(persisted.employeeHrCases.at(-1).id, forged.json.case.id);
      assert.equal(persisted.employeeHrCaseMessages.at(-1).caseId, forged.json.case.id);
      assert.equal(persisted.employeeHrCaseMessages.at(-1).visibility, "employee");
      employeePosts++;
      // The authorized own POST legitimately appends a case, message and audit.
      // Future foreign denials must preserve this post-success snapshot, not the
      // pre-POST snapshot, without weakening the untouched victim comparator.
      baseline.set(actor.org.id, persisted);
      assertUnchanged(victimBefore, await snapshot(victim.org.id),
        "Victim untouched after employee POST with forged selectors");
      const employeeRead = await http("/api/hr-cases", actor.employee.cookie);
      assert.equal(employeeRead.status, 200);
      assert.equal(employeeRead.json?.organizationId, actor.org.id);
      assert.ok(employeeRead.json?.cases?.some(x => x.id === forged.json.case.id));
      assert.ok(!employeeRead.text.includes("INTERNAL-" + actor.marker),
        "Employee HR inbox must never expose staff-only notes");
      assert.ok(!employeeRead.text.includes(victim.marker),
        "Employee HR inbox must never expose foreign cases");
      const forbiddenStaffPost = await http("/api/hr-cases", actor.cookie, "POST", {
        caseType: "general", subject: "Staff cannot submit as employee",
        description: "Fictional staff forged employee request",
        employeeId: victim.worker.id,
      });
      assert.equal(forbiddenStaffPost.status, 403);
    }
    assert.equal((await http("/api/hr-cases", undefined, "POST", {
      caseType: "general", subject: "Anonymous not allowed",
      description: "Anonymous fake employee case attempt",
    })).status, 401);
    assert.equal((await http("/api/documents/" + victim.document.id)).status, 401);

    // Real browser hydration is distinct from a 200 HTML shell.
    browser = await browserLib.chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("**/*", route =>
      new URL(route.request().url()).origin === ORIGIN ? route.continue() : route.abort());
    // Chromium refuses to set a secure __Host- cookie against loopback HTTP.
    // Exercise the genuine signed fixture session on this localhost-only
    // test context; separate login/browser proofs cover cookie policy.
    assert.ok(a.cookie.startsWith("__Host-linaw_session="));
    await context.setExtraHTTPHeaders({ Cookie: a.cookie });
    const account = await context.request.get(ORIGIN + "/api/account");
    assert.equal(account.status(), 200);
    assert.equal((await account.json()).profile?.id, a.owner.id);
    const page = await context.newPage();
    const ownPage = await page.goto(ORIGIN + "/hcm/hr-cases?organizationId=" + a.org.id,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.equal(ownPage?.status(), 200);
    await page.getByRole("heading", { name: "Employee HR requests" }).waitFor();
    const inbox = page.getByRole("region", { name: "Employee HR case inbox" });
    await inbox.getByRole("heading", { name: a.general.subject }).waitFor({ timeout: 60000 });
    await inbox.getByText("INTERNAL-" + a.marker).waitFor();
    const html = await page.locator("body").innerText();
    assert.ok(!html.includes(b.marker) && !html.includes(victim.marker),
      "Hydrated HR case component leaked foreign employer markers");
    await inbox.getByRole("button", { name: /^All \(/ }).click();
    const coeLink = inbox.getByRole("link", { name: "View approved certificate" });
    await coeLink.waitFor();
    assert.equal(await coeLink.getAttribute("href"), "/api/documents/" + a.document.id,
      "COE link must target exact persisted own document ID");

    const article = inbox.locator("article").filter({ hasText: a.general.subject });
    const note = "BROWSER-INTERNAL-" + a.marker;
    await article.getByRole("textbox", { name: "Write case response" }).fill(note);
    await article.getByLabel("Visibility").selectOption("internal");
    await article.getByRole("button", { name: "Post response" }).click();
    await inbox.getByText(note).waitFor({ timeout: 60000 });
    const afterBrowserEmployee = await http("/api/hr-cases", a.employee.cookie);
    assert.equal(afterBrowserEmployee.status, 200);
    assert.ok(!afterBrowserEmployee.text.includes(note),
      "Internal browser note must not leak into employee inbox");
    const privatePage = await page.goto(ORIGIN + "/hcm/hr-cases?organizationId=" + victim.org.id,
      { waitUntil: "domcontentloaded" });
    assert.equal(privatePage?.status(), 404, "Staff browser must not view foreign case page");
    assert.ok(!(await page.content()).includes(victim.marker));

    // Revoke actual employee and staff employer memberships, not sessions.
    for (const userId of [a.employee.user.id, a.owner.id]) {
      const changed = await db.update(s.userOrganizations).set({ active: false })
        .where(and(eq(s.userOrganizations.userId, userId),
          eq(s.userOrganizations.organizationId, a.org.id),
          eq(s.userOrganizations.active, true))).returning({ id: s.userOrganizations.id });
      assert.equal(changed.length, 1);
    }
    assert.equal((await http("/api/account", a.employee.cookie)).status, 200);
    assert.equal((await http("/api/account", a.cookie)).status, 200);
    assertDeniedPrivate(await http("/api/documents/" + a.document.id, a.employee.cookie),
      404, [a.marker], "Revoked employee cannot download COE");
    assertDeniedPrivate(await http("/api/documents/" + a.document.id, a.cookie),
      404, [a.marker], "Revoked staff cannot download COE");
    assert.equal((await http("/api/hr-cases", a.employee.cookie, "POST", {
      caseType: "general", subject: "Revoked employee attempt",
      description: "Revoked employee should not create case",
    })).status, 403, "Same signed-in employee lost active employer access");
    assertUnchanged(victimBefore, await snapshot(victim.org.id),
      "All private victim SQL unchanged after POST, UI, document and revoke");
    const finalB = await snapshot(b.org.id);
    for (const name of tables)
      if (name !== "employeeHrCases" && name !== "employeeHrCaseMessages"
        && name !== "auditEvents")
        assert.deepEqual(finalB[name], baseline.get(b.org.id)[name],
          "Other employer business records unchanged by A's browser session");

    console.log("HR_CASE_EMPLOYEE_COE_BROWSER_COMPLETE " + JSON.stringify({
      fictionalEmployers: 10, independentOwnerSessions: 3,
      linkedEmployeeOwnPosts: employeePosts, forgedEmployerWorkerIgnored: true,
      actualOwnedCoeDownloads: docsAllowed, foreignCoeDownloadDenials: docsDenied,
      sameSessionRevokedDocumentDenied: true, higherIdVictim: true,
      internalStaffNotesHiddenFromEmployee: true, hydratedStaffInbox: true,
      realBrowserInternalNotePersisted: true, exactOwnCoeLink: true,
      victimBusinessAndAuditUnchanged: true, providerCalls: 0, documentObjectPuts: 0,
      addedMethodCredits: 0, addedPageCredits: 0, productionCertified: false,
    }));
  } finally {
    if (browser) await browser.close();
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-hr-cases-employee-doc-browser.mjs")) {
  proveHrEmployeeDocumentsBrowser().catch(error => {
    console.error("HR_CASE_EMPLOYEE_COE_BROWSER_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
