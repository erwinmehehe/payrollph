/** Real signed-session JSON and CSV export proof; all data fictional, zero credits. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, requireDisposableExportEnv, verifyExportSourcePins,
  assertOwnPreview, assertOwnCsv, assertDeniedExport,
  assertProtectedUnchanged,
} from "./tenant-report-builder-export-contract.mjs";

const asJson = value => JSON.parse(JSON.stringify(value));
const path = "/api/reports/builder";
const startDate = "2026-10-01";
const endDate = "2026-10-31";
const spec = { dataset: "people", fields: ["department", "headcount"], groupBy: "department" };
function payload(organizationId, format = "json", requested = spec) {
  return { organizationId, startDate, endDate, format, spec: requested };
}
async function http(requestPath, cookie, body) {
  assert.ok(requestPath === path || requestPath === "/api/account");
  const method = body === undefined ? "GET" : "POST";
  const headers = { ...(cookie ? { cookie } : {}) };
  if (method === "POST") Object.assign(headers, {
    origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json",
  });
  const response = await fetch(ORIGIN + requestPath, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, json, headers: response.headers };
}

export async function proveReportBuilderExports() {
  // No app/database code is imported until both environment and pinned bytes pass.
  requireDisposableExportEnv();
  verifyExportSourcePins();
  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  const protectedTables = [
    "organizations", "legalEntities", "orgUnits", "employees", "employeePayProfiles",
    "payrollRuns", "auditEvents", "userOrganizations",
  ];
  async function snapshot(organizationId) {
    const entries = {};
    for (const name of protectedTables) {
      const table = s[name];
      assert.ok(table && table.id, "Required protected SQL table missing: " + name);
      const where = eq(name === "organizations" ? table.id : table.organizationId, organizationId);
      entries[name] = asJson(await db.select().from(table).where(where).orderBy(asc(table.id)));
    }
    return entries;
  }
  try {
    const pgVersion = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pgVersion >= 160000 && pgVersion < 170000, "Disposable PostgreSQL 16 required");
    for (const table of [s.organizations, s.users]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "Nonempty database cannot be used as a fictional proof fixture");
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    for (let i = 1; i <= 6; i++) {
      await fixture.seedEmployer("FILL" + i, nonce, fixture.standaloneMakeSession);
    }
    const a = await fixture.seedEmployer("ATTA", nonce, fixture.standaloneMakeSession);
    const b = await fixture.seedEmployer("ATTB", nonce, fixture.standaloneMakeSession);
    const victim = await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession);
    const actors = [a, b], trio = [a, b, victim];
    assert.equal(new Set(trio.map(x => x.org.id)).size, 3);
    assert.equal(new Set(trio.map(x => x.cookie)).size, 3);
    for (const key of ["org", "entity", "unit", "owner", "worker"]) {
      assert.ok(victim[key].id > Math.max(a[key].id, b[key].id, 6),
        "Higher-ID populated victim required: " + key);
    }
    const baseline = new Map(await Promise.all(trio.map(async person =>
      [person.org.id, await snapshot(person.org.id)])));
    let ownPreviews = 0, ownCsvExports = 0, foreignDenials = 0, badRequests = 0;
    let firstPreview = null;
    for (const actor of actors) {
      const session = await http("/api/account", actor.cookie);
      assert.equal(session.status, 200, "A real signed-in account session is required");
      assert.equal(session.json?.profile?.id, actor.owner.id);

      const preview = await http(path, actor.cookie, payload(actor.org.id));
      assertOwnPreview(preview, actor, victim);
      if (firstPreview) {
        assert.throws(() => assertOwnPreview(firstPreview, actor, victim),
          "The other attacker's real data must not pass own-employer evidence");
      } else firstPreview = preview;
      ownPreviews++;
      assertProtectedUnchanged(baseline.get(victim.org.id),
        await snapshot(victim.org.id), "Victim after own preview");

      const csv = await http(path, actor.cookie, payload(actor.org.id, "csv"));
      assertOwnCsv(csv, actor, victim);
      ownCsvExports++;
      const ownAfter = await snapshot(actor.org.id);
      for (const name of protectedTables.filter(name => name !== "auditEvents")) {
        assert.deepEqual(ownAfter[name], baseline.get(actor.org.id)[name],
          "Owned report must not mutate business SQL: " + name);
      }
      assert.equal(ownAfter.auditEvents.length, baseline.get(actor.org.id).auditEvents.length + 1,
        "Only one own-employer CSV audit event is expected");
      assert.equal(ownAfter.auditEvents.at(-1).action,
        "Tenant report builder CSV exported");

      for (const foreign of trio.filter(person => person.org.id !== actor.org.id)) {
        const before = await snapshot(foreign.org.id);
        for (const format of ["json", "csv"]) {
          const denied = await http(path, actor.cookie, payload(foreign.org.id, format));
          assertDeniedExport(denied, foreign, "foreign employer " + format, [403, 404]);
          assertProtectedUnchanged(before, await snapshot(foreign.org.id),
            "Denied foreign export " + format);
          foreignDenials++;
        }
      }
      for (const malformed of [0, -1, 1.5, "not-an-id", null]) {
        const denied = await http(path, actor.cookie, payload(malformed));
        assertDeniedExport(denied, victim, "invalid identifier " + String(malformed), [400]);
        badRequests++;
      }
      for (const input of [
        payload(actor.org.id, "xml"),
        payload(actor.org.id, "json", { dataset: "payroll", fields: ["payrollCost"] }),
        payload(actor.org.id, "json", { dataset: "people", fields: ["sql"], groupBy: null }),
      ]) {
        const denied = await http(path, actor.cookie, input);
        assertDeniedExport(denied, victim, "forbidden report parameters", [400]);
        badRequests++;
      }
    }

    const anonymous = await http(path, undefined, payload(victim.org.id));
    assertDeniedExport(anonymous, victim, "anonymous export", [401]);
    assertProtectedUnchanged(baseline.get(victim.org.id),
      await snapshot(victim.org.id), "Victim after anonymous request");

    // An active, same-employer HR role restricted to one unit must not
    // acquire the company-wide export privilege of its fictional employer.
    const [scopedUser] = await db.insert(s.users).values({
      email: "rpt-scoped-" + nonce + "@example.invalid",
      name: "Fictional restricted HR user", role: "owner",
      passwordHash: "fictional-session-only",
    }).returning({ id: s.users.id });
    await db.insert(s.userOrganizations).values({
      userId: scopedUser.id, organizationId: a.org.id, role: "hr",
      orgUnitId: a.unit.id, active: true,
    });
    const scoped = await fixture.standaloneMakeSession(scopedUser.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, scoped.id));
    assertDeniedExport(await http(path, scoped.cookie, payload(a.org.id)),
      victim, "unit-scoped HR export", [403]);
    assertProtectedUnchanged(baseline.get(victim.org.id),
      await snapshot(victim.org.id), "Victim after unit-scoped denial");

    // Revoke employer A without invalidating its signed-in session.
    const changed = await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.active, true))).returning({ id: s.userOrganizations.id });
    assert.equal(changed.length, 1);
    assert.equal((await http("/api/account", a.cookie)).status, 200);
    const victimBeforeRevoked = await snapshot(victim.org.id);
    for (const format of ["json", "csv"]) {
      assertDeniedExport(await http(path, a.cookie, payload(a.org.id, format)),
        victim, "revoked employer access " + format, [403, 404]);
      assertProtectedUnchanged(victimBeforeRevoked, await snapshot(victim.org.id),
        "Victim after revoked session request");
    }

    verifyExportSourcePins();
    const result = {
      kind: "report-builder-post-json-csv-real-http-zero-credit",
      fictionalEmployers: 9, independentAttackerSessions: 2,
      higherIdVictim: true, populatedOwnJsonPreviews: ownPreviews,
      populatedOwnCsvExports: ownCsvExports, foreignJsonCsvDenials: foreignDenials,
      malformedOrUnapprovedRequests: badRequests,
      anonymousDenied: true, unitScopedDenied: true, revokedEmployerDenied: true,
      foreignBusinessAndAuditUnchanged: true,
      ownCsvAuditRecorded: true, providerCalls: 0, moneyMoved: false,
      addedApiCredits: 0, addedPageCredits: 0,
      independentSecurityPrivacyReview: "PENDING", productionCertified: false,
    };
    assert.deepEqual([ownPreviews, ownCsvExports, foreignDenials], [2, 2, 8]);
    console.log("REPORT_BUILDER_EXPORT_PG16_COMPLETE " + JSON.stringify(result));
    return result;
  } finally { await pool.end(); }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-report-builder-export-http.mjs")) {
  proveReportBuilderExports().catch(error => {
    console.error("REPORT_BUILDER_EXPORT_PG16_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
