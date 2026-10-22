/**
 * Feature-ON Manager Decision Inbox page proof against fictional employers only.
 * Run inside the existing guarded PG16 security-smoke fixture: a second
 * localhost-only Next server is started with an exact three-employer allowlist.
 * The ordinary security-smoke server and production flags remain unchanged.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { employees, payrollRuns } from "../../src/db/schema";

const ORIGIN = "http://127.0.0.1:3001";
const PAGE = "/hcm/manager-decision-inbox";

function requireDisposable() {
  const database = new URL(process.env.DATABASE_URL ?? "invalid:");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  assert.equal(database.protocol, "postgresql:");
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
  assert.equal(database.port, "5432");
  assert.equal(database.pathname, "/app_db");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY,
    "Never use real provider credentials for this isolated read proof");
}

async function requestOn(path, cookie) {
  const response = await fetch(new URL(path, ORIGIN), {
    headers: { cookie }, redirect: "manual", cache: "no-store",
  });
  return {
    status: response.status,
    text: await response.text(),
    headers: response.headers,
  };
}

/** These are real, signed-in Next.js HTTP requests, never a mocked page. */
export async function verifyHcmManagerInboxPage(f) {
  requireDisposable();
  assert.equal(f.orgs.length, 3);
  assert.equal(new Set(f.orgs.map((org) => org.id)).size, 3);
  assert.ok(f.victimEmployee?.id > 6 && f.victimEmployee.employeeNo,
    "A persisted exclusive victim worker is mandatory");
  assert.equal(f.ownerSessions.length, 3);

  // Exact synthetic employer IDs are available only after fixture seeding.
  // They are NEVER assigned to a deployed process or the feature-OFF server.
  const server = spawn(process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", "3001", "-H", "127.0.0.1"], {
      env: {
        ...process.env, APP_BASE_URL: ORIGIN,
        HCM_MANAGER_DECISION_INBOX_ENABLED: "true",
        HCM_MANAGER_DECISION_INBOX_ORG_IDS: f.orgs.map((org) => org.id).join(","),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  let log = "";
  let startError = null;
  const capture = (chunk) => { log = (log + String(chunk)).slice(-12000); };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);
  server.on("error", (error) => { startError = error; });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (startError || server.exitCode !== null) {
        throw new Error("Disposable inbox server failed: " + (startError?.message ?? log));
      }
      try {
        const response = await fetch(ORIGIN + "/login", { cache: "no-store" });
        if (response.ok) { ready = true; break; }
      } catch { /* No listener until the localhost-only server is ready. */ }
      await delay(500);
    }
    assert.ok(ready, "Disposable flag-ON Next server unavailable: " + log);

    const victim = f.orgs[0];
    const victimWorkersBefore = await db.select().from(employees)
      .where(eq(employees.organizationId, victim.id)).orderBy(employees.id);
    const victimPayrollBefore = await db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, victim.id)).orderBy(payrollRuns.id);
    assert.ok(victimWorkersBefore.some((employee) => employee.id === f.victimEmployee.id));

    for (const idx of [1, 2]) {
      const own = f.orgs[idx];
      const cookie = f.ownerSessions[idx].cookie;
      const [realWorker] = await db.select().from(employees)
        .where(eq(employees.id, f.ownedEmployees[idx - 1].id)).limit(1);
      assert.equal(realWorker?.organizationId, own.id,
        "Own employer must have a real PostgreSQL worker, not an empty fake tenant");

      const ownPage = await requestOn(PAGE + "?organizationId=" + own.id, cookie);
      assert.equal(ownPage.status, 200, "Authorized employer must render the real inbox page");
      assert.match(ownPage.headers.get("content-type") ?? "", /text\/html/i);
      assert.ok(ownPage.text.includes("My Decision Inbox"));
      assert.ok(ownPage.text.includes("organizationId=" + own.id),
        "Authorized SSR response must bind the real selected employer");

      const foreignPage = await requestOn(PAGE + "?organizationId=" + victim.id, cookie);
      assert.equal(foreignPage.status, 404,
        "Authenticated attacker must not render a real victim employer's inbox");
      assert.ok(!foreignPage.text.includes(victim.name));
      assert.ok(!foreignPage.text.includes(f.victimEmployee.employeeNo));

      // The page's client GET has an independent server-side role/tenant gate.
      const ownApi = await requestOn(
        "/api/hcm/manager-decision-inbox?organizationId=" + own.id + "&source=hcm", cookie);
      assert.equal(ownApi.status, 200, "Own feature-ON API read must be authorized");
      const ownEnvelope = JSON.parse(ownApi.text);
      assert.equal(ownEnvelope.organizationId, own.id);
      assert.deepEqual(ownEnvelope.scope, { kind: "company", orgUnitId: null });
      assert.ok(!ownApi.text.includes(victim.name));

      const foreignApi = await requestOn(
        "/api/hcm/manager-decision-inbox?organizationId=" + victim.id + "&source=hcm", cookie);
      assert.equal(foreignApi.status, 403,
        "The real victim employer must be enabled yet remain forbidden to the attacker");
      assert.ok(!foreignApi.text.includes(f.victimEmployee.employeeNo));
    }

    assert.deepEqual(await db.select().from(employees)
      .where(eq(employees.organizationId, victim.id)).orderBy(employees.id),
      victimWorkersBefore, "Denied page and API reads cannot change victim employees");
    assert.deepEqual(await db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, victim.id)).orderBy(payrollRuns.id),
      victimPayrollBefore, "Denied page and API reads cannot change victim payroll");
    console.log("PASS: manager inbox, two distinct owners, own 200, victim 404/API 403; no victim data or writes");
  } finally {
    server.kill("SIGTERM");
    if (server.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        delay(4000),
      ]);
    }
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
