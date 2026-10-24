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
import { payrollEmploymentStatus } from "../../src/lib/approved-exit-payroll";

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
  assert.deepEqual((await db.select({ id: employees.id }).from(employees).where(and(eq(employees.organizationId, own.id), payrollEmploymentStatus("2026-10-01")))).map(row => row.id), [worker.id]); await seedApprovedExitFixtureProfile(own, worker, suffix);
  // This fixture isolates the handoff AFTER approved termination intent, not human intent approval.
  await db.insert(hcmBusinessProcessInstances).values({ organizationId: own.id, definitionCode: "fictional-prior-approved-intent", definitionVersion: 1, processType: "termination", sourceType: "separation_initiation", sourceKey: worker.id + ":" + suffix, employeeId: worker.id, effectiveDate: "2026-10-09", status: "approved", initiatedByUserId: actors[0].id, initiatedByName: actors[0].name, definitionSnapshot: { sourceEvidence: freezeSeparationIntent({ organizationId: own.id, employeeId: worker.id, employeeStatus: "Active", employeeOrgUnitId: null, employeeStartDate: "2025-01-01", employmentTermDecisionId: null, separationType: "resignation", noticeDate: "2026-09-20", lastDay: "2026-10-09" }) } });
  const body = { organizationId: own.id, employeeId: worker.id, separationType: "resignation", noticeDate: "2026-09-20", lastDay: "2026-10-09", unpaidBasicSalary: 0 };
  const ownCreate = expectStatus(await request("/api/separation", maker, "POST", body), 201, "Actual Separation POST creates package");
  const separationId = ownCreate.id;
  assert.equal((await db.select().from(employees).where(eq(employees.id, worker.id)))[0].status, "Separating");
  delete process.env.APPROVED_EXIT_PAYROLL_ENABLED;
  assert.equal((await db.select().from(employees).where(and(eq(employees.organizationId, own.id), payrollEmploymentStatus("2026-10-01")))).length, 0, "Flag-off SQL keeps the original Active-only scope");
  process.env.APPROVED_EXIT_PAYROLL_ENABLED = "true";
  const ownRead = expectStatus(await request("/api/separation?organizationId=" + own.id, maker), 200, "Owned Separation GET");
  assert.ok(ownRead.separations.some(row => row.id === separationId));
  const beforeForeign = await db.select().from(separationRecords).where(eq(separationRecords.id, separationId));
  expectStatus(await request("/api/separation?organizationId=" + own.id, stranger), 403, "Foreign GET denied");
  expectStatus(await request("/api/separation", stranger, "POST", body), 403, "Foreign POST denied");
  expectStatus(await request("/api/separation", stranger, "PATCH", { id: separationId, action: "approve" }), 403, "Foreign PATCH denied");
  const afterForeign = await db.select().from(separationRecords).where(eq(separationRecords.id, separationId));
  assert.deepEqual(afterForeign, beforeForeign, "Foreign separation mutations leave victim rows unchanged");

  const payrollBody = { organizationId: own.id, legalEntityId: entity.id, periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", processNow: false };
  const payrollBeforeForeign = await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, own.id));
  expectStatus(await request("/api/payroll-runs", stranger, "POST", payrollBody), 403, "Foreign payroll creation denied");
  const payrollAfterForeign = await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, own.id));
  assert.deepEqual(payrollAfterForeign, payrollBeforeForeign, "Denied payroll creation cannot mutate the victim register");
  const preflight = expectStatus(await request("/api/payroll-runs", maker, "POST", { ...payrollBody, processNow: true }), 409, "Processing reports the unapproved exit before creating a run");
  assert.equal(preflight.code, "PAYROLL_EXIT_APPROVAL_REQUIRED");
  const ownPayrollCreate = expectStatus(await request("/api/payroll-runs", maker, "POST", payrollBody), 201, "Actual payroll API creates a draft including a separating worker");
  const run = ownPayrollCreate.run;
  assert.equal(run.organizationId, own.id);
  const queued = await enqueuePayrollRun(run.id);
  assert.equal(queued.employeeCount, 1, "Separating worker cannot silently disappear");
  await assert.rejects(() => drainPayrollQueue(5, run.id), /PAYROLL_EXIT_APPROVAL_REQUIRED/);
  for (const field of ["itCleared", "adminCleared", "financeCleared", "hrCleared"]) {
    expectStatus(await request("/api/separation", checker, "PATCH", { id: separationId, action: "clearance", [field]: true, previousValue: false, clearanceEvidenceReference: "SYNTHETIC-" + field, clearanceReason: "Fictional CI clearance only, no external actions" }), 200, "Synthetic department clearance " + field);
  }
  const selfDenied = expectStatus(await request("/api/separation", maker, "PATCH", { id: separationId, action: "approve" }), 409, "Maker cannot self-approve final pay"); assert.equal(selfDenied.code, "FINAL_PAY_MAKER_CHECKER_REQUIRED");
  const ownPatch = expectStatus(await request("/api/separation", checker, "PATCH", { id: separationId, action: "approve" }), 200, "Distinct checker approves owned package");
  assert.ok(ownPatch);

  // Synthetic legacy/corruption fault injection: a status alone must not authorize wages.
  await db.update(separationRecords).set({ approvedByUserId: null }).where(eq(separationRecords.id, separationId));
  await enqueuePayrollRun(run.id);
  await assert.rejects(() => drainPayrollQueue(5, run.id), /PAYROLL_EXIT_APPROVAL_IDENTITY/);
  await db.update(separationRecords).set({ approvedByUserId: actors[1].id, unpaidBasicSalary: "6600.00" }).where(eq(separationRecords.id, separationId));
  await enqueuePayrollRun(run.id);
  await assert.rejects(() => drainPayrollQueue(5, run.id), /PAYROLL_FINAL_PAY_WAGE_OVERLAP/);
  assert.equal((await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id))).length, 0);
  await db.update(separationRecords).set({ unpaidBasicSalary: "0.00" }).where(eq(separationRecords.id, separationId));

  // A later raise must not change the worker's pre-exit cutoff pay.
  await db.update(employeePayProfiles).set({ rateAmount: "44000.00" }).where(and(eq(employeePayProfiles.employeeId, worker.id), eq(employeePayProfiles.organizationId, own.id)));
  await db.insert(employeePayRevisions).values({ organizationId: own.id, employeeId: worker.id, effectiveDate: "2026-10-10", previousPayBasis: "monthly", previousRateAmount: "22000.00", previousStandardWorkDaysPerMonth: "22.00", previousStandardHoursPerDay: "8.00", newPayBasis: "monthly", newRateAmount: "44000.00", newStandardWorkDaysPerMonth: "22.00", newStandardHoursPerDay: "8.00", reason: "Fictional post-exit rate regression" });
  await enqueuePayrollRun(run.id);
  await drainPayrollQueue(5, run.id);
  const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(entry.grossPay, "6600.00", "Oct1-9 wages: 22000 / 2 * 9/15");
  assert.ok(entry.trace.inputs.includes("monthlyEquivalent=22000.00"), "Deduction/profile inputs must also exclude the post-exit raise");
  assert.ok(entry.trace.inputs.includes("approvedExitProration=v1"));
  await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, run.id));
  await db.update(separationRecords).set({ unpaidBasicSalary: "6600.00" }).where(eq(separationRecords.id, separationId));
  await assert.rejects(() => settlePayrollRun(run.id), /PAYROLL_EXIT_EVIDENCE_CHANGED/);
  assert.equal((await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id)))[0].status, "Releasing");
  await db.update(separationRecords).set({ unpaidBasicSalary: "0.00" }).where(eq(separationRecords.id, separationId));
  await settlePayrollRun(run.id); // Synthetic release fixture, not HTTP ordinary checker/MFA evidence.
  expectStatus(await request("/api/separation", maker, "POST", { ...body, unpaidBasicSalary: 6600, finalStatutoryReviewed: true }), 422, "No duplicate wages in final pay");
  // Disposable fixture fault injection only: a crossing must never be accepted
  // from a stale/foreign separation trace, even when the payroll header is Released.
  const beforeOverlapDenials = await db.select().from(separationRecords).where(eq(separationRecords.id, separationId));
  for (const invalidInputs of [
    entry.trace.inputs.filter(value => value !== "approvedExitProration=v1"),
    entry.trace.inputs.map(value => value.startsWith("approvedSeparationId=") ? "approvedSeparationId=2147483647" : value),
    [...entry.trace.inputs, "employmentEnd=2026-10-15"],
  ]) {
    try {
      await db.update(payrollEntries).set({ trace: { ...entry.trace, inputs: invalidInputs } }).where(eq(payrollEntries.id, entry.id));
      expectStatus(await request("/api/separation", maker, "POST", body), 422, "Unverified crossing source refuses final-pay preparation");
      assert.deepEqual(await db.select().from(separationRecords).where(eq(separationRecords.id, separationId)), beforeOverlapDenials,
        "Denied overlap preparation cannot rewrite the approved final-pay package");
    } finally {
      await db.update(payrollEntries).set({ trace: entry.trace }).where(eq(payrollEntries.id, entry.id));
    }
  }
  const recomputed = expectStatus(await request("/api/separation", maker, "POST", body), 201, "Crossing cutoff with capped immutable wages enters final pay exactly once");
  assert.equal(recomputed.basicSalaryEarnedYtd, "6600.00");
  assert.equal(recomputed.unpaidBasicSalary, "0.00");
  assert.equal(recomputed.prorated13thMonth, "550.00");
  assert.equal(recomputed.status, "draft", "Recomputation invalidates prior financial approval");
  expectStatus(await request("/api/separation", checker, "PATCH", { id: separationId, action: "approve" }), 409, "Recomputation requires fresh finance clearance");
  expectStatus(await request("/api/separation", checker, "PATCH", { id: separationId, action: "clearance", financeCleared: true, previousValue: false, clearanceEvidenceReference: "SYNTHETIC-RECOMPUTED-FINANCE", clearanceReason: "Fictional recomputed package independently reviewed" }), 200, "Fresh finance clearance");
  expectStatus(await request("/api/separation", checker, "PATCH", { id: separationId, action: "approve" }), 200, "Recomputed final pay receives fresh distinct-checker approval");
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

/** Only disposable CI payroll fixture records; never repair live employee pay data. */
async function seedApprovedExitFixtureProfile(own, worker, suffix) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  const source = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(source.protocol, "postgresql:");
  assert.equal(source.hostname, "127.0.0.1");
  assert.equal(source.port, "5432");
  assert.equal(source.pathname, "/app_db");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
  assert.equal(worker.organizationId, own.id, "EXIT_HTTP_PROFILE_CROSS_TENANT_REFUSED");
  assert.equal(worker.employeeNo, "EXIT-" + suffix.slice(0, 8), "EXIT_HTTP_PROFILE_ROSTER_UNVERIFIED");
  assert.equal(worker.basicRate, "22000.00", "EXIT_HTTP_PROFILE_RATE_DRIFT_REFUSED");
  const [profile] = await db.insert(employeePayProfiles).values({
    employeeId: worker.id, organizationId: own.id, payBasis: "monthly",
    rateAmount: "22000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
  }).returning();
  assert.equal(profile.employeeId, worker.id);
  assert.equal(profile.organizationId, own.id);
  assert.equal(profile.rateAmount, "22000.00");
}
