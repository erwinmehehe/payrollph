/** Partial worksite action proof. Fictional localhost/disposable PG16 only.
 * No manifest credits until exact-head HTTP acceptance and source review.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEvents, employees, employeeWorksiteAssignments, hcmWorkArrangements,
  hcmWorksiteAuthorizations, payrollRuns, userOrganizations, users, worksites } from "../../src/db/schema";

const PATH = "/api/workforce/worksites";
const PRIOR_START = "2027-01-01";
const NEXT_START = "2027-02-01";

function requireIsolated() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).href, "http://127.0.0.1:3000/");
  const pg = new URL(process.env.DATABASE_URL);
  assert.equal(pg.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1"].includes(pg.hostname));
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  assert.notEqual(process.env.REQUIRE_PRIVILEGED_MFA, "false");
  for (const flag of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED"]) {
    assert.notEqual(process.env[flag], "true");
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY"]) {
    assert.ok(!process.env[key], "Provider secrets forbidden in worksite QA");
  }
}

async function snapshot(id) {
  return {
    sites: await db.select().from(worksites).where(eq(worksites.organizationId, id)).orderBy(worksites.id),
    assignments: await db.select().from(employeeWorksiteAssignments).where(eq(employeeWorksiteAssignments.organizationId, id)).orderBy(employeeWorksiteAssignments.id),
    arrangements: await db.select().from(hcmWorkArrangements).where(eq(hcmWorkArrangements.organizationId, id)).orderBy(hcmWorkArrangements.id),
    authorizations: await db.select().from(hcmWorksiteAuthorizations).where(eq(hcmWorksiteAuthorizations.organizationId, id)).orderBy(hcmWorksiteAuthorizations.id),
    employees: await db.select().from(employees).where(eq(employees.organizationId, id)).orderBy(employees.id),
    payroll: await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, id)).orderBy(payrollRuns.id),
    audit: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, id)).orderBy(auditEvents.id),
  };
}

export async function verifyWorksiteIsolation(f, { request, expectStatus, makeSession }) {
  requireIsolated();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const victim = f.orgs[0];
  const marker = "Victim private worksite " + nonce;
  const ownSites = await db.insert(worksites).values([1, 2].map(idx => ({
    organizationId: f.orgs[idx].id, orgUnitId: f.ownedUnits[idx].id,
    code: "OWN-" + nonce + "-" + idx, name: "Owned worksite " + nonce + "-" + idx,
  }))).returning();
  const priorAssignments = await db.insert(employeeWorksiteAssignments).values([1, 2].map(idx => ({
    organizationId: f.orgs[idx].id, employeeId: f.ownedEmployees[idx - 1].id,
    worksiteId: ownSites[idx - 1].id, effectiveFrom: PRIOR_START,
  }))).returning();
  // Actual victim records persisted after BOTH attacker records, with high IDs.
  const victimSites = await db.insert(worksites).values(Array.from({ length: 7 }, (_, idx) => ({
    organizationId: victim.id, orgUnitId: f.victimUnit.id,
    code: "V-" + nonce + "-" + idx, name: marker + "-" + idx,
  }))).returning();
  const victimAssignments = await db.insert(employeeWorksiteAssignments).values(victimSites.map((site, idx) => ({
    organizationId: victim.id, employeeId: f.victimEmployee.id, worksiteId: site.id,
    effectiveFrom: "2026-0" + (idx + 1) + "-01", effectiveUntil: "2026-0" + (idx + 1) + "-15",
  }))).returning();
  const foreignSite = victimSites.at(-1);
  assert.ok(foreignSite.id > 6 && ownSites.every(site => foreignSite.id > site.id));
  assert.ok(victimAssignments.at(-1).id > 6 && priorAssignments.every(row => victimAssignments.at(-1).id > row.id));
  const before = await snapshot(victim.id);
  const endpoint = id => PATH + "?organizationId=" + id;
  function noVictim(response) {
    for (const secret of [marker, f.victimEmployee.employeeNo]) {
      assert.ok(!response.text.includes(secret), "Victim marker leaked in response body");
      assert.ok(![...response.headers].some(([k, v]) => (k + v).includes(secret)), "Victim marker leaked in headers");
    }
  }
  async function denied(path, options, status, label) {
    const res = expectStatus(await request(path, options), status, label);
    noVictim(res);
    assert.deepEqual(await snapshot(victim.id), before, label + ": victim rows unchanged");
    return res;
  }
  async function actor(idx, role = "owner", orgUnitId = null) {
    const [user] = await db.insert(users).values({ name: "Fictional worksite " + role,
      email: "worksite-" + randomUUID() + "@example.invalid", passwordHash: "unused-fictional-login",
      role, totpEnabled: true,
    }).returning();
    await db.insert(userOrganizations).values({ userId: user.id,
      organizationId: f.orgs[idx].id, role, orgUnitId, active: true });
    return { user, session: await makeSession(user.id, { privileged: true }) };
  }
  for (const idx of [1, 2]) {
    const org = f.orgs[idx];
    const worker = f.ownedEmployees[idx - 1];
    const site = ownSites[idx - 1];
    const owner = await actor(idx);
    const cookie = owner.session.cookie;
    const own = expectStatus(await request(endpoint(org.id), { cookie }), 200, "GET populated owned worksite");
    assert.ok(own.json.worksites.some(row => row.id === site.id && row.organizationId === org.id));
    assert.ok(own.json.assignments.some(row => row.id === priorAssignments[idx - 1].id && row.employeeId === worker.id));
    noVictim(own);
    await denied(endpoint(victim.id), { cookie }, 403, "GET foreign employer denied");
    const forged = expectStatus(await request(endpoint(org.id) + "&worksiteId=" + foreignSite.id +
      "&employeeId=" + f.victimEmployee.id, { cookie, headers: { "x-organization-id": String(victim.id) } }),
    200, "GET forged selectors cannot override employer");
    noVictim(forged);
    assert.ok(forged.json.worksites.every(row => row.organizationId === org.id));
    assert.ok(forged.json.assignments.every(row => row.organizationId === org.id));

    const createBody = { organizationId: org.id, action: "create_worksite",
      code: "NEW-" + nonce + "-" + idx, name: "Fictional created site " + idx,
      orgUnitId: f.ownedUnits[idx].id, siteType: "office", timezone: "Asia/Manila" };
    assert.notEqual(createBody.code, site.code, "Positive create must not duplicate seeded unique code");
    const created = expectStatus(await request(PATH, { method: "POST", cookie, body: createBody }),
      201, "POST create owned worksite");
    const newSite = created.json.worksite;
    const [persisted] = await db.select().from(worksites).where(eq(worksites.id, newSite.id));
    assert.equal(persisted.organizationId, org.id);
    assert.equal(persisted.code, createBody.code);
    assert.equal(persisted.orgUnitId, f.ownedUnits[idx].id);
    await denied(PATH, { method: "POST", cookie, body: { ...createBody, organizationId: victim.id } },
      403, "POST create foreign employer denied");
    await denied(PATH, { method: "POST", cookie, body: { ...createBody, orgUnitId: f.victimUnit.id } },
      422, "POST create foreign organization unit denied");

    const updateBody = { organizationId: org.id, action: "update_worksite", worksiteId: newSite.id,
      name: "Fictional renamed site " + nonce + "-" + idx };
    expectStatus(await request(PATH, { method: "POST", cookie, body: updateBody }), 200, "POST update owned site");
    const [updated] = await db.select().from(worksites).where(eq(worksites.id, newSite.id));
    assert.equal(updated.name, updateBody.name);
    assert.equal(updated.organizationId, org.id);
    await denied(PATH, { method: "POST", cookie, body: { ...updateBody, worksiteId: foreignSite.id } },
      404, "POST update foreign site within own employer denied");
    await denied(PATH, { method: "POST", cookie, body: { ...updateBody,
      organizationId: victim.id, worksiteId: foreignSite.id } }, 403, "POST update foreign employer denied");

    const assignBody = { organizationId: org.id, action: "assign_employee", employeeId: worker.id,
      worksiteId: newSite.id, effectiveFrom: NEXT_START, reason: "Fictional isolation acceptance assignment" };
    assert.ok(NEXT_START > priorAssignments[idx - 1].effectiveFrom);
    const assigned = expectStatus(await request(PATH, { method: "POST", cookie, body: assignBody }),
      201, "POST assign owned employee to owned worksite");
    const [assignment] = await db.select().from(employeeWorksiteAssignments)
      .where(eq(employeeWorksiteAssignments.id, assigned.json.assignment.id));
    assert.equal(assignment.organizationId, org.id);
    assert.equal(assignment.employeeId, worker.id);
    assert.equal(assignment.worksiteId, newSite.id);
    assert.equal(assignment.effectiveFrom, NEXT_START);
    const [closedPrior] = await db.select().from(employeeWorksiteAssignments)
      .where(eq(employeeWorksiteAssignments.id, priorAssignments[idx - 1].id));
    assert.equal(closedPrior.effectiveUntil, "2027-01-31", "Only the owned prior assignment closes");
    await denied(PATH, { method: "POST", cookie, body: { ...assignBody, employeeId: f.victimEmployee.id } },
      404, "POST assign foreign employee denied");
    await denied(PATH, { method: "POST", cookie, body: { ...assignBody, worksiteId: foreignSite.id } },
      404, "POST assign foreign worksite denied");
    await denied(PATH, { method: "POST", cookie, body: { ...assignBody, organizationId: victim.id,
      employeeId: f.victimEmployee.id, worksiteId: foreignSite.id } }, 403, "POST assign foreign employer denied");
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, org.id));
    for (const action of ["Worksite created", "Worksite updated", "Employee worksite assigned"]) {
      assert.ok(audit.some(row => row.action === action &&
        (row.metadata?.worksiteId === newSite.id || row.metadata?.employeeWorksiteAssignmentId === assignment.id)));
    }
    assert.deepEqual(await snapshot(victim.id), before, "Owned writes leave victim workforce, payroll and audit unchanged");

    const scoped = await actor(idx, "manager", f.ownedUnits[idx].id);
    const scopedRead = expectStatus(await request(endpoint(org.id), { cookie: scoped.session.cookie }),
      200, "Unit-scoped manager can read owned visible site");
    assert.ok(scopedRead.json.worksites.some(row => row.id === newSite.id));
    const ownedBefore = await snapshot(org.id);
    await denied(PATH, { method: "POST", cookie: scoped.session.cookie, body: createBody },
      403, "Unit-scoped manager cannot create company master data");
    await denied(PATH, { method: "POST", cookie: scoped.session.cookie, body: updateBody },
      403, "Unit-scoped manager cannot update company master data");
    const noMfa = await makeSession(owner.user.id);
    const mfaDenied = await denied(PATH, { method: "POST", cookie: noMfa.cookie, body: updateBody },
      403, "Owned worksite mutation still requires MFA");
    assert.equal(mfaDenied.json.code, "MFA_REQUIRED");
    const employee = await actor(idx, "employee");
    await denied(endpoint(org.id), { cookie: employee.session.cookie }, 403, "Employee role GET denied");
    await denied(PATH, { method: "POST", cookie: employee.session.cookie, body: assignBody },
      403, "Employee role POST denied");
    // Preserve another active employer grant to prove revocation is not logout.
    await db.insert(userOrganizations).values({ userId: owner.user.id,
      organizationId: f.orgs[3 - idx].id, role: "owner", active: true });
    await db.update(userOrganizations).set({ active: false }).where(and(
      eq(userOrganizations.userId, owner.user.id), eq(userOrganizations.organizationId, org.id)));
    expectStatus(await request("/api/account", { cookie }), 200, "Same revoked session remains signed in");
    await denied(endpoint(org.id), { cookie }, 403, "Revoked membership GET denied");
    for (const body of [createBody, updateBody, assignBody]) {
      await denied(PATH, { method: "POST", cookie, body }, 403, "Revoked membership action denied: " + body.action);
    }
    assert.deepEqual(await snapshot(org.id), ownedBefore, "Denied roles, MFA and revoked membership cannot mutate owned rows");
  }
  await denied(endpoint(victim.id), {}, 401, "Anonymous worksite GET denied");
  await denied(PATH, { method: "POST", body: { organizationId: victim.id, action: "update_worksite",
    worksiteId: foreignSite.id, name: "Forbidden fictional rename" } }, 401, "Anonymous worksite POST denied");
  assert.deepEqual(await snapshot(victim.id), before, "Final victim snapshot unchanged");
  console.log(JSON.stringify({ kind: "WORKSITE_PARTIAL_HTTP_CANDIDATE", independentAttackers: 2,
    methods: ["GET", "POST"], actions: ["create_worksite", "update_worksite", "assign_employee"],
    inventoryCreditsAdded: 0, remainingWorksiteActionsUnaccepted: true }));
}
