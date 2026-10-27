/**
 * WRK-01 / PII: real two-method ESS availability isolation proof.
 * Fictional PG16 / localhost only. No production reads, releases or providers.
 *
 * GET has no client-selectable victim ID. Its negative control is a real
 * membership revocation on the original authenticated employee session.
 * POST additionally rejects forged employer/worker keys and a persisted,
 * higher-ID victim-only rule reference. Do not count coverage from flag-off 404.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, employeeAvailabilityRules, employees, payrollRuns,
  userOrganizations, users,
} from "../../src/db/schema";
import { manilaWorkDate } from "../../src/lib/workforce-employee-upcoming-week";
import { addAvailabilityDays } from "../../src/lib/workforce-employee-availability-preferences";

export const AVAILABILITY_METHODS = Object.freeze([
  "GET /api/self/availability", "POST /api/self/availability",
]);

function requireDisposable() {
  const app = new URL(process.env.SECURITY_SMOKE_URL ?? "");
  const pg = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.TENANT_SELF_AVAILABILITY_PROOF, "isolated-ci-only");
  assert.equal(process.env.WFM_EMPLOYEE_AVAILABILITY_ENABLED, "true",
    "An OFF/404 feature response is not positive method coverage");
  assert.equal(app.href, "http://127.0.0.1:3000/");
  assert.equal(pg.href, "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  for (const flag of ["CENTRAL_SCHEDULER_ENABLED", "WORKER_ENABLED",
    "PAYROLL_SCHEDULER_DISPATCH_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED",
    "XENDIT_PAYOUTS_ENABLED"]) {
    assert.notEqual(process.env[flag], "true", flag + " must remain disabled");
  }
  for (const secret of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL"]) {
    assert.ok(!process.env[secret], secret + " is forbidden for fictional proof");
  }
}

const scoped = (table, orgId) => db.select().from(table)
  .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));

async function snapshot(orgId) {
  return {
    rules: await scoped(employeeAvailabilityRules, orgId),
    audit: await scoped(auditEvents, orgId),
    workers: await scoped(employees, orgId),
    payroll: await scoped(payrollRuns, orgId),
  };
}
function noVictim(response, sentinel) {
  assert.ok(!response.text.includes(sentinel), "victim availability marker leaked in HTTP body");
  assert.ok(![...response.headers].some(([k, v]) => (k + ":" + v).includes(sentinel)),
    "victim availability marker leaked in HTTP header");
}

async function createEmployeeActor(org, worker, label, makeSession) {
  const [user] = await db.insert(users).values({
    email: "self-availability-" + label + "-" + randomUUID() + "@example.invalid",
    name: "Fictional availability " + label, role: "employee",
    employeeId: worker.id, passwordHash: "fictional-no-password-login",
  }).returning({ id: users.id, name: users.name });
  await db.insert(userOrganizations).values({
    userId: user.id, organizationId: org.id, role: "employee", active: true,
  });
  return { org, worker, user, cookie: (await makeSession(user.id)).cookie };
}

export async function verifySelfAvailabilityIsolation(f, { request, expectStatus, makeSession }) {
  requireDisposable();
  assert.equal(f.ownedEmployees.length, 2, "two independently seeded attacker employees");
  assert.ok(f.victimEmployees.length >= 8 && f.victimEmployee.id > 6,
    "a real, higher-ID victim-only worker is required");
  const today = manilaWorkDate();
  const startDate = addAvailabilityDays(today, 1);
  const victimMarker = "WRK01-AVAIL-VICTIM-ONLY-" + randomUUID();
  const attackerMarkers = [
    "WRK01-AVAIL-OWN-A-" + randomUUID(),
    "WRK01-AVAIL-OWN-B-" + randomUUID(),
  ];
  const attackers = [];
  for (const i of [1, 2]) attackers.push(await createEmployeeActor(
    f.orgs[i], f.ownedEmployees[i - 1], "attacker-" + i, makeSession));
  const victim = await createEmployeeActor(
    f.orgs[0], f.victimEmployees[7], "victim", makeSession);

  // Own rows must be real before the victim-only rows receive later IDs.
  const ownRows = [];
  for (const [idx, a] of attackers.entries()) {
    const [row] = await db.insert(employeeAvailabilityRules).values({
      organizationId: a.org.id, employeeId: a.worker.id,
      weekday: idx + 1, startTime: "09:00", endTime: "11:00",
      availabilityType: "preferred", effectiveFrom: startDate,
      notes: attackerMarkers[idx], createdBy: a.user.name, createdByUserId: a.user.id,
    }).returning();
    ownRows.push(row);
  }
  const victimRows = await db.insert(employeeAvailabilityRules).values(
    f.victimEmployees.slice(0, 8).map((worker, idx) => ({
      organizationId: victim.org.id, employeeId: worker.id,
      weekday: idx % 7, startTime: "09:00", endTime: "11:00",
      availabilityType: "unavailable", effectiveFrom: startDate,
      notes: victimMarker + "-" + idx, createdBy: victim.user.name,
      createdByUserId: victim.user.id,
    })),
  ).returning();
  assert.equal(victimRows.length, 8);
  assert.ok(victimRows.every(row => row.organizationId === victim.org.id));
  const victimTarget = victimRows[7];
  assert.ok(Number.isSafeInteger(victimTarget.id) && victimTarget.id > 6 &&
    ownRows.every(row => victimTarget.id > row.id),
  "real persisted victim-only rule must have a higher ID than both owned rows");

  const victimOwn = expectStatus(await request("/api/self/availability", {
    cookie: victim.cookie,
  }), 200, "real victim employee must access a nonempty own rule");
  assert.ok(victimOwn.json?.rules?.some(r =>
    r.id === victimTarget.id && r.notes === victimMarker + "-7"),
  "victim target must actually be visible to its own authenticated employee");
  const victimBefore = await snapshot(victim.org.id);

  // Both attacker sessions must have nonempty own positives on both methods.
  for (const [idx, a] of attackers.entries()) {
    const ownRule = ownRows[idx], marker = attackerMarkers[idx];
    const own = expectStatus(await request("/api/self/availability", {
      cookie: a.cookie,
    }), 200, "attacker ESS GET must return populated employee-specific rules");
    assert.equal(own.json?.source, "employee_availability_rules");
    assert.ok(own.json?.rules?.some(row =>
      row.id === ownRule.id && row.notes === marker));
    assert.ok(!own.json?.rules?.some(row => row.id === victimTarget.id));
    assert.match(own.headers.get("cache-control") ?? "", /private.*no-store/);
    noVictim(own, victimMarker);

    const forgedQuery = expectStatus(await request(
      "/api/self/availability?organizationId=" + victim.org.id +
      "&employeeId=" + victim.worker.id, { cookie: a.cookie },
    ), 400, "GET must reject actual victim employer and employee selectors");
    noVictim(forgedQuery, victimMarker);

    const create = {
      action: "create", weekday: idx + 3, startTime: "13:00",
      endTime: "14:00", availabilityType: "preferred",
      effectiveFrom: startDate, effectiveUntil: null, notes: marker + "-HTTP",
    };
    const saved = expectStatus(await request("/api/self/availability", {
      method: "POST", cookie: a.cookie, body: create,
    }), 201, "real own ESS POST must persist a preference");
    assert.equal(saved.json?.saved, true);
    assert.equal(saved.json?.publishedRosterChanged, false);
    assert.equal(saved.json?.payrollMutationPerformed, false);
    assert.ok(Number.isSafeInteger(saved.json?.id) && saved.json.id > 0);
    const [stored] = await db.select().from(employeeAvailabilityRules)
      .where(eq(employeeAvailabilityRules.id, saved.json.id)).limit(1);
    assert.equal(stored?.organizationId, a.org.id);
    assert.equal(stored?.employeeId, a.worker.id);
    assert.equal(stored?.notes, marker + "-HTTP");
    assert.equal(stored?.createdByUserId, a.user.id);

    const populated = expectStatus(await request("/api/self/availability", {
      cookie: a.cookie,
    }), 200, "GET reads back both seeded and HTTP-created own rules");
    assert.ok(populated.json?.rules?.some(row => row.id === ownRule.id));
    assert.ok(populated.json?.rules?.some(row =>
      row.id === stored.id && row.notes === marker + "-HTTP"));
    noVictim(populated, victimMarker);

    const beforeReject = await scoped(employeeAvailabilityRules, a.org.id);
    const forgedCreate = expectStatus(await request("/api/self/availability", {
      method: "POST", cookie: a.cookie,
      body: { ...create, organizationId: victim.org.id, employeeId: victim.worker.id },
    }), 400, "POST must reject client-forged victim employer/worker keys");
    noVictim(forgedCreate, victimMarker);
    const forgedRemove = expectStatus(await request("/api/self/availability", {
      method: "POST", cookie: a.cookie, body: { action: "remove", ruleId: victimTarget.id },
    }), 409, "POST cannot remove a real other-employer higher-ID rule");
    noVictim(forgedRemove, victimMarker);
    assert.deepEqual(await scoped(employeeAvailabilityRules, a.org.id), beforeReject,
      "rejected forged writes cannot mutate own rules");

    const remove = expectStatus(await request("/api/self/availability", {
      method: "POST", cookie: a.cookie, body: { action: "remove", ruleId: stored.id },
    }), 200, "legitimate own POST removal must actually persist");
    assert.equal(remove.json?.removed, true);
    assert.equal(remove.json?.disposition, "delete_future_rule");
    assert.equal(remove.json?.publishedRosterChanged, false);
    assert.equal(remove.json?.payrollMutationPerformed, false);
    const afterRemove = await scoped(employeeAvailabilityRules, a.org.id);
    assert.ok(afterRemove.some(row => row.id === ownRule.id));
    assert.ok(!afterRemove.some(row => row.id === stored.id));
    const actionAudit = await scoped(auditEvents, a.org.id);
    assert.ok(actionAudit.some(row =>
      row.action === "Employee WFM availability preference created" &&
      row.metadata?.ruleId === stored.id && row.metadata?.payrollMutationPerformed === false));
    assert.ok(actionAudit.some(row =>
      row.action === "Employee WFM availability preference withdrawn" &&
      row.metadata?.ruleId === stored.id && row.metadata?.payrollMutationPerformed === false));
    assert.deepEqual(await snapshot(victim.org.id), victimBefore,
      "both own creates/removals and foreign denials must leave victim tables and audit unchanged");
  }

  // On a session that remains authenticated through another active employer,
  // revoking its original employee's employer grant must produce GET and POST 403.
  const a = attackers[0];
  await db.insert(userOrganizations).values({
    userId: a.user.id, organizationId: attackers[1].org.id,
    role: "employee", active: true,
  });
  const revoked = await db.update(userOrganizations).set({ active: false })
    .where(and(eq(userOrganizations.userId, a.user.id),
      eq(userOrganizations.organizationId, a.org.id)))
    .returning({ id: userOrganizations.id });
  assert.equal(revoked.length, 1);
  expectStatus(await request("/api/auth/me", { cookie: a.cookie }), 200,
    "other active membership keeps the exact original session authenticated");
  const deniedGet = expectStatus(await request("/api/self/availability", {
    cookie: a.cookie,
  }), 403, "revoked original employer membership denies previously owned GET");
  noVictim(deniedGet, victimMarker);
  const deniedPost = expectStatus(await request("/api/self/availability", {
    method: "POST", cookie: a.cookie,
    body: { action: "remove", ruleId: ownRows[0].id },
  }), 403, "revoked original employer membership denies previously owned POST");
  noVictim(deniedPost, victimMarker);
  assert.deepEqual(await snapshot(victim.org.id), victimBefore,
    "revocation controls cannot mutate victim availability, audit, employees or payroll");

  console.log(JSON.stringify({
    kind: "WRK01_SELF_AVAILABILITY_REAL_HTTP_PG16_PASS",
    methods: AVAILABILITY_METHODS,
    independentAttackers: 2, realVictimRuleIdAboveSixAndBothAttackers: true,
    populatedOwnGet: true, persistedOwnCreateAndRemove: true,
    forgedVictimSelectorsRejected: true, revokedMembershipDeniedBothMethods: true,
    victimRowsAndAuditUnchanged: true, rosterPublished: false,
    payrollMutated: false, productionTested: false, creditPromoted: false,
  }));
}
