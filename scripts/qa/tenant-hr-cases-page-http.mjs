/**
 * Genuine feature-ON HR Cases SSR + GET isolation on a fresh fictional PG16.
 * No writes over HTTP, no private data, no feature activation, no coverage
 * credit. Only the matching GitHub Actions job may execute this runner.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE_PATH, API_PATH, requireDisposableHrPageEnv,
  verifyHrPageSourcePins, assertNoOtherEmployerMarkers, assertOwnHrPage,
  assertOwnHrCases, assertDeniedHrResponse, assertReadOnlySql,
} from "./tenant-hr-cases-page-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const pagePath = id => PAGE_PATH + "?organizationId=" + id;
const apiPath = id => API_PATH + "?organizationId=" + id;

async function httpGet(path, cookie) {
  assert.ok(path.startsWith("/") && !path.startsWith("//") &&
    (path.startsWith(PAGE_PATH + "?") ||
     path.startsWith(API_PATH + "?") || path === "/api/account"),
    "HR_CASE_PAGE_REFUSED: out-of-scope HTTP target " + path);
  const response = await fetch(ORIGIN + path, {
    method: "GET",
    headers: cookie ? { cookie } : {},
    redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* SSR and denials may be non-JSON */ }
  return { status: response.status, text, json, headers: response.headers };
}

