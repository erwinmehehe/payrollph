/**
 * Read-only Client Onboarding SSR tenant proof.
 * Disposable localhost PostgreSQL 16, three actual fictional employers,
 * two independently authenticated owners, real victim records, no money.
 *
 * This is a new page's provisional, ZERO-CREDIT evidence. It does not
 * certify the page for production or replace independent privacy review.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ORIGIN = "http://127.0.0.1:3000";

export function requireDisposableClientOnboardingEnv(env = process.env) {
  for (const [key, value] of Object.entries({
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    DEMO_MODE: "false",
    CLIENT_ONBOARDING_PROOF: "synthetic-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN,
    TRUSTED_APP_ORIGINS: ORIGIN,
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  })) assert.equal(env[key], value, "CLIENT_ONBOARDING_REFUSED: " + key);
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "XENDIT_CALLBACK_TOKEN", "RESEND_API_KEY", "SMTP_URL",
    "SMTP_PASSWORD", "STRIPE_SECRET_KEY", "OPENAI_API_KEY",
  ]) assert.ok(!env[key], "CLIENT_ONBOARDING_REFUSED: live provider " + key);
}

function pageUrl(id) {
  return "/app/client-onboarding?organizationId=" + id;
}

async function getLocal(path, cookie) {
  assert.ok(path === "/api/account" || path.startsWith("/app/client-onboarding"),
    "CLIENT_ONBOARDING_REFUSED: only reviewed GET paths are permitted");
  const response = await fetch(ORIGIN + path, {
    method: "GET", headers: cookie ? { cookie } : {}, redirect: "manual",
    cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  return { status: response.status, text: await response.text(),
    contentType: response.headers.get("content-type") ?? "",
    location: response.headers.get("location") ?? "" };
}

function assertNoForeignMarker(response, subjects, label) {
  for (const subject of subjects) {
    assert.ok(!response.text.includes(subject.org.name),
      label + ": foreign employer name rendered");
    assert.ok(!response.text.includes(subject.worker.employeeNo),
      label + ": foreign employee number rendered");
  }
}

function assertOwnOnboardingPage(response, own, others) {
  assert.equal(response.status, 200, "Authenticated owner must open owned company setup");
  assert.match(response.contentType, /text\/html/i);
  assert.ok(response.text.includes(own.org.name),
    "Own page must contain actual persisted employer name, not an empty shell");
  assert.ok(response.text.includes("Your setup checklist"),
    "Own page must render the new checklist");
  assert.ok(response.text.includes("employee record"),
    "Own page must render persisted employee evidence");
  assertNoForeignMarker(response, others, "own company setup");
}

function assertDeniedOnboardingPage(response, subjects, label) {
  assert.equal(response.status, 404, label + ": unauthorized setup page must be hidden");
  assertNoForeignMarker(response, subjects, label);
}

export async function verifyClientOnboardingPageTenantIsolation() {
  // Hard-refuse unsafe environments BEFORE importing the database or touching SQL.
  requireDisposableClientOnboardingEnv();
  const [{ db, pool }, schema, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  try {
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    // Real victim-only IDs must exceed 6, including on a brand-new PG16
    // sequence. Seed four distinct disposable employer fixtures first rather
    // than weakening the high-ID negative control or relying on old rows.
    for (const padding of ["PAD1", "PAD2", "PAD3", "PAD4"]) {
      await fixture.seedEmployer(padding, nonce, fixture.standaloneMakeSession);
    }
    const a = await fixture.seedEmployer("ATTA", nonce, fixture.standaloneMakeSession);
    const b = await fixture.seedEmployer("ATTB", nonce, fixture.standaloneMakeSession);
    const victim = await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession);
    const employers = [a, b, victim];
    assert.equal(new Set(employers.map(e => e.org.id)).size, 3);
    assert.equal(new Set(employers.map(e => e.cookie)).size, 3);
    for (const prop of ["org", "worker", "owner", "unit"]) {
      assert.ok(victim[prop].id > Math.max(a[prop].id, b[prop].id, 6),
        "Must exercise a real, higher-ID victim-only " + prop);
    }

    async function scopedActor(role, orgUnitId = null) {
      const [user] = await db.insert(schema.users).values({
        name: "Fictional setup " + role + " " + nonce,
        email: "setup-" + role + "-" + nonce + "-" + (orgUnitId ?? "all") + "@example.invalid",
        passwordHash: "fictional-no-login", role,
      }).returning({ id: schema.users.id });
      await db.insert(schema.userOrganizations).values({
        userId: user.id, organizationId: a.org.id, role, orgUnitId, active: true,
      });
      return fixture.standaloneMakeSession(user.id);
    }
    const hr = await scopedActor("hr");
    const bookkeeper = await scopedActor("bookkeeper");
    const unitAdmin = await scopedActor("admin", a.unit.id);

    const protectedTables = ["organizations", "legalEntities", "employees",
      "userOrganizations", "payrollRuns", "auditEvents"];
    async function snapshot(orgId) {
      const result = {};
      for (const name of protectedTables) {
        const t = schema[name];
        assert.ok(t?.id && (name === "organizations" || t.organizationId));
        result[name] = await db.select().from(t)
          .where(eq(name === "organizations" ? t.id : t.organizationId, orgId))
          .orderBy(asc(t.id));
      }
      return JSON.parse(JSON.stringify(result));
    }
    const before = new Map(await Promise.all(employers.map(async subject =>
      [subject.org.id, await snapshot(subject.org.id)])));

    let ownPages = 0;
    let deniedForeign = 0;
    for (const actor of [a, b]) {
      const me = await getLocal("/api/account", actor.cookie);
      assert.equal(me.status, 200, "Own owner session must be genuinely authenticated");
      const myPage = await getLocal(pageUrl(actor.org.id), actor.cookie);
      assertOwnOnboardingPage(myPage, actor,
        employers.filter(e => e.org.id !== actor.org.id));
      ownPages++;

      for (const other of employers.filter(e => e.org.id !== actor.org.id)) {
        const denied = await getLocal(pageUrl(other.org.id), actor.cookie);
        assertDeniedOnboardingPage(denied, employers, "authenticated cross-employer");
        deniedForeign++;
      }

      for (const invalid of ["0", "-1", "01", "1e0", "1.1", "9007199254740992", "bogus"]) {
        const denied = await getLocal(pageUrl(invalid), actor.cookie);
        assertDeniedOnboardingPage(denied, employers, "invalid employer selector");
      }
      assertDeniedOnboardingPage(await getLocal(
        pageUrl(actor.org.id) + "&organizationId=" + actor.org.id, actor.cookie),
      employers, "duplicate employer selector");

      for (const subject of employers) {
        assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id),
          "Onboarding GET must not mutate employer, roster, payroll, access or audit");
      }
    }
    assert.equal(ownPages, 2);
    assert.equal(deniedForeign, 4);

    for (const [label, cookie] of [
      ["company-wide HR", hr.cookie],
      ["company-wide bookkeeper", bookkeeper.cookie],
      ["unit-scoped admin", unitAdmin.cookie],
    ]) {
      assertDeniedOnboardingPage(await getLocal(pageUrl(a.org.id), cookie),
        employers, label + " must not gain owner-only setup access");
    }

    const anonymous = await getLocal(pageUrl(victim.org.id));
    assert.ok([302, 303, 307, 308].includes(anonymous.status),
      "Anonymous requests must redirect to login, not render victim setup");
    assertNoForeignMarker(anonymous, employers, "anonymous");

    const revoked = await db.update(schema.userOrganizations).set({ active: false })
      .where(and(
        eq(schema.userOrganizations.userId, a.owner.id),
        eq(schema.userOrganizations.organizationId, a.org.id),
        eq(schema.userOrganizations.active, true),
      )).returning({ id: schema.userOrganizations.id });
    assert.equal(revoked.length, 1, "Revoke one actual active owner membership");
    const stillSignedIn = await getLocal("/api/account", a.cookie);
    assert.equal(stillSignedIn.status, 200, "Revocation must not be confused with logout");
    assertDeniedOnboardingPage(await getLocal(pageUrl(a.org.id), a.cookie),
      employers, "revoked membership");

    for (const other of [b, victim]) {
      assert.deepEqual(await snapshot(other.org.id), before.get(other.org.id),
        "Denied setup GETs may not change any unrelated employer, payroll or audit");
    }

    const outcome = { kind: "CLIENT_ONBOARDING_FICTIONAL_PG16_UNACCEPTED",
      employers: 3, ownPages, deniedForeign, deniedRoleAndUnitSessions: 3,
      revokedMembershipDenied: true, victimRecordsUnchanged: true,
      pageCredits: 0, methodCredits: 0, productionCertified: false };
    console.log("CLIENT_ONBOARDING_HTTP_COMPLETE " + JSON.stringify(outcome));
    return outcome;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-client-onboarding-page-http.mjs")) {
  verifyClientOnboardingPageTenantIsolation().catch(e => {
    console.error("CLIENT_ONBOARDING_HTTP_FAILED: " + (e instanceof Error ? e.stack : String(e)));
    process.exitCode = 1;
  });
}
