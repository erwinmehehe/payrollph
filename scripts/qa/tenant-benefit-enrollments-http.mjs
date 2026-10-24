/** Three benefits methods: fictional, disposable PG16 + real localhost HTTP only.
 * Evidence candidate, NOT inventory credit or whole-system acceptance.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEvents, benefitEnrollments, benefitPlans, employees, payrollRuns,
  userOrganizations, users } from "../../src/db/schema";

const PATH = "/api/benefits";
const START = "2026-10-01";
const CREATE_START = "2026-10-16";

function requireIsolated() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).href, "http://127.0.0.1:3000/");
  const pg = new URL(process.env.DATABASE_URL);
  assert.equal(pg.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1"].includes(pg.hostname));
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  for (const flag of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED"]) {
    assert.notEqual(process.env[flag], "true");
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY"]) {
    assert.ok(!process.env[key], "Provider credentials forbidden in fictional tenant QA");
  }
}

async function snapshot(organizationId) {
  return {
    plans: await db.select().from(benefitPlans).where(eq(benefitPlans.organizationId, organizationId)).orderBy(benefitPlans.id),
    enrolments: await db.select().from(benefitEnrollments).where(eq(benefitEnrollments.organizationId, organizationId)).orderBy(benefitEnrollments.id),
    employees: await db.select().from(employees).where(eq(employees.organizationId, organizationId)).orderBy(employees.id),
    audit: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, organizationId)).orderBy(auditEvents.id),
    payroll: await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, organizationId)).orderBy(payrollRuns.id),
  };
}

function noVictim(response, marker) {
  assert.ok(!response.text.includes(marker), "Victim plan marker leaked in body");
  assert.ok(![...response.headers].some(([key, value]) => (key + value).includes(marker)),
    "Victim plan marker leaked in headers");
}

export async function verifyBenefitEnrollmentIsolation(f, { request, expectStatus, makeSession }) {
  requireIsolated();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const victim = f.orgs[0];
  const marker = "Victim benefit private " + nonce;
  // Persist both attacker plans first; victim IDs must exceed both, not be guesses.
  const ownPlans = await db.insert(benefitPlans).values([1, 2].map(idx => ({
    organizationId: f.orgs[idx].id, name: "Owned benefit " + nonce + "-" + idx,
    category: "voluntary", employeeShare: "100.00", employerShare: "0.00",
  }))).returning();
  const ownRows = [];
  for (const idx of [1, 2]) {
    const [row] = await db.insert(benefitEnrollments).values({
      organizationId: f.orgs[idx].id, employeeId: f.ownedEmployees[idx - 1].id,
      planId: ownPlans[idx - 1].id, monthlyContribution: "100.00", startedOn: START,
    }).returning();
    ownRows.push(row);
  }
  const victimPlans = await db.insert(benefitPlans).values(Array.from({ length: 7 }, (_, idx) => ({
    organizationId: victim.id, name: marker + "-" + idx,
    category: "voluntary", employeeShare: "200.00", employerShare: "0.00",
  }))).returning();
  const victimRows = await db.insert(benefitEnrollments).values(victimPlans.map(plan => ({
    organizationId: victim.id, employeeId: f.victimEmployee.id,
    planId: plan.id, monthlyContribution: "200.00", startedOn: START,
  }))).returning();
  const victimPlan = victimPlans.at(-1);
  const victimRow = victimRows.at(-1);
  assert.ok(victimPlan.id > 6 && ownPlans.every(plan => victimPlan.id > plan.id));
  assert.ok(victimRow.id > 6 && ownRows.every(row => victimRow.id > row.id));
  const before = await snapshot(victim.id);
  const endpoint = id => PATH + "?organizationId=" + id;
  const body = (org, employeeId, planId) => ({ organizationId: org.id,
    employeeId, planId, monthlyContribution: 100, startedOn: CREATE_START });
  async function denied(path, options, status, label) {
    const response = expectStatus(await request(path, options), status, label);
    noVictim(response, marker);
    assert.deepEqual(await snapshot(victim.id), before, label + ": victim DB must be unchanged");
    return response;
  }

  for (const idx of [1, 2]) {
    const org = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    const employee = f.ownedEmployees[idx - 1];
    const plan = ownPlans[idx - 1];
    const existing = ownRows[idx - 1];
    const own = expectStatus(await request(endpoint(org.id), { cookie }), 200, "GET owned populated benefits");
    assert.ok(own.json.plans.some(p => p.id === plan.id && p.organizationId === org.id));
    const worker = own.json.employees.find(e => e.id === employee.id);
    assert.ok(worker?.enrolments.some(e => e.id === existing.id && e.organizationId === org.id));
    noVictim(own, marker);
    assert.ok(!own.json.employees.some(e => e.id === f.victimEmployee.id));
    await denied(endpoint(victim.id), { cookie }, 403, "GET real victim employer denied");
    const forged = expectStatus(await request(endpoint(org.id) + "&employeeId=" + f.victimEmployee.id +
      "&planId=" + victimPlan.id, { cookie, headers: { "x-organization-id": String(victim.id) } }),
    200, "GET forged selectors cannot override authenticated employer");
    noVictim(forged, marker);
    assert.ok(forged.json.plans.some(p => p.id === plan.id));
    assert.ok(!forged.json.employees.some(e => e.id === f.victimEmployee.id));

    const createBody = body(org, employee.id, plan.id);
    assert.notEqual(createBody.startedOn, existing.startedOn,
      "POST positive must not reuse the seeded employee/plan/start-date unique key");
    const created = expectStatus(await request(PATH, { method: "POST", cookie,
      body: createBody }), 201, "POST owned benefit enrollment succeeds");
    assert.equal(created.json.organizationId, org.id);
    assert.equal(created.json.employeeId, employee.id);
    assert.equal(created.json.planId, plan.id);
    const [persisted] = await db.select().from(benefitEnrollments).where(eq(benefitEnrollments.id, created.json.id));
    assert.equal(persisted.organizationId, org.id);
    assert.equal(persisted.employeeId, employee.id);
    assert.equal(persisted.monthlyContribution, "100.00");
    assert.equal(persisted.startedOn, CREATE_START);
    assert.equal(persisted.status, "active");
    await denied(PATH, { method: "POST", cookie,
      body: body(victim, f.victimEmployee.id, victimPlan.id) }, 403, "POST victim employer denied");
    await denied(PATH, { method: "POST", cookie,
      body: body(org, f.victimEmployee.id, plan.id) }, 404, "POST foreign worker in owned employer denied");
    await denied(PATH, { method: "POST", cookie,
      body: body(org, employee.id, victimPlan.id) }, 404, "POST foreign private plan in owned employer denied");

    await denied(PATH + "?id=" + victimRow.id + "&organizationId=" + org.id,
      { method: "DELETE", cookie }, 403, "DELETE victim ID cannot be authorized by forged own selector");
    expectStatus(await request(PATH + "?id=" + created.json.id + "&organizationId=" + victim.id,
      { method: "DELETE", cookie }), 200, "DELETE owned row derives employer from persisted record");
    const [ended] = await db.select().from(benefitEnrollments).where(eq(benefitEnrollments.id, created.json.id));
    assert.equal(ended.organizationId, org.id);
    assert.equal(ended.status, "ended");
    assert.match(ended.endedOn, /^\d{4}-\d{2}-\d{2}$/);
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, org.id));
    assert.ok(audit.some(e => e.action === "Benefit enrolment ended" && e.metadata?.enrolmentId === ended.id));
    assert.deepEqual(await snapshot(victim.id), before, "Own mutations cannot change victim rows or audit");

    // Revoke a genuine membership while retaining another active employer grant.
    // This is a separate fictional user; the runner's owner fixtures stay intact.
    const [former] = await db.insert(users).values({
      name: "Fictional benefits former owner", email: "benefits-former-" + idx + "-" + nonce + "@example.invalid",
      passwordHash: "fixture-no-password-login", role: "owner",
    }).returning();
    await db.insert(userOrganizations).values([
      { userId: former.id, organizationId: org.id, role: "owner", active: true },
      { userId: former.id, organizationId: f.orgs[3 - idx].id, role: "owner", active: true },
    ]);
    const stale = await makeSession(former.id);
    expectStatus(await request(endpoint(org.id), { cookie: stale.cookie }), 200, "Former member really had owned access");
    await db.update(userOrganizations).set({ active: false }).where(and(
      eq(userOrganizations.userId, former.id), eq(userOrganizations.organizationId, org.id)));
    const ownedBeforeDenials = await snapshot(org.id);
    expectStatus(await request("/api/account", { cookie: stale.cookie }), 200, "Same session remains authenticated");
    await denied(endpoint(org.id), { cookie: stale.cookie }, 403, "GET revoked membership denied");
    await denied(PATH, { method: "POST", cookie: stale.cookie,
      body: body(org, employee.id, plan.id) }, 403, "POST revoked membership denied");
    await denied(PATH + "?id=" + existing.id, { method: "DELETE", cookie: stale.cookie },
      403, "DELETE revoked membership denied");
    const [untouched] = await db.select().from(benefitEnrollments).where(eq(benefitEnrollments.id, existing.id));
    assert.deepEqual(untouched, existing, "Revoked delete must leave formerly owned enrollment unchanged");
    const [ordinary] = await db.insert(users).values({
      name: "Fictional benefits employee", email: "benefits-worker-" + idx + "-" + nonce + "@example.invalid",
      passwordHash: "fixture-no-password-login", role: "employee", employeeId: employee.id,
    }).returning();
    await db.insert(userOrganizations).values({ userId: ordinary.id,
      organizationId: org.id, role: "employee", active: true });
    const employeeSession = await makeSession(ordinary.id);
    await denied(endpoint(org.id), { cookie: employeeSession.cookie }, 403, "GET ordinary employee role denied");
    await denied(PATH, { method: "POST", cookie: employeeSession.cookie,
      body: body(org, employee.id, plan.id) }, 403, "POST ordinary employee role denied");
    await denied(PATH + "?id=" + existing.id, { method: "DELETE", cookie: employeeSession.cookie },
      403, "DELETE ordinary employee role denied");
    assert.deepEqual(await snapshot(org.id), ownedBeforeDenials,
      "Revoked membership and employee-role denials cannot mutate owned benefits, payroll or audit");
  }
  for (const method of ["GET", "POST", "DELETE"]) {
    await denied(method === "DELETE" ? PATH + "?id=" + victimRow.id : endpoint(victim.id),
      { method, ...(method === "POST" ? { body: body(victim, f.victimEmployee.id, victimPlan.id) } : {}) },
      401, "Anonymous " + method + " denied");
  }
  assert.deepEqual(await snapshot(victim.id), before, "Final victim benefits, employees, payroll and audit unchanged");
  console.log(JSON.stringify({ kind: "BENEFIT_ENROLLMENT_HTTP_CANDIDATE", methods: ["GET", "POST", "DELETE"],
    independentAttackers: 2, victimPlanId: victimPlan.id, victimEnrollmentId: victimRow.id,
    inventoryCreditsAdded: 0, status: "PARTIAL_SYNTHETIC_EVIDENCE_ONLY" }));
}
