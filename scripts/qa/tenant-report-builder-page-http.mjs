/**
 * Feature-ON, real authenticated Next HTTP proof for the report-builder PAGE.
 * Disposable PostgreSQL 16, three fictional employers, zero coverage credits.
 * No application/database import is permitted before the environment guard.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  REPORT_PAGE_ORIGIN, requireDisposableReportPageEnv,
  assertOwnReportPage, assertForeignReportPage, assertOwnReportCapabilities,
  assertDeniedReportCapabilities, assertNoReportVictimData, assertReadOnlyReportSnapshot,
} from "./tenant-report-builder-page-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));

async function readLocal(path, cookie) {
  assert.ok(path.startsWith("/") && !path.startsWith("//"), "Local URL path required");
  assert.ok(path.startsWith("/workspace/report-builder?") ||
    path.startsWith("/api/reports/builder?") || path === "/api/account",
  "Only reviewed report-builder GETs and account-session attestation are allowed");
  const response = await fetch(REPORT_PAGE_ORIGIN + path, {
    method: "GET", headers: cookie ? { cookie } : {},
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    try { json = JSON.parse(text); } catch { /* Asserted by the specific response contract. */ }
  }
  return {
    status: response.status, text, json,
    contentType: response.headers.get("content-type") ?? "",
  };
}

