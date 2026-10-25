/**
 * Independent feature-ON manager-of-record proof. Only fictional employers
 * and isolated PostgreSQL 16 / localhost Next are allowed. Neither a unit
 * directory nor a same-tenant empty 200 is accepted as direct-report proof.
 *
 * This must be executed by the protected tenant-second-pass runner before
 * a route/page can receive provisional source-linked isolation coverage.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  employees, jobProfiles, orgUnits, payrollRuns, permissionSets,
  positionAssignments, positions, userOrganizations,
  userPermissionAssignments, users,
} from "../../src/db/schema";

const ORIGIN = "http://127.0.0.1:3002";
const OFF_ORIGIN = "http://127.0.0.1:3000";
const PAGE = "/hcm/manager-direct-reports";
const API = "/api/hcm/manager-direct-reports";

function requireDisposable() {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.SECURITY_SMOKE_URL, OFF_ORIGIN);
  assert.equal(url.protocol, "postgresql:");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY);
}

async function requestOn(path, cookie, origin = ORIGIN) {
  const response = await fetch(new URL(path, origin), {
    headers: { cookie }, redirect: "manual", cache: "no-store",
  });
  return {
    status: response.status,
    text: await response.text(),
    headers: response.headers,
  };
}

/** Two independently signed-in managers, real owned direct reports, real victim. */
export async function verifyHcmManagerDirectReports(f, { makeSession }) {
  requireDisposable();
  assert.equal(f.orgs.length, 3);
  assert.equal(f.ownerSessions.length, 3);
  assert.ok(f.victimEmployee.id > 6);

  const nonce = randomUUID().slice(0, 8);
  const workers = await Promise.all([
    f.victimEmployee.id, f.ownedEmployees[0].id, f.ownedEmployees[1].id,
  ].map(async (id) => {
    const [worker] = await db.select().from(employees).where(eq(employees.id, id));
    assert.ok(worker && worker.orgUnitId);
    return worker;
  }));
  for (let idx = 0; idx < 3; idx++) {
    assert.equal(workers[idx].organizationId, f.orgs[idx].id);
    const [unit] = await db.select().from(orgUnits)
      .where(eq(orgUnits.id, workers[idx].orgUnitId));
    assert.equal(unit.organizationId, f.orgs[idx].id);
    assert.equal(unit.active, true);
  }

  const managers = await db.insert(users).values(f.orgs.map((org, idx) => ({
    email: "direct-http-manager-" + idx + "-" + nonce + "@example.invalid",
    name: "Disposable manager " + idx, role: "manager",
    passwordHash: "not-a-real-login",
  }))).returning({ id: users.id });
  const memberships = await db.insert(userOrganizations).values(
    managers.map((user, idx) => ({
      userId: user.id, organizationId: f.orgs[idx].id,
      role: "manager", active: true,
      orgUnitId: workers[idx].orgUnitId, workerEmployeeId: workers[idx].id,
    }))
  ).returning({ id: userOrganizations.id });

  // The employer-exclusive victim direct report is inserted AFTER both
  // attacker's real employees, so its persisted ID exceeds both own IDs.
  const directWorkers = await db.insert(employees).values([1, 2, 0].map((idx) => ({
    organizationId: f.orgs[idx].id, orgUnitId: workers[idx].orgUnitId,
    employeeNo: (idx === 0 ? "VICTIM-DIRECT-" : "OWN-DIRECT-" + idx + "-") + nonce,
    firstName: idx === 0 ? "VictimPrivateDirect" : "OwnedDirect" + idx,
    lastName: "Synthetic", title: "Current direct-report fixture",
    avatarInitials: "DR", basicRate: "10000.00", startDate: "2025-01-01",
  }))).returning();
  assert.ok(directWorkers[2].id > directWorkers[0].id &&
    directWorkers[2].id > directWorkers[1].id && directWorkers[2].id > 6,
  "Real victim-only direct worker ID must exceed both attacker-owned IDs");

  const profiles = await db.insert(jobProfiles).values([1, 2, 0].map((idx) => ({
    organizationId: f.orgs[idx].id, title: "Direct reports QA " + idx,
  }))).returning();
  const managerOrder = [1, 2, 0];
  const positionsInserted = await db.insert(positions).values(managerOrder.map((idx, n) => ({
    organizationId: f.orgs[idx].id,
    code: "DIRECT-QA-" + idx + "-" + nonce,
    jobProfileId: profiles[n].id,
    orgUnitId: workers[idx].orgUnitId,
    supervisoryOrgUnitId: workers[idx].orgUnitId,
    managerEmployeeId: workers[idx].id, status: "filled",
  }))).returning();
  await db.insert(positionAssignments).values(directWorkers.map((worker, n) => ({
    organizationId: worker.organizationId, employeeId: worker.id,
    positionId: positionsInserted[n].id, assignmentType: "primary",
    effectiveFrom: "2025-01-01",
  })));

  const managerSessions = await Promise.all(managers.map((manager) =>
    makeSession(manager.id, { privileged: true })));
  const victim = f.orgs[0];
  const victimWorkersBefore = await db.select().from(employees)
    .where(eq(employees.organizationId, victim.id)).orderBy(employees.id);
  const victimPayrollBefore = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, victim.id)).orderBy(payrollRuns.id);
  const victimMarker = directWorkers[2].employeeNo;
  const server = spawn(process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", "3002", "-H", "127.0.0.1"], {
      env: {
        ...process.env, APP_BASE_URL: ORIGIN,
        HCM_MANAGER_TEAM_ENABLED: "true",
        HCM_MANAGER_TEAM_ORG_IDS: f.orgs.map((org) => org.id).join(","),
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
        throw new Error("Isolated manager server failed: " + (startError?.message ?? log));
      }
      try {
        const response = await fetch(ORIGIN + "/login", { cache: "no-store" });
        if (response.ok) { ready = true; break; }
      } catch { /* Wait only for this localhost server. */ }
      await delay(500);
    }
    assert.ok(ready, "Isolated manager server unavailable: " + log);

    for (const idx of [1, 2]) {
      const own = f.orgs[idx];
      const cookie = managerSessions[idx].cookie;
      const ownWorker = directWorkers[idx - 1];
      const ownApi = await requestOn(API + "?organizationId=" + own.id, cookie);
      assert.equal(ownApi.status, 200, "Manager must read real own direct-report GET");
      const data = JSON.parse(ownApi.text);
      assert.equal(data.organizationId, own.id);
      assert.deepEqual(data.scope, {
        kind: "verified_direct_reports", orgUnitId: workers[idx].orgUnitId,
      });
      assert.equal(data.items.length, 1, "Only true current reports, not peers or unit members");
      assert.equal(data.items[0].employeeNo, ownWorker.employeeNo);
      assert.ok(!ownApi.text.includes(victimMarker));
      assert.ok(!ownApi.text.includes("basicRate"));

      const ownPage = await requestOn(PAGE + "?organizationId=" + own.id, cookie);
      assert.equal(ownPage.status, 200, "Authorized own direct-report page");
      assert.match(ownPage.headers.get("content-type") ?? "", /text\/html/i);
      assert.ok(ownPage.text.includes(ownWorker.employeeNo));
      assert.ok(!ownPage.text.includes(victimMarker));

      const foreignApi = await requestOn(API + "?organizationId=" + victim.id, cookie);
      assert.equal(foreignApi.status, 403, "Authenticated foreign manager denied for real victim");
      assert.ok(!foreignApi.text.includes(victimMarker));
      const foreignPage = await requestOn(PAGE + "?organizationId=" + victim.id, cookie);
      assert.equal(foreignPage.status, 404, "Authenticated foreign manager page must be hidden");
      assert.ok(!foreignPage.text.includes(victimMarker));

      const offApi = await requestOn(API + "?organizationId=" + own.id, cookie, OFF_ORIGIN);
      assert.equal(offApi.status, 404, "Flag-OFF server must never expose direct reports");
      const offPage = await requestOn(PAGE + "?organizationId=" + own.id, cookie, OFF_ORIGIN);
      assert.equal(offPage.status, 404, "Flag-OFF page must remain unavailable");
    }

    const ownerApi = await requestOn(API + "?organizationId=" + f.orgs[1].id,
      f.ownerSessions[1].cookie);
    assert.equal(ownerApi.status, 403, "An employer owner is not automatically a manager of record");

    const [deny] = await db.insert(permissionSets).values({
      organizationId: f.orgs[1].id, name: "Deny workforce " + nonce,
      permissions: ["people.admin"], active: true,
    }).returning();
    const [restriction] = await db.insert(userPermissionAssignments).values({
      organizationId: f.orgs[1].id,
      userOrganizationId: memberships[1].id, permissionSetId: deny.id,
    }).returning();
    try {
      const blocked = await requestOn(API + "?organizationId=" + f.orgs[1].id,
        managerSessions[1].cookie);
      assert.equal(blocked.status, 403, "Explicit custom permission deny must override manager role");
    } finally {
      await db.delete(userPermissionAssignments)
        .where(eq(userPermissionAssignments.id, restriction.id));
    }

    assert.deepEqual(await db.select().from(employees)
      .where(eq(employees.organizationId, victim.id)).orderBy(employees.id),
      victimWorkersBefore, "Denied manager reads must not modify victim employees");
    assert.deepEqual(await db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, victim.id)).orderBy(payrollRuns.id),
      victimPayrollBefore, "Denied manager reads must not modify victim payroll");
    console.log("PASS provisional manager direct reports: 2 manager sessions, own 200/nonempty, real victim API 403/page 404, permissions and flag-OFF denial, unchanged victim data");
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
