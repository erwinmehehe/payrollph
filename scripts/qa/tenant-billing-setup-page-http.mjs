/**
 * Billing setup SSR: two independently authenticated owners, real victim IDs,
 * distinct employers, unit/role/revocation denials and unchanged victim SQL.
 * Disposable PostgreSQL 16 + production-mode localhost HTTP only.
 * This is bounded, unaccepted page evidence and awards ZERO coverage credits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ORIGIN = "http://127.0.0.1:3000";

export function requireDisposableBillingPageEnv(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    DEMO_MODE: "false",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_BILLING_PAGE_PROOF: "fictional-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN,
    TRUSTED_APP_ORIGINS: ORIGIN,
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(required)) {
    assert.equal(env[key], value, "BILLING_PAGE_REFUSED: " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL",
    "SMTP_PASSWORD", "STRIPE_SECRET_KEY", "OPENAI_API_KEY",
  ]) {
    assert.ok(!env[key], "BILLING_PAGE_REFUSED: provider credential " + key);
  }
}

async function readLocal(path, cookie) {
  assert.ok(path === "/api/account" ||
    path === "/billing/setup" || path.startsWith("/billing/setup?"),
  "Only the reviewed billing setup GET and account authentication are allowed");
  const response = await fetch(ORIGIN + path, {
    method: "GET", headers: cookie ? { cookie } : {},
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json = null;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    try { json = JSON.parse(text); } catch { /* Explicit status checks still apply. */ }
  }
  return { status: response.status, text, json,
    contentType: response.headers.get("content-type") ?? "" };
}

function noForeignMarkers(response, employers, label) {
  for (const employer of employers) {
    assert.ok(!response.text.includes(employer.org.name),
      label + ": foreign employer SSR marker disclosed");
    assert.ok(!response.text.includes(employer.worker.employeeNo),
      label + ": foreign worker marker disclosed");
  }
}

function assertOwnBillingPage(response, own, foreign) {
  assert.equal(response.status, 200, own.label + " owned billing SSR must succeed");
  assert.match(response.contentType, /text\/html/i);
  assert.ok(response.text.includes(own.org.name),
    "Successful billing SSR must render the actual persisted owned company name");
  assert.ok(response.text.includes("Subscription"),
    "Successful billing SSR must render the real subscription interface");
  noForeignMarkers(response, foreign, own.label + " own page");
}

function assertDeniedBillingPage(response, foreign, label) {
  assert.equal(response.status, 404, label + ": private billing SSR must be hidden");
  noForeignMarkers(response, foreign, label);
}

