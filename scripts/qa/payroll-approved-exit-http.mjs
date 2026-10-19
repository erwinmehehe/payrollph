/** Synthetic prior intent approval is seeded; financial checker decisions use real HTTP.
 * Never runs against Neon, production, provider APIs or a developer database.
 */
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../src/db";
import { organizations, legalEntities, employees, employeePayProfiles, employeePayRevisions,
  users, userOrganizations, sessions, hcmBusinessProcessInstances, separationRecords,
  payrollRuns, payrollEntries } from "../../src/db/schema";
import { freezeSeparationIntent } from "../../src/lib/hcm-separation-business-process";
import { enqueuePayrollRun, drainPayrollQueue } from "../../src/lib/payroll-engine";
import { settlePayrollRun } from "../../src/lib/payroll-settlement";

const base = process.env.SECURITY_SMOKE_URL;
const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(base, "http://127.0.0.1:3000");
assert.equal(database.protocol, "postgresql:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port, "5432");
assert.equal(database.pathname, "/app_db");
assert.equal(process.env.APPROVED_EXIT_PAYROLL_ENABLED, "true");
for (const key of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "FINAL_PAY_MANUAL_RELEASE_ENABLED"]) assert.notEqual(process.env[key], "true");

async function request(path, cookie, method = "GET", body) {
  const response = await fetch(base + path, { method, redirect: "manual", cache: "no-store",
    headers: { cookie, origin: base, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { /* diagnostic text retained */ }
  return { status: response.status, json, text };
}
function expectStatus(response, status, label) {
  assert.equal(response.status, status, label + ": " + response.text.slice(0, 220));
  return response.json;
}
async function session(userId) {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({ userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date(), mfaVerifiedAt: new Date() });
  return "__Host-linaw_session=" + token;
}

const suffix = randomUUID();
const orgs = await db.insert(organizations).values([
  { name: "Fictional Exit Employer " + suffix, legalName: "Fictional Exit Employer" },
  { name: "Fictional Exit Foreign " + suffix, legalName: "Fictional Foreign Employer" },
]).returning();
const [own, foreign] = orgs;
const actors = await db.insert(users).values(["maker", "checker", "foreign"].map(role => ({
  email: "exit-http-" + role + "-" + suffix + "@example.invalid", name: "Fictional " + role,
  role: "owner", passwordHash: "synthetic-session-only", totpEnabled: true,
}))).returning();
try {
  await db.insert(userOrganizations).values(actors.map((user, i) => ({ userId: user.id, organizationId: i === 2 ? foreign.id : own.id, role: "owner", active: true })));
  const [maker, checker, stranger] = await Promise.all(actors.map(actor => session(actor.id)));
  const [entity] = await db.insert(legalEntities).values({ organizationId: own.id, code: "PRIMARY", legalName: "Fictional Exit Employer", displayName: "Fictional Exit", primaryEntity: true }).returning();
  const [worker] = await db.insert(employees).values({ organizationId: own.id, legalEntityId: entity.id, employeeNo: "EXIT-" + suffix.slice(0, 8), firstName: "Fictional", lastName: "Exit", title: "Synthetic", avatarInitials: "FE", basicRate: "22000.00", startDate: "2025-01-01", mobile: "09999999999" }).returning();
  // This fixture isolates the handoff AFTER approved termination intent, not human intent approval.
  await db.insert(hcmBusinessProcessInstances).values({ organizationId: own.id, definitionCode: "fictional-prior-approved-intent", definitionVersion: 1, processType: "termination", sourceType: "separation_initiation", sourceKey: worker.id + ":" + suffix, employeeId: worker.id, effectiveDate: "2026-10-09", status: "approved", initiatedByUserId: actors[0].id, initiatedByName: actors[0].name, definitionSnapshot: { sourceEvidence: freezeSeparationIntent({ organizationId: own.id, employeeId: worker.id, employeeStatus: "Active", employeeOrgUnitId: null, employeeStartDate: "2025-01-01", employmentTermDecisionId: null, separationType: "resignation", noticeDate: "2026-09-20", lastDay: "2026-10-09" }) } });
  const body = { organizationId: own.id, employeeId: worker.id, separationType: "resignation", noticeDate: "2026-09-20", lastDay: "2026-10-09", unpaidBasicSalary: 0 };
  const ownCreate = expectStatus(await request("/api/separation", maker, "POST", body), 201, "Actual Separation POST creates package");
  const separationId = ownCreate.id;
  assert.equal((await db.select().from(employees).where(eq(employees.id, worker.id)))[0].status, "Separating");
  const ownRead = expectStatus(await request("/api/separation?organizationId=" + own.id, maker), 200, "Owned Separation GET");
  assert.ok(ownRead.separations.some(row => row.id === separationId));
  const beforeForeign = await db.select().from(separationRecords).where(eq(separationRecords.id, separationId));
  expectStatus(await request("/api/separation?organizationId=" + own.id, stranger), 403, "Foreign GET denied");
  expectStatus(await request("/api/separation", stranger, "POST", body), 403, "Foreign POST denied");
  expectStatus(await request("/api/separation", stranger, "PATCH", { id: separationId, action: "approve" }), 403, "Foreign PATCH denied");
  const afterForeign = await db.select().from(separationRecords).where(eq(separationRecords.id, separationId));
  assert.deepEqual(afterForeign, beforeForeign, "Foreign separation mutations leave victim rows unchanged");

  const [run] = await db.insert(payrollRuns).values({ organizationId: own.id, legalEntityId: entity.id, periodLabel: "Fictional exit cutoff", periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", status: "Draft" }).returning();
  const queued = await enqueuePayrollRun(run.id);
  assert.equal(queued.employeeCount, 1, "Separating worker cannot silently disappear");
  await assert.rejects(() => drainPayrollQueue(5, run.id), /PAYROLL_EXIT_APPROVAL_REQUIRED/);
  for (const field of ["itCleared", "adminCleared", "financeCleared", "hrCleared"]) {
    expectStatus(await request("/api/separation", checker, "PATCH", { id: separationId, action: "clearance", [field]: true, previousValue: false, clearanceEvidenceReference: "SYNTHETIC-" + field, clearanceReason: "Fictional CI clearance only, no external actions" }), 200, "Synthetic department clearance " + field);
  }
  const selfDenied = expectStatus(await request("/api/separation", maker, "PATCH", { id: separationId, action: "approve" }), 409, "Maker cannot self-approve final pay"); assert.equal(selfDenied.code, "FINAL_PAY_MAKER_CHECKER_REQUIRED");
  const ownPatch = expectStatus(await request("/api/separation", checker, "PATCH", { id: separationId, action: "approve" }), 200, "Distinct checker approves owned package");
  assert.ok(ownPatch);

  // A later raise must not change the worker's pre-exit cutoff pay.
  await db.update(employeePayProfiles).set({ rateAmount: "44000.00" }).where(and(eq(employeePayProfiles.employeeId, worker.id), eq(employeePayProfiles.organizationId, own.id)));
  await db.insert(employeePayRevisions).values({ organizationId: own.id, employeeId: worker.id, effectiveDate: "2026-10-10", previousPayBasis: "monthly", previousRateAmount: "22000.00", previousStandardWorkDaysPerMonth: "22.00", previousStandardHoursPerDay: "8.00", newPayBasis: "monthly", newRateAmount: "44000.00", newStandardWorkDaysPerMonth: "22.00", newStandardHoursPerDay: "8.00", reason: "Fictional post-exit rate regression" });
  await enqueuePayrollRun(run.id);
  await drainPayrollQueue(5, run.id);
  const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(entry.grossPay, "6600.00", "Oct1-9 wages: 22000 / 2 * 9/15");
  assert.ok(entry.trace.inputs.includes("approvedExitProration=v1"));
  await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, run.id));
  await settlePayrollRun(run.id); // Synthetic release fixture, not HTTP ordinary checker/MFA evidence.
  expectStatus(await request("/api/separation", maker, "POST", { ...body, unpaidBasicSalary: 6600, finalStatutoryReviewed: true }), 422, "No duplicate wages in final pay");
  const recomputed = expectStatus(await request("/api/separation", maker, "POST", body), 201, "Crossing cutoff with capped immutable wages enters final pay exactly once");
  assert.equal(recomputed.basicSalaryEarnedYtd, "6600.00");
  assert.equal(recomputed.unpaidBasicSalary, "0.00");
  assert.equal(recomputed.prorated13thMonth, "550.00");
  assert.equal(recomputed.status, "draft", "Recomputation invalidates prior financial approval");
  const afterFinalPay = await db.select().from(payrollEntries).where(eq(payrollEntries.id, entry.id));
  assert.deepEqual(afterFinalPay, [entry], "Final-pay recomputation cannot rewrite released payroll");
  console.log(JSON.stringify({ result: "PASS", kind: "SYNTHETIC_APPROVED_EXIT_HTTP_PG", separatingEmployeeIncluded: true, unapprovedExitBlocked: true, makerSelfApprovalDenied: true, foreignReadWriteDenied: true, gross: "6600.00", finalPayBasicYtd: "6600.00", finalPayUnpaidBasic: "0.00", thirteenthDue: "550.00", doubleCount: false, productionActivation: false, humanIntentApprovalTested: false, ordinaryHttpCheckerTested: false }));
} finally {
  await db.delete(payrollRuns).where(inArray(payrollRuns.organizationId, orgs.map(org => org.id)));
  await db.delete(employees).where(eq(employees.organizationId, own.id));
  await db.delete(legalEntities).where(eq(legalEntities.organizationId, own.id));
  await db.delete(organizations).where(inArray(organizations.id, orgs.map(org => org.id)));
  await db.delete(users).where(inArray(users.id, actors.map(actor => actor.id)));
}