export async function proveHrCasesPageIsolation() {
  // These fail before touching the database, app modules or sessions.
  requireDisposableHrPageEnv();
  verifyHrPageSourcePins();
  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const protectedTables = [
    "organizations", "legalEntities", "orgUnits", "employees",
    "employeePayProfiles", "userOrganizations", "employeeHrCases",
    "employeeHrCaseMessages", "auditEvents", "payrollRuns",
  ];

  async function snapshot(orgId) {
    const out = {};
    for (const name of protectedTables) {
      const table = s[name];
      assert.ok(table?.id, "Unknown protected table " + name);
      out[name] = plain(await db.select().from(table)
        .where(eq(name === "organizations" ? table.id : table.organizationId, orgId))
        .orderBy(asc(table.id)));
    }
    return out;
  }

  let ownPages = 0, ownInboxes = 0, foreignDenials = 0, negativeChecks = 0;
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, "HR_CASE_PAGE_REFUSED: actual PostgreSQL 16 required");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "HR_CASE_PAGE_REFUSED: database already contains employers");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "HR_CASE_PAGE_REFUSED: database already contains users");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);

    async function newEmployer(label) {
      return { ...(await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession)),
        label, cases: [] };
    }
    async function newCase(actor, role, worker = actor.worker, suffix = "") {
      const [row] = await db.insert(s.employeeHrCases).values({
        organizationId: actor.org.id, employeeId: worker.id,
        createdByUserId: actor.owner.id,
        caseType: role === "hr" ? "general" : "payslip_correction",
        subject: actor.marker + " " + role + " " + suffix,
        description: actor.marker + " confidential case source",
        assignedRole: role, status: "open",
        slaDueAt: new Date(Date.now() + 72 * 3_600_000),
      }).returning();
      await db.insert(s.employeeHrCaseMessages).values({
        organizationId: actor.org.id, caseId: row.id,
        actorUserId: actor.owner.id, visibility: "internal",
        body: actor.marker + " internal case note " + suffix,
      });
      actor.cases.push(row);
      return row;
    }

    // Real filled rows before both attackers and victim defeat small-ID
    // placeholder proofs and force source IDs beyond six.
    const filler = [];
    for (let i = 1; i <= 7; i++) {
      const actor = await newEmployer("FILL" + i);
      await newCase(actor, "hr");
      filler.push(actor);
    }
    const a = await newEmployer("ATTA");
    await newCase(a, "hr");
    await newCase(a, "payroll");

    // Within-employer leakage control: unit HR must not read this case or
    // employer-wide payroll cases even though they are in the same tenant.
    const [otherUnit] = await db.insert(s.orgUnits).values({
      organizationId: a.org.id, legalEntityId: a.entity.id,
      type: "department", code: "HR-OTHER-" + nonce,
      name: a.marker + " another unit",
    }).returning();
    const [otherWorker] = await db.insert(s.employees).values({
      organizationId: a.org.id, legalEntityId: a.entity.id,
      orgUnitId: otherUnit.id, employeeNo: a.marker + "-OTHER",
      firstName: "Other", lastName: a.marker, title: "Fictional",
      avatarInitials: "FT", basicRate: "22000.00", startDate: "2026-01-05",
    }).returning();
    await db.insert(s.employeePayProfiles).values({
      organizationId: a.org.id, employeeId: otherWorker.id,
      payBasis: "monthly", rateAmount: "22000.00",
      standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
    });
    await newCase(a, "hr", otherWorker, "different-unit");

    const b = await newEmployer("ATTB");
    await newCase(b, "hr");
    await newCase(b, "payroll");
    const victim = await newEmployer("VICTIM");
    await newCase(victim, "hr");
    await newCase(victim, "payroll");
    const actors = [a, b, victim];
    const allEmployers = [...filler, ...actors];

    for (const field of ["org", "entity", "unit", "worker", "owner"]) {
      assert.ok(victim[field].id > Math.max(a[field].id, b[field].id, 6),
        "Real victim " + field + " ID must exceed both owners and six");
    }
    assert.ok(victim.cases.every(row =>
      row.id > Math.max(...a.cases.map(x => x.id), ...b.cases.map(x => x.id), 6)),
    "Real victim case IDs must exceed every attacker case and six");
    assert.equal(new Set(actors.map(x => x.cookie)).size, 3);

    async function roleUser(role, unit) {
      const [user] = await db.insert(s.users).values({
        email: "hr-page-" + role + "-" + nonce + "@example.invalid",
        name: "Fictional " + role + " inbox reader",
        passwordHash: "fixture-only", role: "owner", totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        organizationId: a.org.id, userId: user.id,
        role, orgUnitId: unit, active: true,
      });
      const session = await fixture.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      return { cookie: session.cookie, user };
    }
    const scopedHr = await roleUser("hr", a.unit.id);
    const bookkeeper = await roleUser("bookkeeper", a.unit.id);

    const baseline = new Map();
    for (const actor of allEmployers)
      baseline.set(actor.org.id, await snapshot(actor.org.id));
    async function verifyUnchanged(context) {
      for (const actor of allEmployers)
        assertReadOnlySql(baseline.get(actor.org.id),
          await snapshot(actor.org.id), context + " / " + actor.label);
    }
    async function deny(path, cookie, expected, label) {
      const response = await httpGet(path, cookie);
      assertDeniedHrResponse(response, expected, allEmployers, label);
      negativeChecks++;
      return response;
    }

    for (const actor of [a, b]) {
      const others = actors.filter(x => x !== actor);
      const signedIn = await httpGet("/api/account", actor.cookie);
      assert.equal(signedIn.status, 200, "Signed-in owner required");
      assert.equal(signedIn.json?.profile?.id, actor.owner.id);

      assertOwnHrPage(await httpGet(pagePath(actor.org.id), actor.cookie),
        actor, others);
      ownPages++;
      assertOwnHrCases(await httpGet(apiPath(actor.org.id), actor.cookie),
        actor, others, actor.cases);
      ownInboxes++;
      await verifyUnchanged(actor.label + " owned read");

      for (const foreign of others) {
        await deny(pagePath(foreign.org.id), actor.cookie, 404,
          actor.label + " foreign SSR " + foreign.label);
        await deny(apiPath(foreign.org.id), actor.cookie, 403,
          actor.label + " foreign inbox " + foreign.label);
        foreignDenials += 2;
      }
      for (const id of ["0", "01", "1e0", "-1", "bad"]) {
        await deny(pagePath(id), actor.cookie, 404,
          actor.label + " malformed page " + id);
        await deny(apiPath(id), actor.cookie, 400,
          actor.label + " malformed API " + id);
      }
      await deny(pagePath(actor.org.id + "&organizationId=" + victim.org.id),
        actor.cookie, 404, actor.label + " duplicate page employer");
      await deny(apiPath(actor.org.id + "&organizationId=" + victim.org.id),
        actor.cookie, 400, actor.label + " duplicate API employer");
      await verifyUnchanged(actor.label + " denials");
    }

    assertOwnHrPage(await httpGet(pagePath(a.org.id), scopedHr.cookie),
      a, [b, victim]);
    ownPages++;
    assertOwnHrCases(await httpGet(apiPath(a.org.id), scopedHr.cookie),
      a, [b, victim], [a.cases[0]]);
    ownInboxes++;
    await verifyUnchanged("unit-scoped HR read");

    await deny(pagePath(victim.org.id), scopedHr.cookie, 404, "unit HR foreign page");
    await deny(apiPath(victim.org.id), scopedHr.cookie, 403, "unit HR foreign inbox");
    foreignDenials += 2;
    await deny(pagePath(a.org.id), bookkeeper.cookie, 404, "bookkeeper page");
    await deny(apiPath(a.org.id), bookkeeper.cookie, 403, "bookkeeper inbox");

    const anonymousPage = await httpGet(pagePath(a.org.id));
    assert.ok([307, 308].includes(anonymousPage.status),
      "Anonymous SSR must redirect instead of displaying HR cases");
    assert.ok(anonymousPage.headers.get("location")?.includes("/login"));
    assertNoOtherEmployerMarkers(anonymousPage, allEmployers, "anonymous page");
    negativeChecks++;
    await deny(apiPath(a.org.id), undefined, 401, "anonymous inbox");
    await verifyUnchanged("anonymous and unauthorized reads");

    // Fixture-only membership revocation must not revoke the same user session:
    // employer permissions are checked anew on every page/API request.
    const [revoked] = await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id))).returning();
    assert.equal(revoked.userId, a.owner.id);
    baseline.set(a.org.id, await snapshot(a.org.id));
    const stillSignedIn = await httpGet("/api/account", a.cookie);
    assert.equal(stillSignedIn.status, 200,
      "Revoked employer membership must not masquerade as an expired login");
    assert.equal(stillSignedIn.json?.profile?.id, a.owner.id);
    await deny(pagePath(a.org.id), a.cookie, 404, "revoked owner page");
    await deny(apiPath(a.org.id), a.cookie, 403, "revoked owner inbox");
    await verifyUnchanged("revoked member reads");

    assert.equal(ownPages, 3);
    assert.equal(ownInboxes, 3);
    assert.equal(foreignDenials, 10);
    assert.equal(negativeChecks, 40);
    console.log(JSON.stringify({
      family: "hr-cases-staff-ssr-and-inbox",
      fictionalPg16: true, featureOnLocalOnly: true,
      populatedEmployers: allEmployers.length,
      ownPages, ownInboxes, foreignDenials, negativeChecks,
      ownRealCaseRows: a.cases.length + b.cases.length,
      highIdVictim: true, unitAndAssignedRoleScoped: true,
      revokedMembershipDeniedWithSessionIntact: true,
      protectedEmployerSqlUnchanged: true, providerCalls: 0,
      apiMethodCredits: 0, pageActionCredits: 0,
      independentlyAccepted: false, productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-hr-cases-page-http.mjs"))
  await proveHrCasesPageIsolation();
