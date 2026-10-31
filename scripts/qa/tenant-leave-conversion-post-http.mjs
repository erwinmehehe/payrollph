/**
 * Actual Next.js localhost HTTP and disposable PostgreSQL 16 for
 * POST /api/leave/conversion only. Ficitional leave days, zero real pay.
 * seed (before server) configures exact per-org cash caps; verify tests method.
 */
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const mode = process.argv[2] ?? "verify";
assert.ok(["seed", "verify"].includes(mode), "seed or verify required");
for (const [key, expected] of [
  ["CI", "true"], ["GITHUB_ACTIONS", "true"],
  ["TENANT_SECOND_PASS_MODE", "isolated-ci-only"],
  ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"],
  ["SECURITY_SMOKE_URL", "http://127.0.0.1:3000"],
  ["PAYMONGO_DISBURSEMENTS_ENABLED", "false"], ["XENDIT_PAYOUTS_ENABLED", "false"],
  ["WORKER_ENABLED", "false"], ["CENTRAL_SCHEDULER_ENABLED", "false"],
]) assert.equal(process.env[key], expected, "Refuse non-disposable: " + key);
assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY);
const [{ db, pool }, schema, orm, http] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
  import("drizzle-orm"), import("./tenant-table-http.mjs"),
]);
const { asc, eq } = orm;
const { seedEmployer, standaloneMakeSession, standaloneRequest,
  requireTenantTableDisposable } = http;
requireTenantTableDisposable();
const fixturePath = "/tmp/tenant-leave-conversion-post-fixture.json";
const leaveType = "Vacation leave";
const year = Number(new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila", year: "numeric",
}).format(new Date()));
const plain = value => JSON.parse(JSON.stringify(value));
let assertions = 0;
function check(ok, label) { assert.ok(ok, label); assertions++; }
function expect(r, status, label) {
  assert.equal(r.status, status, label + " HTTP " + r.status + " " + r.text.slice(0, 200));
  assertions++;
  return r;
}
async function snapshot(e) {
  const scoped = t => db.select().from(t).where(eq(t.organizationId, e.org.id)).orderBy(asc(t.id));
  const [balances, conversions, audits, employees] = await Promise.all([
    scoped(schema.leaveBalances), scoped(schema.leaveConversions),
    scoped(schema.auditEvents), scoped(schema.employees),
  ]);
  return plain({ balances, conversions, audits, employees });
}
async function seed() {
  check((await db.select().from(schema.organizations).limit(1)).length === 0,
    "Fresh PG16 only");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const employers = [];
  for (const name of ["ATTA", "ATTB", "VICTIM"])
    employers.push(await seedEmployer(name, nonce, standaloneMakeSession));
  const caps = {};
  for (const e of employers) {
    await db.insert(schema.leavePolicies).values({
      organizationId: e.org.id, leaveType, annualDays: "15.0",
      payTreatment: "paid", active: true,
    });
    await db.insert(schema.leaveBalances).values({
      organizationId: e.org.id, employeeId: e.worker.id,
      leaveType, year, opening: "12.0", accrued: "0", used: "0", pending: "0",
    });
    caps[e.org.id] = { "vacation leave": 5 };
  }
  const values = {
    LEAVE_CONVERSION_MAX_DAYS_JSON: JSON.stringify(caps),
    LEAVE_CONVERSION_TAX_REVIEWED_ORG_IDS: employers.map(e => e.org.id).join(","),
  };
  assert.ok(process.env.GITHUB_ENV && process.env.GITHUB_ENV.startsWith("/"),
    "Only CI may export temporary source-approved fictional policy");
  appendFileSync(process.env.GITHUB_ENV,
    Object.entries(values).map(([k, v]) => k + "=" + v).join("\n") + "\n");
  writeFileSync(fixturePath, JSON.stringify({ employers, year }));
  check(employers[2].org.id > employers[1].org.id, "Genuine higher-ID victim");
  console.log(JSON.stringify({
    kind: "leave-conversion-fixture-only", organizations: employers.length,
    oneTenantCapOnly: true, taxPolicy: "synthetic-CI-only", methodCredits: 0,
  }));
}
async function verify() {
  const config = JSON.parse(readFileSync(fixturePath, "utf8"));
  const [a, b, victim] = config.employers;
  check(config.year === year, "Manila fiscal year not stale");
  check(victim.org.id > b.org.id && victim.worker.id > b.worker.id,
    "Higher-ID victim is real persisted fixture");
  const caps = JSON.parse(process.env.LEAVE_CONVERSION_MAX_DAYS_JSON ?? "{}");
  for (const e of [a, b, victim])
    check(caps[e.org.id]?.["vacation leave"] === 5,
      "Every fictional employer gets an explicit limited cap");
  const ownBody = e => ({
    organizationId: e.org.id, employeeId: e.worker.id,
    leaveType, year, daysConverted: 1,
  });
  const request = (actor, body) => standaloneRequest("/api/leave/conversion", {
    method: "POST", cookie: actor.cookie, body,
  });
  let owned = 0, denied = 0;
  for (const e of [a, b, victim]) {
    const result = expect(await request(e, ownBody(e)), 201,
      "Genuine owned leave conversion must persist");
    check(result.json?.organizationId === e.org.id &&
      result.json?.employeeId === e.worker.id &&
      result.json?.status === "approved" &&
      Number(result.json?.daysConverted) === 1,
      "Owned 201 requires the correct real committed conversion");
    const state = await snapshot(e);
    check(state.conversions.length === 1 &&
      state.conversions[0].employeeId === e.worker.id &&
      state.audits.some(x => x.action === "Leave credits approved for cash conversion"),
      "Conversion and audit must both exist in same employer");
    owned++;
  }
  const before = new Map();
  for (const e of [a, b, victim]) before.set(e.org.id, await snapshot(e));
  for (const attacker of [a, b]) {
    const org = expect(await request(attacker, ownBody(victim)), 403,
      "Foreign employer cash conversion denied");
    const forged = expect(await request(attacker, {
      ...ownBody(attacker), employeeId: victim.worker.id,
    }), 404, "Actual victim worker under own org must be denied");
    const cap = expect(await request(attacker, {
      ...ownBody(attacker), daysConverted: 5,
    }), 422, "Prior reservation plus new request above approved annual cap denied");
    for (const response of [org, forged, cap])
      check(!response.text.includes(victim.marker), "No victim marker in denied response");
    denied += 3;
  }
  for (const e of [a, b, victim]) {
    assert.deepEqual(await snapshot(e), before.get(e.org.id),
      "Rejected foreign/over-cap conversions must preserve all real balances, approvals and audits");
    assertions++;
  }
  check(owned === 3 && denied === 6, "Three own conversions and six negative requests");
  console.log(JSON.stringify({
    kind: "leave-conversion-POST-tenant-PG16", owned, denied,
    twoIndependentAttackers: true, realHigherIdVictim: true,
    victimBalancesAndAuditUnchangedAfterDenials: true, realMoneyCalls: 0,
    methodCredits: 0, independentSecurityReview: "PENDING", assertions,
  }));
}
try { if (mode === "seed") await seed(); else await verify(); }
finally { await pool.end(); }
