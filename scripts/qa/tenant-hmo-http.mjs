/** HMO GET and all four POST actions. Fictional localhost + disposable PG16 only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEvents, benefitDependents, benefitEnrollmentEvents, benefitEnrollments,
  benefitPlans, employees, orgUnits, payrollRuns, userOrganizations, users } from "../../src/db/schema";

export const HMO_ACTIONS = Object.freeze(["create_plan", "add_dependent", "update_dependent", "update_enrollment"]);
const PATH = "/api/benefits/hmo";
const START = "2026-10-01";

function requireIsolated() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).href, "http://127.0.0.1:3000/");
  const pg = new URL(process.env.DATABASE_URL);
  assert.equal(pg.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1"].includes(pg.hostname));
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  for (const flag of ["XENDIT_PAYOUTS_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED"]) assert.notEqual(process.env[flag], "true");
  for (const key of ["XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "PAYMONGO_SECRET_KEY"]) {
    assert.ok(!process.env[key], "Provider credentials forbidden in fictional HMO acceptance");
  }
}

async function snapshot(id) {
  return {
    plans: await db.select().from(benefitPlans).where(eq(benefitPlans.organizationId, id)).orderBy(benefitPlans.id),
    enrollments: await db.select().from(benefitEnrollments).where(eq(benefitEnrollments.organizationId, id)).orderBy(benefitEnrollments.id),
    dependents: await db.select().from(benefitDependents).where(eq(benefitDependents.organizationId, id)).orderBy(benefitDependents.id),
    events: await db.select().from(benefitEnrollmentEvents).where(eq(benefitEnrollmentEvents.organizationId, id)).orderBy(benefitEnrollmentEvents.id),
    employees: await db.select().from(employees).where(eq(employees.organizationId, id)).orderBy(employees.id),
    audit: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, id)).orderBy(auditEvents.id),
    payroll: await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, id)).orderBy(payrollRuns.id),
  };
}

export async function verifyHmoIsolation(f, { request, expectStatus, makeSession }) {
  requireIsolated();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const victim = f.orgs[0];
  const marker = "Private victim HMO " + nonce;
  async function seed(org, worker, label) {
    const [plan] = await db.insert(benefitPlans).values({ organizationId: org.id,
      name: label, category: "hmo", provider: "Fictional carrier only", employeeShare: "100.00",
      employerShare: "200.00", dependentShare: "50.00", employerPaidDependents: 0 }).returning();
    const [enrollment] = await db.insert(benefitEnrollments).values({ organizationId: org.id,
      employeeId: worker.id, planId: plan.id, monthlyContribution: "100.00", startedOn: START,
      status: "active", providerStatus: "not_sent" }).returning();
    const [dependent] = await db.insert(benefitDependents).values({ organizationId: org.id,
      employeeId: worker.id, enrollmentId: enrollment.id, name: label + " dependent",
      relationship: "child", birthDate: "2015-04-03", status: "active", monthlyContribution: "50.00" }).returning();
    const [event] = await db.insert(benefitEnrollmentEvents).values({ organizationId: org.id,
      employeeId: worker.id, enrollmentId: enrollment.id, eventType: "fixture_seed", actor: "Fictional CI",
      metadata: { fictional: true } }).returning();
    return { plan, enrollment, dependent, event };
  }
  const owned = [];
  for (const idx of [1, 2]) owned.push(await seed(f.orgs[idx], f.ownedEmployees[idx - 1], "Own HMO " + nonce + "-" + idx));
  const victimRows = [];
  for (let i = 0; i < 7; i++) victimRows.push(await seed(victim, f.victimEmployee, marker + "-" + i));
  const target = victimRows.at(-1);
  for (const field of ["plan", "enrollment", "dependent", "event"]) {
    assert.ok(target[field].id > 6 && owned.every(row => target[field].id > row[field].id),
      field + ": real victim rows must exceed both attacker rows and six");
  }
  const before = await snapshot(victim.id);
  assert.ok(before.dependents.some(row => row.id === target.dependent.id && row.organizationId === victim.id));
  const endpoint = id => PATH + "?organizationId=" + id;
  function noVictim(res) {
    assert.ok(!res.text.includes(marker), "Private victim plan/dependent leaked in body");
    assert.ok(![...res.headers].some(([k, v]) => (k + v).includes(marker)), "Private victim marker leaked in headers");
  }
  async function denied(path, options, status, label, ownId) {
    const ownBefore = ownId ? await snapshot(ownId) : null;
    const res = expectStatus(await request(path, options), status, label);
    noVictim(res);
    assert.deepEqual(await snapshot(victim.id), before, label + ": victim HMO/payroll/audit unchanged");
    if (ownBefore) assert.deepEqual(await snapshot(ownId), ownBefore, label + ": own data unchanged after denial");
    return res;
  }
  const actionBodies = (org, row, name) => [
    { organizationId: org.id, action: "create_plan", name, provider: "Fictional carrier only", employeeShare: 100, employerShare: 200, dependentShare: 50 },
    { organizationId: org.id, action: "add_dependent", enrollmentId: row.enrollment.id,
      name: name + " child", relationship: "child", birthDate: "2015-04-03" },
    { organizationId: org.id, action: "update_dependent", dependentId: row.dependent.id, status: "active" },
    { organizationId: org.id, action: "update_enrollment", enrollmentId: row.enrollment.id,
      status: "pending", providerStatus: "pending_provider" },
  ];
  async function actor(org, role, orgUnitId = null) {
    const [user] = await db.insert(users).values({ name: "Fictional HMO " + role,
      email: "hmo-" + randomUUID() + "@example.invalid", passwordHash: "fixture-no-password-login", role }).returning();
    await db.insert(userOrganizations).values({ userId: user.id, organizationId: org.id, role, orgUnitId, active: true });
    return { user, session: await makeSession(user.id) };
  }
  for (const idx of [1, 2]) {
    const org = f.orgs[idx];
    const worker = f.ownedEmployees[idx - 1];
    const row = owned[idx - 1];
    const cookie = f.ownerSessions[idx].cookie;
    const own = expectStatus(await request(endpoint(org.id), { cookie }), 200, "HMO GET nonempty own response");
    assert.ok(own.json.plans.some(p => p.id === row.plan.id && p.organizationId === org.id));
    const member = own.json.enrollments.find(e => e.id === row.enrollment.id);
    assert.equal(member?.employeeId, worker.id);
    assert.ok(member?.dependents.some(d => d.id === row.dependent.id && d.organizationId === org.id));
    assert.ok(own.json.recentEvents.some(e => e.id === row.event.id && e.organizationId === org.id));
    assert.equal(own.json.dashboard.activeMembers, 1);
    assert.equal(own.json.dashboard.activeDependents, 1);
    noVictim(own);
    await denied(endpoint(victim.id), { cookie }, 403, "HMO GET foreign employer denied", org.id);
    const forged = expectStatus(await request(endpoint(org.id) + "&employeeId=" + f.victimEmployee.id +
      "&enrollmentId=" + target.enrollment.id + "&dependentId=" + target.dependent.id,
    { cookie, headers: { "x-organization-id": String(victim.id) } }), 200, "HMO GET forged selectors stay owned");
    assert.ok(forged.json.enrollments.some(e => e.id === row.enrollment.id));
    assert.ok(forged.json.enrollments.every(e => e.organizationId === org.id));
    noVictim(forged);

    const bodies = actionBodies(org, row, "New HMO " + nonce + "-" + idx);
    const createdPlan = expectStatus(await request(PATH, { method: "POST", cookie, body: bodies[0] }),
      201, "HMO POST create_plan owned success");
    const [savedPlan] = await db.select().from(benefitPlans).where(eq(benefitPlans.id, createdPlan.json.id));
    assert.equal(savedPlan.organizationId, org.id);
    assert.equal(savedPlan.name, bodies[0].name);
    assert.equal(savedPlan.category, "hmo");
    assert.equal(savedPlan.employeeShare, "100.00");
    const createdDependent = expectStatus(await request(PATH + "?organizationId=" + victim.id, {
      method: "POST", cookie, headers: { "x-organization-id": String(victim.id) },
      body: { ...bodies[1], employeeId: f.victimEmployee.id, planId: target.plan.id },
    }), 201, "HMO POST add_dependent derives actual owned enrollment despite forged selectors");
    const [savedDependent] = await db.select().from(benefitDependents)
      .where(eq(benefitDependents.id, createdDependent.json.id));
    assert.equal(savedDependent.organizationId, org.id);
    assert.equal(savedDependent.employeeId, worker.id);
    assert.equal(savedDependent.enrollmentId, row.enrollment.id);
    assert.equal(savedDependent.monthlyContribution, "50.00");
    const updatedDependent = expectStatus(await request(PATH, { method: "POST", cookie,
      body: { ...bodies[2], dependentId: savedDependent.id, employeeId: f.victimEmployee.id,
        enrollmentId: target.enrollment.id } }), 200, "HMO POST update_dependent owned success");
    assert.equal(updatedDependent.json.employeeId, worker.id);
    const [storedDependent] = await db.select().from(benefitDependents).where(eq(benefitDependents.id, savedDependent.id));
    assert.equal(storedDependent.status, "active");
    assert.equal(storedDependent.enrollmentId, row.enrollment.id);
    const updatedEnrollment = expectStatus(await request(PATH, { method: "POST", cookie,
      body: { ...bodies[3], employeeId: f.victimEmployee.id, planId: target.plan.id } }),
    200, "HMO POST update_enrollment owned success");
    assert.equal(updatedEnrollment.json.organizationId, org.id);
    const [storedEnrollment] = await db.select().from(benefitEnrollments).where(eq(benefitEnrollments.id, row.enrollment.id));
    assert.equal(storedEnrollment.employeeId, worker.id);
    assert.equal(storedEnrollment.planId, row.plan.id);
    assert.equal(storedEnrollment.status, "pending");
    assert.equal(storedEnrollment.providerStatus, "pending_provider");
    // Genuine lifecycle branches; these only change fictional local records.
    for (const status of ["active", "ended"]) {
      expectStatus(await request(PATH, { method: "POST", cookie,
        body: { ...bodies[3], status, providerStatus: "not_sent" } }), 200, "HMO owned coverage transition " + status);
      const [saved] = await db.select().from(benefitEnrollments).where(eq(benefitEnrollments.id, row.enrollment.id));
      assert.equal(saved.status, status);
    }
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, org.id));
    for (const action of ["HMO plan created", "HMO dependent added", "HMO dependent updated", "HMO enrollment updated"]) {
      assert.ok(audit.some(e => e.action === action), "Owned HMO action must persist audit evidence: " + action);
    }
    const events = await db.select().from(benefitEnrollmentEvents).where(eq(benefitEnrollmentEvents.organizationId, org.id));
    for (const type of ["dependent_added", "dependent_updated", "coverage_activated", "coverage_ended"]) {
      assert.ok(events.some(e => e.enrollmentId === row.enrollment.id && e.eventType === type));
    }
    assert.deepEqual(await snapshot(victim.id), before, "Every owned HMO action leaves victim data unchanged");
    for (const body of actionBodies(victim, target, "Forbidden HMO " + nonce)) {
      await denied(PATH, { method: "POST", cookie, body }, 403, "HMO foreign employer denied: " + body.action, org.id);
    }
    for (const body of actionBodies(org, target, "Forged HMO " + nonce).slice(1)) {
      await denied(PATH, { method: "POST", cookie, body }, 404, "HMO victim object under owned employer denied: " + body.action, org.id);
    }
    const [emptyUnit] = await db.insert(orgUnits).values({ organizationId: org.id, legalEntityId: f.entities[idx].id,
      code: "HMO-" + nonce + "-" + idx, name: "Fictional empty HR unit", type: "department" }).returning();
    const scoped = await actor(org, "hr", emptyUnit.id);
    const scopedRead = expectStatus(await request(endpoint(org.id), { cookie: scoped.session.cookie }),
      200, "HMO scoped empty unit is a verified empty response");
    assert.deepEqual(scopedRead.json.employees, []);
    assert.deepEqual(scopedRead.json.enrollments, []);
    assert.deepEqual(scopedRead.json.recentEvents, []);
    for (const body of bodies) await denied(PATH, { method: "POST", cookie: scoped.session.cookie, body },
      403, "HMO unit/role scope denied: " + body.action, org.id);
    const ordinary = await actor(org, "employee");
    await denied(endpoint(org.id), { cookie: ordinary.session.cookie }, 403, "HMO employee GET denied", org.id);
    for (const body of bodies) await denied(PATH, { method: "POST", cookie: ordinary.session.cookie, body },
      403, "HMO employee POST denied: " + body.action, org.id);
    const former = await actor(org, "owner");
    expectStatus(await request(endpoint(org.id), { cookie: former.session.cookie }), 200, "HMO former owner had genuine access");
    await db.insert(userOrganizations).values({ userId: former.user.id, organizationId: f.orgs[3 - idx].id, role: "owner", active: true });
    await db.update(userOrganizations).set({ active: false }).where(and(
      eq(userOrganizations.userId, former.user.id), eq(userOrganizations.organizationId, org.id)));
    expectStatus(await request("/api/account", { cookie: former.session.cookie }), 200, "HMO revoked session remains authenticated");
    await denied(endpoint(org.id), { cookie: former.session.cookie }, 403, "HMO revoked GET denied", org.id);
    for (const body of bodies) await denied(PATH, { method: "POST", cookie: former.session.cookie, body },
      403, "HMO revoked POST denied: " + body.action, org.id);
  }
  await denied(endpoint(victim.id), {}, 401, "HMO anonymous GET denied");
  for (const body of actionBodies(victim, target, "Anonymous fictional HMO")) {
    await denied(PATH, { method: "POST", body }, 401, "HMO anonymous POST denied: " + body.action);
  }
  assert.deepEqual(await snapshot(victim.id), before, "Final victim HMO, employee, payroll and audit snapshot unchanged");
  console.log(JSON.stringify({ kind: "HMO_GET_POST_HTTP_CANDIDATE", independentAttackers: 2,
    methods: ["GET", "POST"], actions: HMO_ACTIONS, actualProviderTraffic: false, inventoryCreditsAdded: 0 }));
}