export async function verifyReportBuilderPageTenantIsolation() {
  requireDisposableReportPageEnv();

  const [{ db, pool }, s, { and, asc, eq }, t] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  try {
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = { ...(await t.seedEmployer("ATTA", nonce, t.standaloneMakeSession)), label: "ATTA" };
    const b = { ...(await t.seedEmployer("ATTB", nonce, t.standaloneMakeSession)), label: "ATTB" };
    const victim = { ...(await t.seedEmployer("VICTIM", nonce, t.standaloneMakeSession)),
      label: "VICTIM" };
    const trio = [a, b, victim];

    assert.equal(new Set(trio.map(subject => subject.org.id)).size, 3);
    assert.equal(new Set(trio.map(subject => subject.cookie)).size, 3);
    assert.equal(new Set(trio.map(subject => subject.worker.employeeNo)).size, 3);
    for (const actor of [a, b]) {
      for (const key of ["org", "entity", "unit", "owner", "worker"]) {
        assert.ok(victim[key].id > actor[key].id,
          "Real persisted victim must have a higher " + key + " ID");
      }
    }

    // An active HR membership restricted to a single unit must not render
    // company-wide report controls even for its own employer.
    const [scopedUser] = await db.insert(s.users).values({
      email: "ttbl-scoped-report-" + nonce + "@example.invalid",
      name: "TTBL-" + nonce + " unit HR",
      role: "owner", passwordHash: "fictional-session-only",
    }).returning({ id: s.users.id });
    await db.insert(s.userOrganizations).values({
      userId: scopedUser.id, organizationId: a.org.id, role: "hr",
      orgUnitId: a.unit.id, active: true,
    });
    const scopedSession = await t.standaloneMakeSession(scopedUser.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, scopedSession.id));

    const protectedTables = Object.freeze([
      "organizations", "legalEntities", "orgUnits", "employees",
      "employeePayProfiles", "payrollRuns", "userOrganizations", "auditEvents",
    ]);
    async function snapshot(orgId) {
      const result = {};
      for (const name of protectedTables) {
        const table = s[name];
        assert.ok(table?.id, "Required real SQL table missing: " + name);
        const condition = name === "organizations"
          ? eq(table.id, orgId) : eq(table.organizationId, orgId);
        result[name] = await db.select().from(table)
          .where(condition).orderBy(asc(table.id));
      }
      return plain(result);
    }
    const before = new Map(await Promise.all(trio.map(async subject =>
      [subject.org.id, await snapshot(subject.org.id)])));

    const pagePath = id => "/workspace/report-builder?organizationId=" + id;
    const apiPath = id => "/api/reports/builder?organizationId=" + id;
    let ownSuccesses = 0;
    let foreignDenials = 0;
    for (const actor of [a, b]) {
      const signedIn = await readLocal("/api/account", actor.cookie);
      assert.equal(signedIn.status, 200, "Real owner session must authenticate");
      assert.equal(signedIn.json?.profile?.id, actor.owner.id);

      assertOwnReportPage(await readLocal(pagePath(actor.org.id), actor.cookie), actor, victim);
      assertOwnReportCapabilities(await readLocal(apiPath(actor.org.id), actor.cookie),
        victim, actor.label);
      ownSuccesses++;

      for (const other of trio.filter(other => other.org.id !== actor.org.id)) {
        assertForeignReportPage(await readLocal(pagePath(other.org.id), actor.cookie),
          other, actor.label + " foreign " + other.label);
        assertDeniedReportCapabilities(
          await readLocal(apiPath(other.org.id), actor.cookie), 403,
          other, actor.label + " API foreign " + other.label);
        foreignDenials++;
      }
      for (const selector of ["0", "-1", "01", "1e0", "bad", "9007199254740992"]) {
        const malformed = await readLocal(
          "/workspace/report-builder?organizationId=" + selector, actor.cookie);
        assert.equal(malformed.status, 404,
          "Malformed employer selector must fail closed: " + selector);
        assertNoReportVictimData(malformed, victim, "malformed selector");
      }
      const duplicate = await readLocal(pagePath(actor.org.id) +
        "&organizationId=" + actor.org.id, actor.cookie);
      assert.equal(duplicate.status, 404, "Duplicated employer selector must be rejected");

      for (const employer of trio) {
        assertReadOnlyReportSnapshot(before.get(employer.org.id),
          await snapshot(employer.org.id), actor.label + " GETs for " + employer.label);
      }
    }
    assert.equal(ownSuccesses, 2);
    assert.equal(foreignDenials, 4);

    assertForeignReportPage(await readLocal(pagePath(a.org.id), scopedSession.cookie),
      victim, "unit-scoped HR page");
    assertDeniedReportCapabilities(await readLocal(apiPath(a.org.id), scopedSession.cookie),
      403, victim, "unit-scoped HR API");

    const anonymous = await readLocal(pagePath(victim.org.id));
    assertNoReportVictimData(anonymous, victim, "anonymous report page");
    assert.ok(!anonymous.text.includes("Employer:"),
      "Anonymous user must not receive a private employer heading");
    assertDeniedReportCapabilities(await readLocal(apiPath(victim.org.id)),
      401, victim, "anonymous API");

    for (const employer of trio) {
      assertReadOnlyReportSnapshot(before.get(employer.org.id),
        await snapshot(employer.org.id), "Scoped/anonymous reads " + employer.label);
    }

    // Revoke one owner's real employer grant, not its session. The same
    // signed-in session must immediately lose the previously working page.
    const changed = await db.update(s.userOrganizations).set({ active: false })
      .where(and(
        eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.active, true),
      )).returning({ id: s.userOrganizations.id });
    assert.equal(changed.length, 1, "Exactly one real active owner grant revoked");
    const stillSignedIn = await readLocal("/api/account", a.cookie);
    assert.equal(stillSignedIn.status, 200,
      "Revoked employer access cannot be explained by an invalidated session");
    assert.equal(stillSignedIn.json?.profile?.id, a.owner.id);

    assertForeignReportPage(await readLocal(pagePath(a.org.id), a.cookie),
      a, "same signed-in session after membership revocation");
    assertDeniedReportCapabilities(await readLocal(apiPath(a.org.id), a.cookie),
      403, a, "same signed-in session after membership revocation");

    for (const other of [b, victim]) {
      assertReadOnlyReportSnapshot(before.get(other.org.id), await snapshot(other.org.id),
        "Revocation must not affect " + other.label + " business and audit");
    }
    const afterRevocation = await snapshot(a.org.id);
    const first = before.get(a.org.id);
    for (const name of protectedTables) {
      if (name !== "userOrganizations") {
        assert.deepEqual(afterRevocation[name], first[name],
          "Revocation cannot modify " + name);
      }
    }
    assert.deepEqual(
      afterRevocation.userOrganizations.filter(row => row.userId !== a.owner.id),
      first.userOrganizations.filter(row => row.userId !== a.owner.id),
      "Other membership and unit-scoped HR grants must remain unchanged");
    assert.ok(afterRevocation.userOrganizations.some(row =>
      row.userId === a.owner.id && row.active === false));

    const result = {
      kind: "REPORT_PAGE_SYNTHETIC_READ_PROOF_NOT_TENANT_CERTIFICATION",
      realDistinctEmployers: 3, independentOwnerSessions: 2,
      authorizedOwnPageAndApiPairs: ownSuccesses,
      foreignPageAndApiDenials: foreignDenials,
      unitScopedPageStatus: 404,
      sameSessionRevokedPageStatus: 404,
      sameSessionRevokedApiStatus: 403,
      protectedBusinessAndAuditUnchanged: true,
      pageCreditDelta: 0, methodCreditDelta: 0,
      productionCertified: false,
    };
    console.log("REPORT_PAGE_HTTP_COMPLETE " + JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-report-builder-page-http.mjs")) {
  verifyReportBuilderPageTenantIsolation().catch(error => {
    console.error("REPORT_PAGE_HTTP_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
