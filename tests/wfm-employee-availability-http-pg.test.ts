import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employeeAvailabilityRules, employees, organizations,
  userOrganizations, users,
} from "../src/db/schema";
import { manilaWorkDate } from "../src/lib/workforce-employee-upcoming-week";

const require = createRequire(import.meta.url);

/**
 * Disposable PostgreSQL end-to-end route acceptance. The cookie authenticator
 * and distributed rate provider are synthetic test shims; REAL membership,
 * tenant/employee SQL, transaction, audit and JSON handlers execute.
 * Production sessions, Neon, payroll or schedule records are never touched.
 */
test("ESS availability GET/create/withdraw stay employee- and tenant-bound in actual PostgreSQL", {
  skip: process.env.CI !== "true" || !process.env.DATABASE_URL,
  timeout: 60_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/app_db");
  const suffix = randomUUID().slice(0, 10);
  const orgs = await db.insert(organizations).values([
    { name: "WFM availability Alpha " + suffix, legalName: "Fictional WFM Alpha" },
    { name: "WFM availability Beta " + suffix, legalName: "Fictional WFM Beta" },
  ]).returning();
  const [alpha, beta] = orgs;
  const userIds: number[] = [];
  const restores: Array<() => void> = [];
  let session: {
    id: number; name: string; email: string; role: string; employeeId: number;
  } | null = null;
  const patch = (path: string, overrides: Record<string, unknown>) => {
    const key = require.resolve(path);
    const prior = require(key);
    require.cache[key]!.exports = { ...prior, ...overrides };
    restores.push(() => { require.cache[key]!.exports = prior; });
  };
  const oldFlag = process.env.WFM_EMPLOYEE_AVAILABILITY_ENABLED;
  try {
    const [personA, personB] = await db.insert(employees).values([
      { organizationId: alpha.id, employeeNo: "WFM-A-" + suffix,
        firstName: "Fictional", lastName: "Alpha", title: "Shift worker",
        avatarInitials: "FA", basicRate: "20000.00", startDate: "2026-01-01" },
      { organizationId: beta.id, employeeNo: "WFM-B-" + suffix,
        firstName: "Fictional", lastName: "Beta", title: "Shift worker",
        avatarInitials: "FB", basicRate: "21000.00", startDate: "2026-01-01" },
    ]).returning();
    const [userA, userB] = await db.insert(users).values([
      { email: "wfm-availability-a-" + suffix + "@example.invalid", name: "Fictional Worker A",
        passwordHash: "no-login-test-only", role: "employee", employeeId: personA.id },
      { email: "wfm-availability-b-" + suffix + "@example.invalid", name: "Fictional Worker B",
        passwordHash: "no-login-test-only", role: "employee", employeeId: personB.id },
    ]).returning();
    userIds.push(userA.id, userB.id);
    await db.insert(userOrganizations).values([
      { userId: userA.id, organizationId: alpha.id, role: "employee", active: true },
      { userId: userB.id, organizationId: beta.id, role: "employee", active: true },
    ]);
    process.env.WFM_EMPLOYEE_AVAILABILITY_ENABLED = "true";
    patch("../src/lib/auth", { getSessionUser: async () => session });
    // Authentication/CSRF/rate protection is independently regression-tested.
    // Here synthetic users exercise the real row/membership and DB handlers.
    patch("../src/lib/security-request", { enforceSensitiveActionRateLimit: async () => null });
    const { GET, POST } = await import("../src/app/api/self/availability/route");

    const read = () => new Request("https://example.test/api/self/availability");
    const send = (body: object) => new Request("https://example.test/api/self/availability", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Origin: "https://example.test",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(body),
    });
    const today = manilaWorkDate();
    const candidate = {
      action: "create", weekday: 1, startTime: "08:00", endTime: "16:00",
      availabilityType: "preferred", effectiveFrom: today, effectiveUntil: null,
      notes: "Fictional availability only",
    };

    assert.equal((await GET(read())).status, 401);
    session = { id: userA.id, employeeId: personA.id, name: userA.name,
      email: userA.email, role: "employee" };
    assert.equal((await GET(new Request("https://example.test/api/self/availability?employeeId=" + personB.id))).status, 400);
    assert.equal((await POST(send({ ...candidate, employeeId: personB.id, organizationId: beta.id }))).status, 400);
    assert.equal((await POST(send({ ...candidate, weekday: 7 }))).status, 400);
    assert.equal((await POST(send(candidate))).status, 201);
    assert.equal((await POST(send(candidate))).status, 409, "duplicate idempotence is explicit");
    let view = await (await GET(read())).json();
    assert.equal(view.source, "employee_availability_rules");
    assert.equal(view.rules.length, 1);
    const firstId = view.rules[0].id;
    assert.equal(view.rules[0].availabilityType, "preferred");
    assert.ok(!JSON.stringify(view).includes("organizationId"));
    assert.ok(!JSON.stringify(view).includes("employeeId"));

    session = { id: userB.id, employeeId: personB.id, name: userB.name,
      email: userB.email, role: "employee" };
    view = await (await GET(read())).json();
    assert.equal(view.rules.length, 0, "B must not read A source records");
    assert.equal((await POST(send({ action: "remove", ruleId: firstId }))).status, 409);
    assert.equal((await POST(send({ ...candidate, weekday: 2, availabilityType: "unavailable" }))).status, 201);
    view = await (await GET(read())).json();
    assert.equal(view.rules.length, 1);
    assert.equal(view.rules[0].weekday, 2);
    assert.ok(!JSON.stringify(view).includes("Fictional availability only" + " from A"));

    session = { id: userA.id, employeeId: personA.id, name: userA.name,
      email: userA.email, role: "employee" };
    const removal = await POST(send({ action: "remove", ruleId: firstId }));
    assert.equal(removal.status, 200);
    assert.equal((await (await GET(read())).json()).rules.length, 0);
    const [record] = await db.select({ id: employeeAvailabilityRules.id })
      .from(employeeAvailabilityRules)
      .where(and(eq(employeeAvailabilityRules.organizationId, alpha.id),
        eq(employeeAvailabilityRules.employeeId, personA.id),
        eq(employeeAvailabilityRules.id, firstId)));
    assert.equal(record, undefined, "future/today rule withdrawn without touching other employer");

    const history = await db.insert(employeeAvailabilityRules).values({
      organizationId: alpha.id, employeeId: personA.id, weekday: 1,
      startTime: "07:00", endTime: "15:00", availabilityType: "unavailable",
      effectiveFrom: "2026-01-01", effectiveUntil: null,
      createdBy: "Fictional HR", createdByUserId: userA.id,
    }).returning({ id: employeeAvailabilityRules.id });
    const closed = await POST(send({ action: "remove", ruleId: history[0].id }));
    assert.equal(closed.status, 200);
    const closedData = await closed.json();
    assert.equal(closedData.disposition, "close_current_rule");
    const [pastRule] = await db.select().from(employeeAvailabilityRules)
      .where(eq(employeeAvailabilityRules.id, history[0].id));
    assert.ok(pastRule);
    assert.ok(String(pastRule.effectiveUntil) < today, "historical source row retained");
    const [audit] = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, alpha.id),
      eq(auditEvents.action, "Employee WFM availability preference withdrawn"),
    )).limit(1);
    assert.ok(audit, "actual tenant-bound audit event persisted");
    const [betaRule] = await db.select().from(employeeAvailabilityRules).where(and(
      eq(employeeAvailabilityRules.organizationId, beta.id),
      eq(employeeAvailabilityRules.employeeId, personB.id),
    )).limit(1);
    assert.ok(betaRule, "A withdrawal must never mutate B source");
  } finally {
    for (const restore of restores.reverse()) restore();
    if (oldFlag === undefined) delete process.env.WFM_EMPLOYEE_AVAILABILITY_ENABLED;
    else process.env.WFM_EMPLOYEE_AVAILABILITY_ENABLED = oldFlag;
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
