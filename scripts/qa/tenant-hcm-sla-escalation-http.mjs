import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { requireDisposableHcmSla, assertDenied, assertSweepResponse,
  assertTenantEscalation, assertUnchanged } from "./tenant-hcm-sla-escalation-contract.mjs";

// No database import, fixture write or HTTP call is permitted before preflight.
requireDisposableHcmSla(process.env);
const { db, pool } = await import("../../src/db/index.ts");
const t = await import("../../src/db/schema.ts");
const { seedEmployer, standaloneMakeSession } = await import("./tenant-table-http.mjs");

const tables = Object.freeze({
  cases: "automation_operational_cases",
  events: "hcm_work_item_events",
  outbox: "outbox",
  employees: "employees",
  payProfiles: "employee_pay_profiles",
  payrollRuns: "payroll_runs",
  audits: "audit_events",
});
const plain = value => JSON.parse(JSON.stringify(value));

async function snapshot(organizationId) {
  const result = {};
  for (const [key, table] of Object.entries(tables)) {
    const { rows } = await pool.query(
      "SELECT * FROM " + table + " WHERE organization_id = $1 ORDER BY id", [organizationId]);
    result[key] = plain(rows);
  }
  return result;
}

async function caseFixture(employer, sourceId, kind) {
  const now = Date.now();
  const pastDue = new Date(now - 3 * 60 * 60 * 1000);
  const pastEscalate = new Date(now - 2 * 60 * 60 * 1000);
  const futureEscalate = new Date(now + 24 * 60 * 60 * 1000);
  const [row] = await db.insert(t.automationOperationalCases).values({
    organizationId: employer.org.id,
    caseType: "coverage_recovery",
    sourceType: "fictional_qa",
    sourceId,
    ownerTeam: "HR Operations",
    assignedOwnerUserId: employer.owner.id,
    title: employer.marker + " fictional SLA " + kind,
    detail: "Synthetic HR work item; no employee details or service providers",
    status: kind === "resolved" ? "resolved" : "open",
    slaDueAt: kind === "future" ? futureEscalate : pastDue,
    slaEscalateAt: kind === "future" ? futureEscalate : pastEscalate,
  }).returning();
  assert.ok(row && Number.isSafeInteger(row.id), "persisted work item required");
  return row;
}

async function excludedRecipient(employer, kind) {
  const [user] = await db.insert(t.users).values({
    name: employer.marker + " " + kind,
    email: (employer.marker + "-" + kind + "@example.invalid").toLowerCase(),
    passwordHash: "fictional-no-login",
    role: "hr",
    active: true,
  }).returning();
  await db.insert(t.userOrganizations).values({
    userId: user.id, organizationId: employer.org.id, role: "hr",
    orgUnitId: kind === "unit-scoped" ? employer.unit.id : null,
    active: kind !== "revoked",
  });
  return user;
}

async function sweep(token) {
  const headers = { origin: process.env.SECURITY_SMOKE_URL, "sec-fetch-site": "same-origin" };
  if (token !== undefined) headers.authorization = "Bearer " + token;
  const response = await fetch(new URL("/api/hcm/work-items/escalate", process.env.SECURITY_SMOKE_URL), {
    method: "POST", headers, cache: "no-store", redirect: "manual",
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* assertions reject malformed success */ }
  return { status: response.status, text, json, headers: response.headers };
}

let finished = false;
try {
  const database = await pool.query("SELECT current_database() AS name, current_setting('server_version_num')::int AS version");
  assert.equal(database.rows[0].name, "app_db");
  assert.equal(Math.floor(database.rows[0].version / 10000), 16);
  const empty = await pool.query("SELECT count(*)::int AS count FROM organizations");
  assert.equal(empty.rows[0].count, 0, "requires a fresh, empty disposable database");

  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
  const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
  const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
  assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id,
    "real victim employer ID must be higher than both actors");
  assert.ok(a.owner.email.endsWith("@example.invalid") &&
    b.owner.email.endsWith("@example.invalid"), "fictional recipients only");

  // Unit-scoped and revoked HR members are deliberately ineligible for an email.
  for (const employer of [a, b]) {
    await excludedRecipient(employer, "unit-scoped");
    await excludedRecipient(employer, "revoked");
  }

  const dueA = await caseFixture(a, 101, "due");
  await caseFixture(a, 102, "future");
  const dueB = await caseFixture(b, 201, "due");
  await caseFixture(b, 202, "resolved");
  const protectedCase = await caseFixture(victim, 301, "future");
  assert.ok(protectedCase.id > dueA.id && protectedCase.id > dueB.id,
    "persisted higher-ID ineligible victim case required");

  const orgs = [a, b, victim];
  const takeAll = async () => Promise.all(orgs.map(x => snapshot(x.org.id)));
  const before = await takeAll();
  const forbidden = [a.marker, b.marker, victim.marker];

  // An unauthorized global cron request must not alter any organization's SQL.
  assertDenied(await sweep(undefined), 401, forbidden);
  assertDenied(await sweep("bad-fake-token"), 401, forbidden);
  const afterUnauthorized = await takeAll();
  for (let index = 0; index < orgs.length; index++) {
    assertUnchanged(before[index], afterUnauthorized[index]);
  }

  const first = await sweep(process.env.HCM_SLA_CRON_SECRET);
  assertSweepResponse(first, 2, forbidden);
  const after = await takeAll();
  assertTenantEscalation(before[0], after[0], {
    caseId: dueA.id, organizationId: a.org.id, recipient: a.owner.email, ownerId: a.owner.id,
    foreignMarkers: [b.marker, victim.marker],
  });
  assertTenantEscalation(before[1], after[1], {
    caseId: dueB.id, organizationId: b.org.id, recipient: b.owner.email, ownerId: b.owner.id,
    foreignMarkers: [a.marker, victim.marker],
  });
  assertUnchanged(before[2], after[2]);

  // The same bearer token and due cases cannot enqueue a duplicate notification.
  assertSweepResponse(await sweep(process.env.HCM_SLA_CRON_SECRET), 0, forbidden);
  const afterRetry = await takeAll();
  for (let index = 0; index < orgs.length; index++) {
    assertUnchanged(after[index], afterRetry[index]);
  }

  const receipt = {
    kind: "tenant-hcm-sla-escalation-pg16-http-v1",
    postgresMajor: 16,
    independentEmployerEscalations: 2,
    unauthorizedDenials: 2,
    duplicateEscalationsOnRetry: 0,
    disallowedRecipientNotifications: 0,
    higherIdProtectedCaseUnchanged: true,
    victimPayrollAndAuditUnchanged: true,
    notificationsQueuedOnly: true,
    realNotificationsSent: false,
    coverageCredits: 0,
    independentlyAccepted: false,
    productionTested: false,
  };
  mkdirSync("outputs", { recursive: true });
  writeFileSync("outputs/tenant-hcm-sla-escalation.json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
  finished = true;
} finally {
  await pool.end();
}
assert.ok(finished, "full persisted PostgreSQL and real-HTTP path must finish");
