/**
 * Private annual tax review SSR: two independent owners + higher-ID victim,
 * actual feature-ON GET positives, cross-tenant/role/forged/revoked denials,
 * and unchanged real PostgreSQL employer, payroll and audit rows.
 * No filings, payroll release, payouts, or external provider requests.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  TAX_REVIEW_ORIGIN, requireDisposableTaxReviewPageEnv,
  assertTaxReviewOwnPage, assertTaxReviewDeniedPage, assertTaxReviewNoForeignMarkers,
} from "./tenant-payroll-review-pages-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const routes = ["/workspace/2316", "/workspace/prior-employer"];

async function readLocal(path, cookie) {
  assert.ok(path === "/api/account" || routes.some(route =>
    path === route || path.startsWith(route + "?")),
    "TAX_REVIEW_PAGE_REFUSED: unreviewed URL");
  const response = await fetch(TAX_REVIEW_ORIGIN + path, {
    method: "GET",
    headers: cookie ? { cookie } : {},
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json = null;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    try { json = JSON.parse(text); } catch { /* Explicit status checks remain mandatory. */ }
  }
  return { status: response.status, text, json,
    contentType: response.headers.get("content-type") ?? "",
    location: response.headers.get("location"),
  };
}

export async function verifyPayrollReviewPagesIsolation() {
  // This guard MUST run before importing a DB/app module or issuing HTTP.
  requireDisposableTaxReviewPageEnv();

  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  try {
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = { ...(await fixture.seedEmployer("ATTA", nonce, fixture.standaloneMakeSession)), label: "A" };
    const b = { ...(await fixture.seedEmployer("ATTB", nonce, fixture.standaloneMakeSession)), label: "B" };
    const victim = { ...(await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession)), label: "victim" };
    const subjects = [a, b, victim];
    assert.equal(new Set(subjects.map(subject => subject.org.id)).size, 3);
    assert.equal(new Set(subjects.map(subject => subject.cookie)).size, 3);
    for (const actor of [a, b]) {
      for (const kind of ["org", "entity", "unit", "worker", "owner"]) {
        assert.ok(victim[kind].id > actor[kind].id, "Higher-ID victim " + kind + " required");
      }
    }

    async function extraActor(role, orgUnitId = null) {
      const [user] = await db.insert(s.users).values({
        name: "Fictional " + role + " " + nonce,
        email: "tax-page-" + role + "-" + (orgUnitId ?? "all") + "-" + nonce + "@example.invalid",
        passwordHash: "fictional-session-only", role: role === "group_hr" ? "owner" : role,
        totpEnabled: true,
      }).returning({ id: s.users.id });
      await db.insert(s.userOrganizations).values({
        userId: user.id, organizationId: a.org.id, role, orgUnitId, active: true,
      });
      const session = await fixture.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      return { user, cookie: session.cookie };
    }

    const hr = await extraActor("hr");
    const scoped = await extraActor("bookkeeper", a.unit.id);
    const groupHr = await extraActor("group_hr");
    const protectedTables = [
      "organizations", "employees", "payrollRuns", "auditEvents", "yearEndPriorEvidence",
    ];
    async function snapshot(orgId) {
      const result = {};
      for (const name of protectedTables) {
        const table = s[name];
        assert.ok(table?.id, "Missing durable SQL table: " + name);
        result[name] = await db.select().from(table)
          .where(eq(name === "organizations" ? table.id : table.organizationId, orgId))
          .orderBy(asc(table.id));
      }
      return plain(result);
    }
    const before = new Map(await Promise.all(subjects.map(async subject =>
      [subject.org.id, await snapshot(subject.org.id)])));

    let ownPagePositives = 0, foreignDenials = 0, forgedDenials = 0;
    for (const actor of [a, b]) {
      const auth = await readLocal("/api/account", actor.cookie);
      assert.equal(auth.status, 200, "Fictional owner must have a real signed-in HTTP session");
      assert.equal(auth.json?.profile?.id, actor.owner.id);

      for (const route of routes) {
        const own = await readLocal(route + "?organizationId=" + actor.org.id, actor.cookie);
        assertTaxReviewOwnPage(own, route, actor, subjects);
        ownPagePositives++;

        for (const foreign of subjects.filter(subject => subject.org.id !== actor.org.id)) {
          assertTaxReviewDeniedPage(
            await readLocal(route + "?organizationId=" + foreign.org.id, actor.cookie),
            subjects, actor.label + " -> " + foreign.label + " " + route);
          foreignDenials++;
        }

        for (const invalid of ["0", "-1", "01", "1e0", "bad",
          "9007199254740992", "%201", actor.org.id + "&organizationId=" + actor.org.id]) {
          assertTaxReviewDeniedPage(
            await readLocal(route + "?organizationId=" + invalid, actor.cookie),
            subjects, actor.label + " forged " + route + " " + invalid);
          forgedDenials++;
        }

        for (const param of ["employeeId", "taxYear"]) {
          assertTaxReviewDeniedPage(await readLocal(route + "?organizationId=" +
            actor.org.id + "&" + param + "=1&" + param + "=2", actor.cookie),
            subjects, actor.label + " duplicate " + param);
        }

        // Omission is guidance only, not proof that an employer was authorized.
        const missing = await readLocal(route, actor.cookie);
        assert.equal(missing.status, 200);
        assert.ok(missing.text.includes("Select an employer"));
        assert.ok(!missing.text.includes('data-organization-id="'));
      }
      for (const subject of subjects) {
        assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id),
          "Read-only/denied page GETs changed employer, payroll, tax or audit SQL");
      }
    }

    for (const [label, actor] of [
      ["company-wide HR", hr], ["unit-only bookkeeper", scoped], ["group HR", groupHr],
    ]) {
      const signedIn = await readLocal("/api/account", actor.cookie);
      assert.equal(signedIn.status, 200, label + ": real active session required");
      for (const route of routes) {
        assertTaxReviewDeniedPage(
          await readLocal(route + "?organizationId=" + a.org.id, actor.cookie),
          subjects, label + " " + route);
      }
    }

    for (const route of routes) {
      const anonymous = await readLocal(route + "?organizationId=" + victim.org.id);
      assert.ok([302, 303, 307, 308].includes(anonymous.status),
        "Anonymous must redirect to login, not render the tax review");
      assertTaxReviewNoForeignMarkers(anonymous.text, subjects, "anonymous");
    }

    // Session remains valid after employer membership is explicitly revoked.
    const revoked = await db.update(s.userOrganizations).set({ active: false })
      .where(and(
        eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.active, true),
      )).returning({ id: s.userOrganizations.id });
    assert.equal(revoked.length, 1);
    const stillSignedIn = await readLocal("/api/account", a.cookie);
    assert.equal(stillSignedIn.status, 200);
    assert.equal(stillSignedIn.json?.profile?.id, a.owner.id);
    for (const route of routes) {
      assertTaxReviewDeniedPage(
        await readLocal(route + "?organizationId=" + a.org.id, a.cookie),
        subjects, "revoked member " + route);
    }
    for (const subject of subjects) {
      assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id),
        "Revocation proof must not touch any private payroll/tax/audit table");
    }

    const summary = {
      kind: "TAX_REVIEW_PAGES_FICTIONAL_PG16_CANDIDATE",
      employers: 3, independentAttackers: 2,
      ownPagePositives, foreignDenials, forgedDenials,
      revokedStillSignedIn: true, victimPayrollTaxAuditUnchanged: true,
      pageCredits: 0, apiMethodCredits: 0, productionAccepted: false,
    };
    console.log("TENANT_TAX_REVIEW_PAGES_COMPLETE " + JSON.stringify(summary));
    return summary;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-payroll-review-pages-http.mjs")) {
  verifyPayrollReviewPagesIsolation().catch(error => {
    console.error("TENANT_TAX_REVIEW_PAGES_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
