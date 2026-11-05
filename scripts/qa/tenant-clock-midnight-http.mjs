/**
 * Deterministic Manila-midnight clock proof, separate from the already pinned
 * five-method tenant-clock receipt. Disposable PG16 + real localhost Next only.
 * No new coverage credits, provider use, payroll mutations or production claim.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, asc, eq } from "drizzle-orm";
import { guard, ACTIONS } from "./tenant-clock-contract.mjs";

guard(); // Must execute before ANY app or database import.
const [{ db, pool }, s, f] = await Promise.all([
  import("../../src/db/index.ts"),
  import("../../src/db/schema.ts"),
  import("./tenant-table-http.mjs"),
]);
const base = process.env.SECURITY_SMOKE_URL;
const groups = JSON.parse(readFileSync("outputs/clock-fixture.json", "utf8"));
const [first, second, victim] = groups.enhanced;
assert.ok(first.org.id !== second.org.id && victim.org.id > second.org.id,
  "Must use two independently seeded employers and a real higher-ID victim");

function manilaDay(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}
const today = manilaDay(Date.now());
const boundary = Date.parse(today + "T00:00:00+08:00");
assert.ok(Number.isFinite(boundary), "Canonical Manila midnight required");
const instants = [-2, -1, 0, 1].map(minutes =>
  new Date(boundary + minutes * 60_000).toISOString());
const clockDay = manilaDay(instants[0]);
assert.notEqual(clockDay, today, "This proof MUST cross Manila midnight");
assert.equal(manilaDay(instants[1]), clockDay);
assert.equal(manilaDay(instants[2]), today);
assert.equal(manilaDay(instants[3]), today);
assert.ok(Date.now() - Date.parse(instants[0]) < 31 * 86_400_000,
  "Previous-day punch must be within the real reviewed timestamp window");

async function snapshotVictim() {
  const result = {};
  for (const [key, table] of [
    ["workers", s.employees], ["punches", s.timePunches],
    ["submissions", s.workforcePunchSubmissions],
    ["audits", s.auditEvents], ["payroll", s.payrollRuns],
  ]) {
    result[key] = await db.select().from(table)
      .where(eq(table.organizationId, victim.org.id)).orderBy(asc(table.id));
  }
  return result;
}

async function post(path, cookie, data, multipart = false) {
  const headers = { cookie, origin: base, "sec-fetch-site": "same-origin" };
  let body;
  if (multipart) {
    body = new FormData();
    for (const [name, value] of Object.entries(data)) body.set(name, String(value));
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify(data);
  }
  const response = await fetch(new URL(path, base), {
    method: "POST", headers, body, redirect: "manual", cache: "no-store",
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text, headers: Object.fromEntries(response.headers) };
}

async function newWorkerSession(e) {
  const worker = await f.addWorker(e, "MIDNIGHT");
  const [user] = await db.insert(s.users).values({
    email: "fictional-midnight-" + randomUUID() + "@example.invalid",
    name: e.marker + " fictional midnight employee",
    role: "employee", employeeId: worker.id,
    passwordHash: "synthetic-session-only", totpEnabled: true,
  }).returning({ id: s.users.id });
  await db.insert(s.userOrganizations).values({
    organizationId: e.org.id, userId: user.id, role: "employee", active: true,
  });
  const session = await f.standaloneMakeSession(user.id);
  await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
    .where(eq(s.sessions.id, session.id));
  return { worker, cookie: session.cookie };
}

try {
  const beforeVictim = await snapshotVictim();
  let approvals = 0;
  for (const employer of [first, second]) {
    const { worker, cookie } = await newWorkerSession(employer);
    const ownPayrollBefore = await db.select().from(s.payrollRuns)
      .where(eq(s.payrollRuns.organizationId, employer.org.id));
    const staged = [];
    for (let i = 0; i < ACTIONS.length; i++) {
      const request = {
        organizationId: employer.org.id, employeeId: worker.id,
        actionType: ACTIONS[i], clientPunchId: randomUUID(),
        deviceId: randomUUID(), deviceOccurredAt: instants[i], source: "online",
      };
      const response = await post("/api/web-bundy/evidence", cookie, request, true);
      assert.equal(response.status, 202,
        "Real HTTP staging must accept midnight fixture: " + ACTIONS[i] +
        " " + response.text.slice(0, 160));
      assert.ok(Number.isSafeInteger(response.json?.id), "Stored submission ID required");
      staged.push(response.json.id);
    }
    for (let i = 0; i < staged.length; i++) {
      const response = await post("/api/web-bundy/review", employer.cookie, {
        organizationId: employer.org.id, id: staged[i],
        decision: "approved", timeSource: "device",
        note: "Independent fictional midnight test review",
      });
      assert.equal(response.status, 200,
        "Real reviewer must approve staged midnight evidence: " + ACTIONS[i] +
        " " + response.text.slice(0, 160));
      assert.equal(response.json?.approvedWorkDate, clockDay,
        "Even after midnight the approved work date must stay on clock-in day");
      const punches = await db.select().from(s.timePunches).where(and(
        eq(s.timePunches.organizationId, employer.org.id),
        eq(s.timePunches.employeeId, worker.id),
      )).orderBy(asc(s.timePunches.id));
      assert.equal(punches.length, 1, "Midnight may not create a second attendance row");
      const one = punches[0];
      assert.equal(one.workDate, clockDay);
      assert.equal(one.source, "web_bundy");
      assert.equal(one.status, ACTIONS[i] === "clock_out" ? "Complete" : "Incomplete");
      const field = { clock_in: "timeIn", break_start: "breakStart",
        break_end: "breakEnd", clock_out: "timeOut" }[ACTIONS[i]];
      assert.equal(new Date(one[field]).toISOString(), instants[i],
        "Device timestamp must survive midnight review unmodified");
      approvals++;
    }
    const ownPayrollAfter = await db.select().from(s.payrollRuns)
      .where(eq(s.payrollRuns.organizationId, employer.org.id));
    assert.deepEqual(ownPayrollAfter, ownPayrollBefore,
      "Midnight review must not touch payroll");
    assert.deepEqual(await snapshotVictim(), beforeVictim,
      "Every action must leave the genuine higher-ID victim intact");
  }
  assert.equal(approvals, 8, "Two real owners must approve all four distinct actions");
  console.log("CLOCK_MIDNIGHT_REAL_HTTP " + JSON.stringify({
    proof: "disposable-pg16-real-http", manilaCrossMidnight: true,
    clockDay, reviewDay: today, actionTypes: ACTIONS,
    employers: 2, approved: approvals, oneRowPerEmployee: true,
    exactOriginalTimestamps: true, higherIdVictimUnchanged: true,
    newMethodCredits: 0, productionTested: false,
    independentHumanAcceptance: false,
  }));
} finally {
  await pool.end();
}
