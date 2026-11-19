/** Regression for the same-workspace legal-employer boundary introduced in #2028.
 * Run only with the local fictional PG16 profile, against an empty database. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { requirePhase15Database, requirePhase15Environment } from "./golden-phase15-safety.ts";
import { activeMailProvider } from "../../src/lib/mail-provider.ts";

const mode = requirePhase15Environment(process.env);
assert.equal(mode, "local-disposable-pg16-only");
assert.equal(activeMailProvider(), "none");
assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
assert.equal(process.env.MULTI_ENTITY_ENABLED, "true");
assert.equal(process.env.MULTI_ENTITY_TRANSFERS_ENABLED, "false");
assert.equal(process.env.NODE_ENV, "production");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("diff", "--name-only", "HEAD", "--", "src", "scripts", "drizzle", "package-lock.json"), "");
const { db, pool } = await import("../../src/db/index.ts");
const { eq, and, asc } = await import("drizzle-orm");
const s = await import("../../src/db/schema.ts");
const { seedEmployer, standaloneMakeSession, standaloneRequest } = await import("./tenant-table-http.mjs");

try {
  const { rows: [identity] } = await pool.query(`select current_setting('server_version_num')::int as version,
    current_database() as database, host(inet_server_addr()) as "serverAddress",
    host(inet_client_addr()) as "clientAddress", current_setting('data_directory') as directory,
    (select count(*)::int from organizations) as employers`);
  requirePhase15Database(identity, mode);
  assert.equal(realpathSync(identity.directory), realpathSync(resolve("outputs/timesheet-employer-pg16")));
  const { org, entity, owner, worker, cookie } = await seedEmployer("ATTA", randomUUID().slice(0, 8), standaloneMakeSession);
  const [second] = await db.insert(s.legalEntities).values({
    organizationId: org.id, code: "TS-B", legalName: "Fictional B", displayName: "Fictional B",
  }).returning();
  const [other] = await db.insert(s.employees).values({
    organizationId: org.id, legalEntityId: second.id, employeeNo: "TS-B-1", firstName: "Fictional",
    lastName: "B worker", title: "QA", avatarInitials: "FB", basicRate: "30000.00", startDate: "2026-01-01",
  }).returning();
  const [hr] = await db.insert(s.users).values({
    email: "checker@example.invalid", name: "Fictional checker", passwordHash: "fictional-session-only", role: "hr", totpEnabled: true,
  }).returning();
  await db.insert(s.userOrganizations).values({ organizationId: org.id, userId: hr.id, role: "hr", active: true });
  const checker = await standaloneMakeSession(hr.id);
  await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, checker.id));
  const actors = [{ id: owner.id, cookie }, { id: hr.id, cookie: checker.cookie }];
  for (const actor of actors) for (const employer of [entity, second]) {
    await db.insert(s.userLegalEntityGrants).values({ organizationId: org.id, userId: actor.id, legalEntityId: employer.id });
  }
  const period = { periodStart: "2026-03-02", periodEnd: "2026-03-15" };
  const steps = [];
  async function request(actor, employer, body, status) {
    const selection = { organizationId: org.id, legalEntityId: employer.id };
    const method = body ? "POST" : "GET";
    const url = "/api/workforce/timesheets" + (body ? "" : "?" + new URLSearchParams({ ...selection, ...period }));
    const response = await standaloneRequest(url, { method, cookie: actor.cookie, body: body ? { ...selection, ...body } : undefined });
    assert.equal(response.status, status, method + " " + (body?.action ?? "list") + ": " + (response.json?.error ?? response.status));
    steps.push({ method, action: body?.action ?? "list", status });
    return response.json;
  }
  const rows = table => db.select().from(table).where(eq(table.organizationId, org.id)).orderBy(asc(table.id));
  async function state() {
    return Promise.all([s.workforceTimesheets, s.workforceTimesheetPolicies, s.workforceTimesheetExpectations,
      s.auditEvents, s.employees, s.payrollRuns, s.entityTransferRequests].map(rows));
  }
  const policy = { action: "update_policy", enforcementMode: "advisory", active: false };
  const submit = employee => ({ action: "submit", employeeId: employee.id, ...period });
  const decide = (sheet, decision) => ({ action: "decide", timesheetId: sheet.id, decision });
  for (const [employer, employee] of [[entity, worker], [second, other]]) {
    const [run] = await db.insert(s.payrollRuns).values({ organizationId: org.id, legalEntityId: employer.id,
      ...period, periodLabel: "Fictional March", payDate: period.periodEnd }).returning();
    await db.insert(s.workforceTimesheetExpectations).values({ organizationId: org.id, employeeId: employee.id,
      payrollRunId: run.id, ...period, expectedBy: period.periodEnd });
  }
  await request(actors[0], entity, policy, 200);
  const [saved] = await rows(s.workforceTimesheetPolicies);
  assert.equal(saved.updatedByUserId, owner.id);
  assert.equal(saved.enforcementMode, "advisory");
  assert.equal(saved.active, false);
  const owned = (await request(actors[0], entity, submit(worker), 201)).timesheet;
  const otherSheet = (await request(actors[0], second, submit(other), 201)).timesheet;
  await request(actors[1], entity, decide(owned, "approved"), 200);
  await request(actors[1], second, decide(otherSheet, "rejected"), 200);
  const stored = await rows(s.workforceTimesheets);
  for (const [sheet, employee, status] of [[owned,worker,"approved"],[otherSheet,other,"rejected"]]) {
    const row = stored.find(x => x.id === sheet.id);
    assert.equal(row.employeeId, employee.id);
    assert.equal(row.status, status);
    assert.equal(row.submittedByUserId, owner.id);
    assert.equal(row.decidedByUserId, hr.id);
  }
  function view(payload, employee, sheet) {
    assert.deepEqual(payload.employees.map(x => x.id), employee ? [employee.id] : []);
    for (const key of ["latest", "history"]) assert.deepEqual(payload[key].map(x => x.id), sheet ? [sheet.id] : []);
    assert.deepEqual(payload.expectations.map(x => x.employeeId), employee ? [employee.id] : []);
  }
  const beforeReads = await state();
  for (const actor of actors) {
    const firstView = await request(actor, entity, null, 200);
    view(firstView, worker, owned);
    assert.throws(() => view(firstView, other, otherSheet), assert.AssertionError,
      "timesheet validator accepts another employer's data");
    view(await request(actor, second, null, 200), other, otherSheet);
  }
  assert.deepEqual(await state(), beforeReads);
  // The same saved views and commands are now outside each manager's grant.
  await db.delete(s.userLegalEntityGrants).where(and(eq(s.userLegalEntityGrants.organizationId, org.id),
    eq(s.userLegalEntityGrants.legalEntityId, second.id)));
  const beforeDenials = await state();
  for (const actor of actors) {
    view(await request(actor, entity, null, 200), worker, owned);
    await request(actor, second, null, 403);
    await request(actor, second, submit(other), 403);
    await request(actor, entity, policy, 403);
    await request(actor, second, decide(otherSheet, "rejected"), 403);
  }
  assert.deepEqual(await state(), beforeDenials);
  // A corrected worker assignment invalidates the previously valid A form.
  // There is no transfer row here: this exercises the employer predicate alone.
  await db.update(s.employees).set({ legalEntityId: second.id }).where(eq(s.employees.id, worker.id));
  const reassigned = await state();
  for (const actor of actors) {
    view(await request(actor, entity, null, 200), null, null);
    await request(actor, entity, submit(worker), 404);
    await request(actor, entity, decide(owned, "approved"), 404);
  }
  assert.deepEqual(await state(), reassigned);
  await db.update(s.employees).set({ legalEntityId: entity.id }).where(eq(s.employees.id, worker.id));
  // An applied transfer makes historic timesheets unattributable even after
  // the worker joins the managers' currently granted employer.
  await db.transaction(async tx => {
    await tx.update(s.employees).set({ legalEntityId: entity.id }).where(eq(s.employees.id, other.id));
    await tx.insert(s.entityTransferRequests).values({ organizationId: org.id, employeeId: other.id,
      fromLegalEntityId: second.id, toLegalEntityId: entity.id, effectiveDate: "2026-04-01", status: "applied",
      reason: "Fictional transfer", serviceStartDate: "2026-01-01", continuityNote: "QA fixture",
      requestedByUserId: owner.id, approvedByUserId: hr.id, appliedAt: new Date() });
  });
  const beforeTransferred = await state();
  for (const actor of actors) {
    view(await request(actor, entity, null, 200), worker, owned);
    await request(actor, entity, submit(other), 404);
    await request(actor, entity, decide(otherSheet, "rejected"), 404);
  }
  assert.deepEqual(await state(), beforeTransferred);
  // Offboard both managers from this workspace while keeping their sessions
  // and their memberships in a separate fictional workspace active.
  const next = await seedEmployer("ATTB", randomUUID().slice(0, 8), standaloneMakeSession);
  for (const actor of actors) {
    await db.insert(s.userOrganizations).values({ organizationId: next.org.id, userId: actor.id, role: "hr", active: true });
    await db.insert(s.userLegalEntityGrants).values({ organizationId: next.org.id, userId: actor.id, legalEntityId: next.entity.id });
    await db.update(s.userOrganizations).set({ active: false }).where(and(
      eq(s.userOrganizations.organizationId, org.id), eq(s.userOrganizations.userId, actor.id)));
  }
  const beforeOffboarded = await state();
  for (const actor of actors) {
    const own = await standaloneRequest("/api/workforce/timesheets?" + new URLSearchParams({
      organizationId: next.org.id, legalEntityId: next.entity.id, ...period }), { cookie: actor.cookie });
    assert.equal(own.status, 200);
    assert.deepEqual(own.json.employees.map(x => x.id), [next.worker.id]);
    await request(actor, entity, null, 403);
    await request(actor, entity, policy, 403);
    await request(actor, entity, submit(worker), 403);
    await request(actor, entity, decide(owned, "approved"), 403);
  }
  assert.deepEqual(await state(), beforeOffboarded);
  const [employeeAccount] = await db.insert(s.users).values({
    email: "fixture-worker@example.invalid", name: "Fictional worker", employeeId: worker.id,
    passwordHash: "fictional-session-only", role: "employee",
  }).returning();
  await db.insert(s.userOrganizations).values({ organizationId: org.id, userId: employeeAccount.id, role: "employee", active: true });
  const self = await standaloneMakeSession(employeeAccount.id);
  view(await request(self, entity, null, 200), worker, owned);
  const ownSubmission = (await request(self, entity, {
    ...submit(worker), periodStart: "2026-05-04", periodEnd: "2026-05-17",
  }, 201)).timesheet;
  const [selfRow] = await db.select().from(s.workforceTimesheets).where(eq(s.workforceTimesheets.id, ownSubmission.id));
  assert.equal(selfRow.employeeId, worker.id);
  assert.equal(selfRow.submittedByUserId, employeeAccount.id);
  assert.equal(selfRow.status, "submitted");
  const beforeSelfDenials = await state();
  await request(self, entity, policy, 403);
  await request(self, entity, decide(ownSubmission, "approved"), 403);
  assert.deepEqual(await state(), beforeSelfDenials);
  const receipt = { label: "SOLO_VERIFIED_DEV_RECOVERY", head: git("rev-parse", "HEAD"), postgres: identity.version,
    managers: 2, legalEmployers: 2, steps, unchangedAfterReads: true, unchangedAfterDenials: true, unchangedAfterTransferChecks: true };
  writeFileSync("outputs/timesheet-employer-result.json", JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(receipt));
} finally { await pool.end(); }
