/**
 * One MWE classification PATCH method, two independent owners and a higher-ID victim.
 * Real localhost production Next.js HTTP + empty disposable PostgreSQL 16.
 * Both approve and reject must succeed for each owner, while victim and same-org
 * ungranted legal-employer records remain byte-identical under all attacks.
 * Never contacts providers or production; no independent acceptance implied.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { requireDisposableMweDecision, requireDecisionPositive, requireTenantDenial } from "./tenant-mwe-decision-contract.mjs";

requireDisposableMweDecision(); // MUST execute before every application/database import.
const [{ db }, s, harness] = await Promise.all([
  import("../../src/db/index.ts"),
  import("../../src/db/schema.ts"),
  import("./tenant-table-http.mjs"),
]);
const BASE = process.env.SECURITY_SMOKE_URL;
const marker = randomUUID().slice(0, 8);
const tables = {
  employees: s.employees, classifications: s.employeeMweClassifications,
  audits: s.auditEvents, payroll: s.payrollRuns,
  approvalTasks: s.approvalTasks, memberships: s.userOrganizations,
  entityGrants: s.userLegalEntityGrants,
};
async function snapshot(orgId) {
  const state = {};
  for (const [name, table] of Object.entries(tables)) {
    state[name] = await db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(table.id);
  }
  return state;
}
async function decision(actor, employeeId, classificationId, action, { query = "", entityId = null } = {}) {
  const headers = {
    "content-type": "application/json", origin: BASE,
    "sec-fetch-site": "same-origin",
  };
  if (actor?.cookie) headers.cookie = actor.cookie;
  if (entityId != null) headers["x-legal-entity-id"] = String(entityId);
  const response = await fetch(
    BASE + "/api/employees/" + employeeId + "/mwe-classifications/" + classificationId + query,
    { method: "PATCH", headers, body: JSON.stringify({ decision: action, decisionNote: "Fictional tax evidence reviewed" }),
      redirect: "manual", cache: "no-store" },
  );
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json };
}
async function seed(label) {
  const company = await harness.seedEmployer(label, marker, harness.standaloneMakeSession);
  await db.insert(s.userLegalEntityGrants).values({
    organizationId: company.org.id, userId: company.owner.id, legalEntityId: company.entity.id,
  });
  const [maker] = await db.insert(s.users).values({
    email: "mwe-maker-" + label.toLowerCase() + "-" + marker + "@example.invalid",
    name: "Fictional MWE maker " + label, role: "hr", passwordHash: "fictional-only",
  }).returning();
  const records = [];
  for (const [index, effectiveFrom] of ["2026-10-01", "2026-11-01", "2026-12-01"].entries()) {
    const [item] = await db.insert(s.employeeMweClassifications).values({
      organizationId: company.org.id, employeeId: company.worker.id,
      isMwe: index === 0, region: "NCR", employeeDailyWage: "755.00",
      statutoryMinimumWage: "755.00", wageOrderReference: "FICTIONAL-WAGE-ORDER-" + label,
      evidenceReference: "MWE-CI-" + label + "-" + index,
      effectiveFrom, status: "pending", requestedByUserId: maker.id,
      requestedByName: maker.name,
    }).returning();
    records.push(item);
  }
  return { ...company, records, maker };
}
const attackers = [await seed("ATTA"), await seed("ATTB")];
const victim = await seed("VICTIM");
assert.ok(victim.org.id > Math.max(...attackers.map(a => a.org.id)) &&
  victim.worker.id > Math.max(...attackers.map(a => a.worker.id)) &&
  victim.records[0].id > Math.max(6, ...attackers.flatMap(a => a.records.map(row => row.id))),
  "REAL higher-ID victim organization, employee and classification must exist");
for (const attacker of attackers) {
  const account = await fetch(BASE + "/api/account", { headers: { cookie: attacker.cookie }, cache: "no-store" });
  assert.equal(account.status, 200, "An actual signed-in owner cookie must work");
}
const victimBefore = await snapshot(victim.org.id);
const forbidden = [victim.marker, victim.maker.name, "MWE-CI-VICTIM"];
const anonymous = await decision(null, victim.worker.id, victim.records[0].id, "reject");
assert.equal(anonymous.status, 401, "Anonymous PATCH must not inspect victim tax evidence");

for (const attacker of attackers) {
  // Four-part method proof: each of two owners has a nonempty real 200 result
  // for BOTH actions, followed by real higher-ID victim denials and unchanged SQL.
  const ownPositive = await decision(attacker, attacker.worker.id, attacker.records[0].id,
    "approve", { entityId: attacker.entity.id });
  requireDecisionPositive(ownPositive, attacker, attacker.records[0], "approved");
  const ownReject = await decision(attacker, attacker.worker.id, attacker.records[1].id,
    "reject", { entityId: attacker.entity.id });
  requireDecisionPositive(ownReject, attacker, attacker.records[1], "rejected");

  const foreignDenial = await decision(attacker, victim.worker.id, victim.records[0].id,
    "reject", { entityId: attacker.entity.id });
  requireTenantDenial(foreignDenial, [404], forbidden);
  const unknown = await decision(attacker, victim.worker.id, victim.records[0].id + 200_000,
    "reject", { entityId: attacker.entity.id });
  assert.equal(foreignDenial.status, unknown.status, "Real foreign and unknown object must share HTTP status");
  assert.equal(foreignDenial.text, unknown.text, "Real foreign and unknown object must be indistinguishable");

  const forgedSelector = await decision(attacker, attacker.worker.id, attacker.records[2].id,
    "reject", { entityId: victim.entity.id });
  requireTenantDenial(forgedSelector, [403], forbidden);
  const forgedQuery = await decision(attacker, attacker.worker.id, attacker.records[2].id,
    "reject", { query: "?legalEntityId=" + victim.entity.id, entityId: attacker.entity.id });
  requireTenantDenial(forgedQuery, [403], forbidden);

  assert.deepEqual(await snapshot(victim.org.id), victimBefore,
    "Real victim classifications, employees, audits, payroll, grants and approvals stay unchanged");
  const statuses = await db.select().from(s.employeeMweClassifications)
    .where(eq(s.employeeMweClassifications.organizationId, attacker.org.id));
  assert.ok(statuses.some(row => row.id === attacker.records[0].id && row.status === "approved"));
  assert.ok(statuses.some(row => row.id === attacker.records[1].id && row.status === "rejected"));
  const audit = await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, attacker.org.id));
  assert.ok(audit.some(row => row.action === "MWE classification approved"));
  assert.ok(audit.some(row => row.action === "MWE classification rejected"));
}

// Same organization, second legal employer with no grant: company owner must
// still be denied, even though its org/unit permission would otherwise pass.
const a = attackers[0];
const [secondEntity] = await db.insert(s.legalEntities).values({
  organizationId: a.org.id, code: "MWE-CI-SECOND-" + marker,
  legalName: "Fictional second employer", displayName: "Secondary fictional employer",
}).returning();
const [secondWorker] = await db.insert(s.employees).values({
  organizationId: a.org.id, legalEntityId: secondEntity.id, orgUnitId: a.unit.id,
  employeeNo: "MWE-SECOND-" + marker, firstName: "Second", lastName: "Employer",
  title: "Fictional", avatarInitials: "SE", basicRate: "20000.00", startDate: "2026-01-05",
}).returning();
const [secondRecord] = await db.insert(s.employeeMweClassifications).values({
  organizationId: a.org.id, employeeId: secondWorker.id,
  isMwe: true, region: "NCR", employeeDailyWage: "755.00", statutoryMinimumWage: "755.00",
  wageOrderReference: "FICTIONAL-SECOND", evidenceReference: "Fictional second employer packet",
  effectiveFrom: "2026-10-01", requestedByUserId: a.maker.id, requestedByName: a.maker.name,
}).returning();
const secondBefore = await snapshot(a.org.id);
const wrongEmployer = await decision(a, secondWorker.id, secondRecord.id, "reject",
  { entityId: a.entity.id });
requireTenantDenial(wrongEmployer, [404], ["Fictional second employer packet"]);
const unknownSecond = await decision(a, secondWorker.id, secondRecord.id + 200_000,
  "reject", { entityId: a.entity.id });
assert.equal(wrongEmployer.text, unknownSecond.text,
  "Real ungranted employer and unknown classification must have identical private denials");
const ungrantedEmployer = await decision(a, secondWorker.id, secondRecord.id, "reject",
  { entityId: secondEntity.id });
requireTenantDenial(ungrantedEmployer, [404], ["Fictional second employer packet"]);
const unknownSelected = await decision(a, secondWorker.id, secondRecord.id + 200_000,
  "reject", { entityId: secondEntity.id });
assert.equal(ungrantedEmployer.text, unknownSelected.text,
  "A selected but ungranted employer must not reveal whether a record exists");
assert.deepEqual(await snapshot(a.org.id), secondBefore,
  "Same-workspace ungranted employer attempt must not touch any tax or audit rows");

// A real active same-workspace HR member without payroll-tax checker role
// must not learn whether another worker's tax classification ID exists.
const [hrViewer] = await db.insert(s.users).values({
  email: "fictional-mwe-hr-viewer-" + marker + "@example.invalid",
  name: "Fictional nonchecker viewer", role: "hr", totpEnabled: true,
  passwordHash: "fictional-only",
}).returning();
await db.insert(s.userOrganizations).values({
  userId: hrViewer.id, organizationId: a.org.id, role: "hr", active: true,
});
const hrSession = await harness.standaloneMakeSession(hrViewer.id);
await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
  .where(eq(s.sessions.id, hrSession.id));
const nonChecker = { cookie: hrSession.cookie };
const knownButForbidden = await decision(nonChecker, a.worker.id, a.records[2].id,
  "reject", { entityId: a.entity.id });
const missingForNonChecker = await decision(nonChecker, a.worker.id,
  a.records[2].id + 200_000, "reject", { entityId: a.entity.id });
requireTenantDenial(knownButForbidden, [404], [a.marker, a.maker.name]);
assert.equal(knownButForbidden.text, missingForNonChecker.text,
  "Non-checker active workspace users must not enumerate real MWE classification IDs");

// Revoke the attacker's company membership: the globally addressable
// classification ID must become exactly as undiscoverable as a nonexistent ID.
await db.update(s.userOrganizations).set({ active: false }).where(and(
  eq(s.userOrganizations.organizationId, a.org.id),
  eq(s.userOrganizations.userId, a.owner.id),
));
const revoked = await decision(a, a.worker.id, a.records[2].id, "reject");
requireTenantDenial(revoked, [404], forbidden);
assert.deepEqual(await snapshot(victim.org.id), victimBefore,
  "Revocation and forged selector attacks leave actual victim SQL unchanged");
console.log(JSON.stringify({
  kind: "MWE-PATCH-tenant-recovery-candidate",
  method: "PATCH employees/[id]/mwe-classifications/[classificationId]",
  fictionalPostgresMajor: 16, attackerEmployers: 2, victimEmployers: 1,
  ownedApprove200: 2, ownedReject200: 2,
  victimUnknownEquivalent: true, forgedSelectorDenied: true,
  sameOrganizationOtherEmployerDenied: true, unauthorizedRoleUnknownEquivalent: true,
  ungrantedEmployerUnknownEquivalent: true, revokedMembershipDenied: true,
  unchangedVictimSql: true, methodCredits: 1,
  reviewStatus: "PROVISIONAL_NOT_ACCEPTED", productionDataUsed: false,
}));