export async function verifyBillingSetupPageTenantIsolation() {
  // Hard-stop before ANY application/database module import or SQL connection.
  requireDisposableBillingPageEnv();

  const [{ db, pool }, schema, { and, asc, eq }, table] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  try {
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    // Seed attackers before victim: real, persisted victim IDs are higher.
    const a = { ...(await table.seedEmployer("ATTA", nonce, table.standaloneMakeSession)), label: "A" };
    const b = { ...(await table.seedEmployer("ATTB", nonce, table.standaloneMakeSession)), label: "B" };
    const victim = { ...(await table.seedEmployer("VICTIM", nonce, table.standaloneMakeSession)), label: "victim" };
    const subjects = [a, b, victim];

    assert.equal(new Set(subjects.map(x => x.org.id)).size, 3);
    assert.equal(new Set(subjects.map(x => x.cookie)).size, 3);
    for (const field of ["org", "entity", "unit", "worker", "owner"]) {
      assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id,
        "Victim-only " + field + " must have a real ID higher than both attackers");
    }

    async function scopedActor(role, orgUnitId = null) {
      const [user] = await db.insert(schema.users).values({
        name: "Fictional " + role + " " + nonce,
        email: "billing-" + role + "-" + nonce + "-" + (orgUnitId ?? "all") + "@example.invalid",
        passwordHash: "fictional-no-password-login", role: role === "group_hr" ? "owner" : role,
      }).returning({ id: schema.users.id });
      await db.insert(schema.userOrganizations).values({
        userId: user.id, organizationId: a.org.id, role,
        orgUnitId, active: true,
      });
      const session = await table.standaloneMakeSession(user.id);
      await db.update(schema.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(schema.sessions.id, session.id));
      return { ...session, user };
    }
    const hr = await scopedActor("hr");
    const scopedBookkeeper = await scopedActor("bookkeeper", a.unit.id);
    const group = await scopedActor("group_hr");

    const protectedTables = [
      "organizations", "legalEntities", "orgUnits", "employees", "employeePayProfiles",
      "payrollRuns", "subscriptions", "invoices", "userOrganizations", "auditEvents",
    ];
    async function snapshot(orgId) {
      const result = {};
      for (const name of protectedTables) {
        const tableSchema = schema[name];
        assert.ok(tableSchema?.id, "Required real SQL table missing: " + name);
        result[name] = await db.select().from(tableSchema)
          .where(eq(name === "organizations" ? tableSchema.id : tableSchema.organizationId, orgId))
          .orderBy(asc(tableSchema.id));
      }
      return JSON.parse(JSON.stringify(result));
    }
    const before = new Map(await Promise.all(subjects.map(async subject =>
      [subject.org.id, await snapshot(subject.org.id)])));

    const ownPath = id => "/billing/setup?organizationId=" + id;
    let ownSuccesses = 0;
    let foreignDenials = 0;
    for (const actor of [a, b]) {
      const authentication = await readLocal("/api/account", actor.cookie);
      assert.equal(authentication.status, 200, "A real owner must be authenticated over HTTP");
      assert.equal(authentication.json?.profile?.id, actor.owner.id);

      assertOwnBillingPage(await readLocal(ownPath(actor.org.id), actor.cookie),
        actor, subjects.filter(item => item.org.id !== actor.org.id));
      assertOwnBillingPage(await readLocal("/billing/setup", actor.cookie),
        actor, subjects.filter(item => item.org.id !== actor.org.id));
      ownSuccesses++;

      for (const other of subjects.filter(item => item.org.id !== actor.org.id)) {
        const denied = await readLocal(ownPath(other.org.id), actor.cookie);
        assertDeniedBillingPage(denied, subjects, actor.label + " -> " + other.label);
        foreignDenials++;
      }
      for (const invalid of ["0", "-1", "01", "1e0", "bad", "9007199254740992"]) {
        const denied = await readLocal(ownPath(invalid), actor.cookie);
        assertDeniedBillingPage(denied, subjects, actor.label + " invalid " + invalid);
      }
      assertDeniedBillingPage(await readLocal(ownPath(actor.org.id) +
        "&organizationId=" + actor.org.id, actor.cookie), subjects,
        actor.label + " duplicate employer selector");

      for (const subject of subjects) {
        assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id),
          "Read-only owner page/foreign/invalid GETs cannot change " + subject.label + " database/audit");
      }
    }
    assert.equal(ownSuccesses, 2);
    assert.equal(foreignDenials, 4);

    for (const [label, cookie] of [
      ["company-wide HR", hr.cookie],
      ["unit-scoped bookkeeper", scopedBookkeeper.cookie],
      ["unapproved group HR", group.cookie],
    ]) {
      const signedIn = await readLocal("/api/account", cookie);
      assert.equal(signedIn.status, 200, label + " must have real authenticated session");
      assertDeniedBillingPage(await readLocal(ownPath(a.org.id), cookie),
        subjects, label + " cannot render billing setup");
    }

    const anonymous = await readLocal(ownPath(victim.org.id));
    assert.ok([302, 303, 307, 308].includes(anonymous.status),
      "Anonymous user must redirect to login rather than render employer billing");
    noForeignMarkers(anonymous, subjects, "anonymous billing response");

    const revoked = await db.update(schema.userOrganizations).set({ active: false })
      .where(and(
        eq(schema.userOrganizations.userId, a.owner.id),
        eq(schema.userOrganizations.organizationId, a.org.id),
        eq(schema.userOrganizations.active, true),
      )).returning({ id: schema.userOrganizations.id });
    assert.equal(revoked.length, 1, "Exactly one active owner membership revoked");
    const stillSignedIn = await readLocal("/api/account", a.cookie);
    assert.equal(stillSignedIn.status, 200, "Revoked owner's session must remain valid");
    assert.equal(stillSignedIn.json?.profile?.id, a.owner.id);
    assertDeniedBillingPage(await readLocal(ownPath(a.org.id), a.cookie),
      subjects, "revoked membership / still-valid session");

    for (const other of [b, victim]) {
      assert.deepEqual(await snapshot(other.org.id), before.get(other.org.id),
        "No victim/independent attacker employer, payroll, billing, membership or audit mutations");
    }
    const ownAfter = await snapshot(a.org.id);
    const ownBefore = before.get(a.org.id);
    for (const name of protectedTables.filter(name => name !== "userOrganizations")) {
      assert.deepEqual(ownAfter[name], ownBefore[name],
        "Read-only billing GETs must not modify employer table " + name);
    }
    assert.deepEqual(
      ownAfter.userOrganizations.filter(row => row.userId !== a.owner.id),
      ownBefore.userOrganizations.filter(row => row.userId !== a.owner.id),
      "Role/revocation tests may not modify any other member");
    assert.ok(ownAfter.userOrganizations.some(row => row.userId === a.owner.id && !row.active));

    const summary = {
      kind: "BILLING_PAGE_FICTIONAL_PG16_UNACCEPTED",
      employers: 3, independentAttackerOwners: 2,
      realOwnPages: ownSuccesses, realForeignPageDenials: foreignDenials,
      deniedUnitAndRoleSessions: 3, revokedStillSignedIn: true,
      victimBillingPayrollAndAuditUnchanged: true,
      pageCredits: 0, methodCredits: 0, productionCertified: false,
    };
    console.log("BILLING_PAGE_HTTP_COMPLETE " + JSON.stringify(summary));
    return summary;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-billing-setup-page-http.mjs")) {
  verifyBillingSetupPageTenantIsolation().catch(error => {
    console.error("BILLING_PAGE_HTTP_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
