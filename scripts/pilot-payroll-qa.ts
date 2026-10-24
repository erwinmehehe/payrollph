import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { attendanceExceptionEvents, auditEvents, employees, leaveBalances, leaveConversions, leavePolicies, leaveRequests, payrollEntries, payrollRuns, separationRecords, timePunches, userOrganizations, users, workforceTimesheets } from "../src/db/schema";
import { hashPassword } from "../src/lib/crypto";
import { configuredPayrollPayoutProvider } from "../src/lib/payroll-payout-provider";
import { isEncryptedBankAccount } from "../src/lib/bank-account-crypto";
import { reconcileAttendanceExceptionEvents } from "../src/lib/workforce-attendance-exception-events";

const base = process.env.QA_URL ?? "http://127.0.0.1:3000";
const selectedPayoutProvider = configuredPayrollPayoutProvider();
const setupToken = process.env.SETUP_TOKEN ?? "";
const readinessToken = process.env.READINESS_TOKEN ?? "";
const unique = randomUUID().replaceAll("-", "");
const credentials = {
  owner: `Owner!Aa1${unique.slice(0, 16)}`,
  payroll: `Payroll!Aa1${unique.slice(4, 20)}`,
  checker: `Checker!Aa1${unique.slice(8, 24)}`,
  employee: `Employee!Aa1${unique.slice(12, 28)}`,
};
const payoutAccounts = [`PILOT${unique.slice(0, 12)}`, `PILOT${unique.slice(12, 24)}`];

const report: Record<string, unknown> = {
  base,
  tenant: "fresh-non-demo",
  lifecycle: [],
  externalReadinessBlockers: [],
  independentOperatorAccepted: false,
  realEmployerReconciled: false,
  agencyAccepted: false,
  physicalDeviceAccepted: false,
  boundary: "Synthetic employee-record creation, onboarding, scheduling, historical attendance, timesheet approval, payroll review/release and draft filing evidence. Historical punches are seeded; recruitment conversion and physical clock capture remain separate gates.",
};

class ApiClient {
  cookie = "";
  async request(path: string, init: RequestInit & { json?: unknown } = {}) {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    if (this.cookie) headers.set("cookie", this.cookie);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) headers.set("origin", base);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const response = await fetch(`${base}${path}`, { ...init, method, headers, body });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return response;
  }
  async json(path: string, init: RequestInit & { json?: unknown } = {}) {
    const response = await this.request(path, init);
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }
}

async function expectOk(client: ApiClient, path: string, init: RequestInit & { json?: unknown } = {}) {
  const { response, payload } = await client.json(path, init);
  assert.ok(response.ok, `${init.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload as Record<string, any>;
}

async function login(email: string, password: string) {
  const client = new ApiClient();
  await expectOk(client, "/api/auth/login", { method: "POST", json: { email, password } });
  assert.ok(client.cookie, `No session cookie for ${email}`);
  return client;
}

async function verifySyntheticSeparation(owner: ApiClient, maker: ApiClient, organizationId: number) {
  assert.equal(base, "http://127.0.0.1:3000", "Separation QA is restricted to the isolated local CI app.");
  assert.equal(organizationId, 1, "The synthetic cap must match the fresh CI tenant exactly.");
  assert.notEqual(process.env.FINAL_PAY_MANUAL_RELEASE_ENABLED, "true");
  const type = "Synthetic exit leave";
  const person = await expectOk(owner, "/api/employees", { method: "POST", json: {
    organizationId, employeeNo: "PILOT-EXIT-001", firstName: "Synthetic", lastName: "Exit",
    title: "QA Fixture", payBasis: "monthly", rateAmount: 22000,
    standardWorkDaysPerMonth: 22, standardHoursPerDay: 8, region: "NCR", startDate: "2026-01-01",
  } });
  const employeeId = Number(person.employee.id);
  await db.insert(leavePolicies).values({ organizationId, leaveType: type, annualDays: "10" });
  const [balance] = await db.insert(leaveBalances).values({
    organizationId, employeeId, leaveType: type, year: 2026,
    opening: "10", used: "3", pending: "2",
  }).returning();
  await db.insert(leaveConversions).values({
    organizationId, employeeId, leaveType: type, daysConverted: "2",
    dailyRate: "1000.00", cashAmount: "2000.00", status: "approved",
    createdAt: new Date("2026-09-01T00:00:00Z"),
  });
  const request = { organizationId, employeeId, separationType: "resignation",
    noticeDate: "2026-09-01", lastDay: "2026-09-30", unusedLeaveType: type,
    unusedLeaveCredits: 3, leaveTaxReviewed: true, leaveMonetizationTaxExempt: false };
  const excess = await maker.json("/api/separation", { method: "POST", json: { ...request, unusedLeaveCredits: 3.1 } });
  assert.equal(excess.response.status, 422);
  assert.match(String(excess.payload.error), /authorized unspent balance/);
  assert.equal((await db.select().from(separationRecords).where(eq(separationRecords.employeeId, employeeId))).length, 0);
  const pending = await expectOk(maker, "/api/separation", { method: "POST", json: request });
  assert.equal(pending.approvalRequired, true);
  assert.equal(pending.separationCreated, false);
  assert.equal((await db.select().from(separationRecords).where(eq(separationRecords.employeeId, employeeId))).length, 0);
  const [hrUser] = await db.insert(users).values({
    email: "hr.exit.pilot@linaw.test", name: "Synthetic exit HR reviewer", role: "hr",
    passwordHash: hashPassword(credentials.checker), totpEnabled: false, backupCodes: [],
  }).returning();
  await db.insert(userOrganizations).values({ userId: hrUser.id, organizationId, role: "hr" });
  const hr = await login(hrUser.email, credentials.checker);
  for (const reviewer of [hr, owner]) {
    const inbox = await expectOk(reviewer, `/api/hcm/business-processes/inbox?organizationId=${organizationId}`);
    const step = inbox.myWork.find((item: Record<string, any>) => Number(item.instanceId) === Number(pending.businessProcess.id));
    assert.ok(step?.approvalTaskId, "The separation intent needs its next governed approval task.");
    assert.equal(step.makerBlocked, false);
    await expectOk(reviewer, `/api/approvals/${step.approvalTaskId}`, { method: "PATCH", json: { status: "Approved" } });
  }
  const computed = await expectOk(maker, "/api/separation", { method: "POST", json: request });
  assert.equal(computed.status, "draft");
  assert.equal(computed.computationSnapshot.separationLeave.convertible, 3);
  assert.equal(computed.computationSnapshot.separationLeave.authorizedCap, 5);
  assert.equal(Number(computed.leaveMonetizationPay), 3000);
  for (const field of ["itCleared", "adminCleared", "financeCleared", "hrCleared"]) {
    await expectOk(owner, "/api/separation", { method: "PATCH", json: {
      id: computed.id, action: "clearance", [field]: true, previousValue: false,
      clearanceEvidenceReference: `synthetic-ci-${field}`,
      clearanceReason: "Synthetic QA assertion only; no actual departmental attestation.",
    } });
  }
  await db.update(leaveBalances).set({ used: "4" }).where(eq(leaveBalances.id, balance.id));
  const stale = await owner.json("/api/separation", { method: "PATCH", json: { id: computed.id, action: "approve" } });
  assert.equal(stale.response.status, 409);
  assert.match(String(stale.payload.error), /changed after final pay/);
  const revised = await expectOk(maker, "/api/separation", { method: "POST", json: { ...request, unusedLeaveCredits: 2 } });
  assert.equal(Number(revised.id), Number(computed.id));
  assert.equal(revised.approvedByUserId, null);
  assert.equal(revised.computationSnapshot.separationLeave.convertible, 2);
  assert.equal(revised.financeCleared, false, "Recomputation must revoke Finance clearance.");
  await expectOk(owner, "/api/separation", { method: "PATCH", json: {
    id: revised.id, action: "clearance", financeCleared: true, previousValue: false,
    clearanceEvidenceReference: "synthetic-ci-finance-recomputed",
    clearanceReason: "Synthetic QA assertion for the recomputed package only.",
  } });
  const approved = await expectOk(owner, "/api/separation", { method: "PATCH", json: { id: revised.id, action: "approve" } });
  assert.equal(approved.status, "approved");
  assert.notEqual(approved.preparedByUserId, approved.approvedByUserId);
  const release = await owner.json("/api/separation", { method: "PATCH", json: { id: revised.id, action: "release" } });
  assert.equal(release.response.status, 409);
  assert.equal(release.payload.code, "FINAL_PAY_MANUAL_RELEASE_NOT_CERTIFIED");
  assert.equal(Number((await db.select().from(leaveBalances).where(eq(leaveBalances.id, balance.id)))[0].used), 4);
  report.syntheticSeparation = { result: "passed", cap: 5, reservedDays: 2,
    rejectedExcess: true, staleApprovalBlocked: true, recomputedCredits: 2,
    distinctTestActors: true, hcmIntentReviewedBeforeComputation: true,
    manualReleaseBlocked: true, balanceUnspent: true };
}

/**
 * This harness creates fictional records and calls writable routes. It must
 * refuse every remote target, even when someone supplies working credentials.
 * No real payroll, GPS, statutory submission, outbound provider or bank may be
 * accessed by automated journey acceptance.
 */
function assertDisposableSyntheticTarget() {
  assert.equal(process.env.CI, "true", "Synthetic employer journey runs only in CI.");
  assert.equal(base, "http://127.0.0.1:3000", "No remote or production app may be used.");
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(databaseUrl.hostname, "127.0.0.1", "Only the disposable local PostgreSQL is permitted.");
  assert.equal(databaseUrl.port, "5432");
  assert.equal(databaseUrl.pathname, "/app_db");
  assert.equal(process.env.DEMO_MODE, "false");
  for (const flag of [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_PAYOUTS_LIVE_APPROVED", "WFM_GEOFENCE_PILOT_ENABLED",
  ]) {
    assert.notEqual(process.env[flag], "true", `${flag} must remain disabled in synthetic CI.`);
  }
  assert.equal(process.env.OPENAI_API_KEY ?? "", "", "No external AI provider is permitted.");
}

async function main() {
  assertDisposableSyntheticTarget();
  assert.equal(process.env.PAYMONGO_SECRET_KEY ?? "", "");
  assert.ok(setupToken && readinessToken, "Pilot QA tokens must be configured.");
  mkdirSync("qa-artifacts", { recursive: true });

  const bootstrap = new ApiClient();
  const setup = await expectOk(bootstrap, "/api/setup", {
    method: "POST",
    headers: { "x-setup-token": setupToken },
    json: {
      companyName: "Pilot Works PH",
      legalName: "Pilot Works Philippines Inc.",
      name: "Olivia Owner",
      email: "owner.pilot@linaw.test",
      password: credentials.owner,
    },
  });
  const organizationId = Number(setup.organizationId);
  assert.ok(organizationId > 0, "Setup returned no organization id.");
  report.organizationId = organizationId;
  (report.lifecycle as string[]).push("workspace-created");

  // Login boots only global reference data when DEMO_MODE=false.
  const owner = await login("owner.pilot@linaw.test", credentials.owner);

  const inputs = [
    { employeeNo: "PILOT-001", firstName: "Ella", middleName: "Marie", lastName: "Employee", email: "ella.employee@linaw.test", title: "Operations Specialist", rateAmount: 42000, bankAccount: payoutAccounts[0], mobile: "QA-MOBILE-001", tin: "QA-TIN-001", sssNo: "QA-SSS-001", philHealthNo: "QA-PHIC-001", pagIbigNo: "QA-HDMF-001", startDate: "2026-01-05" },
    { employeeNo: "PILOT-002", firstName: "Mara", middleName: "Luz", lastName: "Santos", email: "mara.santos@linaw.test", title: "Customer Success Specialist", rateAmount: 36000, bankAccount: payoutAccounts[1], mobile: "QA-MOBILE-002", tin: "QA-TIN-002", sssNo: "QA-SSS-002", philHealthNo: "QA-PHIC-002", pagIbigNo: "QA-HDMF-002", startDate: "2026-02-10" },
  ];

  const created: Array<{ id: number; employeeNo: string }> = [];
  for (const input of inputs) {
    const payload = await expectOk(owner, "/api/employees", {
      method: "POST",
      json: {
        organizationId,
        ...input,
        payBasis: "monthly",
        standardWorkDaysPerMonth: 22,
        standardHoursPerDay: 8,
        region: "NCR",
        bankCode: "BDO",
        tinBranchCode: "0000",
      },
    });
    assert.match(String(payload.employee?.bankAccount ?? ""), /^••••.{4}$/, "Bank account must be masked in API output.");
    created.push({ id: Number(payload.employee.id), employeeNo: String(payload.employee.employeeNo) });
  }
  (report.lifecycle as string[]).push("employees-created-with-payout-details");

  // Hiring in this core-employer journey uses the existing authorized People
  // intake, NOT the separate governed recruitment/HCM Hire business process.
  // All later stages must use these exact authoritative worker IDs.
  const roster = await expectOk(owner, `/api/employees?organizationId=${organizationId}`);
  assert.ok(Array.isArray(roster), "The employee directory must return actual worker records.");
  for (const person of created) {
    assert.equal(
      roster.filter((row: any) => Number(row.id) === person.id && row.employeeNo === person.employeeNo).length,
      1,
      `Worker ${person.employeeNo} must exist once in the authoritative directory.`,
    );
  }
  report.hire = { source: "authorized People employee creation", mode: "core HRIS direct hire",
    employees: created.length, separateGovernedRecruitmentHire: "NOT_RUN" };

  // Exercise source-owned onboarding on the same workers before scheduling.
  // A checked box is a manual TEST attestation, never third-party ID/bank/HMO proof.
  const onboarding = await expectOk(owner, `/api/provisioning?organizationId=${organizationId}`);
  const targetWorker = onboarding.employees?.find((row: any) => Number(row.employeeId) === created[0].id);
  const otherWorker = onboarding.employees?.find((row: any) => Number(row.employeeId) === created[1].id);
  assert.ok(targetWorker && otherWorker, "Both hired workers must have an onboarding source.");
  assert.ok(targetWorker.onboarding?.length >= 5, "The initial HR/Finance/IT checklist must be created.");
  const task = targetWorker.onboarding.find((item: any) => item.title === "Email and software accounts provisioned");
  assert.ok(Number(task?.id) > 0 && task.done === false, "Expected an open, worker-bound onboarding task.");
  const wrongWorker = await owner.json("/api/provisioning", { method: "PATCH", json: {
    id: task.id, organizationId, employeeId: created[1].id, done: true,
  } });
  assert.equal(wrongWorker.response.status, 404, "Another employee cannot complete this worker's task.");
  const malformedTask = await owner.json("/api/provisioning", { method: "PATCH", json: {
    id: task.id, organizationId, employeeId: created[0].id, done: "true",
  } });
  assert.equal(malformedTask.response.status, 400, "An arbitrary truthy value cannot complete a task.");
  const manualTask = await expectOk(owner, "/api/provisioning", { method: "PATCH", json: {
    id: task.id, organizationId, employeeId: created[0].id, done: true,
  } });
  assert.equal(manualTask.done, true);
  const afterOnboarding = await expectOk(owner, `/api/provisioning?organizationId=${organizationId}`);
  assert.equal(afterOnboarding.employees
    .find((row: any) => Number(row.employeeId) === created[0].id)
    .onboarding.find((item: any) => item.id === task.id).done, true);
  assert.equal(afterOnboarding.employees
    .find((row: any) => Number(row.employeeId) === created[1].id)
    .onboarding.find((item: any) => item.title === task.title).done, false);
  report.onboarding = {
    source: "authenticated employee-scoped provisioning API",
    taskKind: "onboarding", workerBindingEnforced: true, typedWriteValidated: true,
    manualChecklistUpdatePersisted: true, independentExternalVerification: "NOT_RUN",
  };
  (report.lifecycle as string[]).push("onboarding-checklist-handoff-scoped-and-audited");

  // Exercise the same onboarding source used by Recruitment and Employee 360.
  // These are fictional checklist assertions, not witnessed employer reviews.
  const onboardingAll = await expectOk(owner, `/api/provisioning?organizationId=${organizationId}`);
  let completedOnboardingTasks = 0;
  for (const person of created) {
    const record = onboardingAll.employees.find((item: any) => Number(item.employeeId) === person.id);
    assert.ok(record?.onboarding?.length > 0, "Created worker needs source onboarding tasks.");
    for (const task of record.onboarding) {
      await expectOk(owner, "/api/provisioning", { method: "PATCH", json: {
        organizationId, employeeId: person.id, id: task.id, done: true,
      } });
      completedOnboardingTasks++;
    }
  }
  const completedOnboarding = await expectOk(owner, `/api/provisioning?organizationId=${organizationId}`);
  for (const person of created) {
    const record = completedOnboarding.employees.find((item: any) => Number(item.employeeId) === person.id);
    assert.ok(record.onboarding.every((task: any) => task.done === true));
  }
  report.onboardingEvidence = { workers: created.length, completedTasks: completedOnboardingTasks,
    witnessedOperatorReview: false };
  (report.lifecycle as string[]).push("same-worker-onboarding-completed-through-scoped-source-api");

  // The zero-leak synthetic CI suite tests a FINAL semi-monthly cutoff.
  // Therefore it needs an earlier RELEASED cutoff ledger for the same month
  // to exercise the statutory true-up path. This DB-only fixture is not a
  // real employer payment, approval, independent review or actual release.
  const [syntheticPriorCutoff] = await db.insert(payrollRuns).values({
    organizationId,
    periodLabel: "Synthetic prior cutoff (1-15 Sep 2026) — CI ONLY",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-15",
    payDate: "2026-09-20",
    status: "Released",
    employeeCount: created.length,
    grossPay: "39000.00",
    netPay: "39000.00",
    exceptions: 0,
    processedChunks: 1,
    totalChunks: 1,
  }).returning();
  await db.insert(payrollEntries).values(created.map((person, index) => ({
    payrollRunId: syntheticPriorCutoff.id,
    employeeId: person.id,
    grossPay: index === 0 ? "21000.00" : "18000.00",
    deductions: "0.00",
    netPay: index === 0 ? "21000.00" : "18000.00",
    status: "Ready",
    lineItems: [{ code: "BASIC", amount: index === 0 ? "21000.00" : "18000.00" }],
    trace: { inputs: [] },
  })));
  (report.lifecycle as string[]).push("synthetic-released-prior-cutoff-ledger-for-true-up");


  const stored = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  assert.equal(stored.length, 2);
  for (const row of stored) {
    assert.equal(isEncryptedBankAccount(row.bankAccount), true, `${row.employeeNo} payout account is not encrypted.`);
  }
  (report.lifecycle as string[]).push("bank-data-encryption-proven");

  const [payrollUser, checkerUser, employeeUser] = await db.insert(users).values([
    { email: "payroll.pilot@linaw.test", name: "Peter Payroll", passwordHash: hashPassword(credentials.payroll), role: "payroll", totpEnabled: false, backupCodes: [] },
    { email: "checker.pilot@linaw.test", name: "Casey Checker", passwordHash: hashPassword(credentials.checker), role: "checker", totpEnabled: false, backupCodes: [] },
    { email: "ella.employee@linaw.test", name: "Ella Employee", passwordHash: hashPassword(credentials.employee), role: "employee", employeeId: created[0].id, totpEnabled: false, backupCodes: [] },
  ]).returning();
  await db.insert(userOrganizations).values([
    { userId: payrollUser.id, organizationId, role: "payroll", orgUnitId: null },
    { userId: checkerUser.id, organizationId, role: "checker", orgUnitId: null },
    { userId: employeeUser.id, organizationId, role: "employee", orgUnitId: null },
  ]);
  report.roles = { owner: "Olivia Owner", payroll: payrollUser.name, checker: checkerUser.name, employee: employeeUser.name };
  (report.lifecycle as string[]).push("real-role-identities-created");

  // HTTP-level HCM/WFM app acceptance smoke, using this ephemeral CI tenant.
  // These are synthetic negative cases; human HR/bookkeeper review is still required.
  const invalidLeave = await owner.json("/api/leave", {
    method: "POST",
    json: {
      organizationId, employeeId: created[0].id, leaveType: "Vacation",
      startDate: "2026-02-30", endDate: "2026-02-30", days: 1,
    },
  });
  assert.equal(invalidLeave.response.status, 400, "Invalid Gregorian leave date must be rejected.");
  assert.equal(invalidLeave.payload.code, "LEAVE_DATE_INVALID");

  const beforeEmployment = await owner.json("/api/leave", {
    method: "POST",
    json: {
      organizationId, employeeId: created[0].id, leaveType: "Vacation",
      startDate: "2025-12-31", endDate: "2025-12-31", days: 1,
    },
  });
  assert.equal(beforeEmployment.response.status, 409, "Pre-hire leave must be rejected.");
  assert.equal(beforeEmployment.payload.code, "LEAVE_BEFORE_EMPLOYMENT");

  // An Active status alone cannot override an overlapping, reviewed exit.
  // Delete the synthetic exit in finally so the ordinary payroll pilot remains
  // a valid positive control even when a negative-case assertion fails.
  const [conflictingExit] = await db.insert(separationRecords).values({
    organizationId, employeeId: created[0].id, separationType: "resignation",
    noticeDate: "2026-09-01", lastDay: "2026-09-30",
    status: "approved",
  }).returning({ id: separationRecords.id });
  try {
    const conflictingLeave = await owner.json("/api/leave", {
      method: "POST",
      json: {
        organizationId, employeeId: created[0].id, leaveType: "Vacation",
        startDate: "2026-09-16", endDate: "2026-09-16", days: 1,
      },
    });
    assert.equal(conflictingLeave.response.status, 409, "An unresolved Active/separation conflict must block new leave.");
    assert.equal(conflictingLeave.payload.code, "LEAVE_EMPLOYMENT_STATE_CONFLICT");
    const conflictingPreview = await owner.json("/api/leave/preview", {
      method: "POST",
      json: {
        organizationId, employeeId: created[0].id,
        intervals: [{ workDate: "2026-09-16", kind: "full_day", timezone: "Asia/Manila" }],
      },
    });
    assert.equal(conflictingPreview.response.status, 409, "Leave preview must share the same employment gate.");
    assert.equal(conflictingPreview.payload.code, "LEAVE_EMPLOYMENT_STATE_CONFLICT");
  } finally {
    await db.delete(separationRecords).where(and(
      eq(separationRecords.id, conflictingExit.id),
      eq(separationRecords.organizationId, organizationId),
    ));
  }
  const strayLeaves = await db.select({ id: leaveRequests.id }).from(leaveRequests)
    .where(eq(leaveRequests.organizationId, organizationId));
  assert.equal(strayLeaves.length, 0, "Rejected leave cases must not create pending leave or payroll source evidence.");
  report.hcmLeaveHttpSafety = {
    invalidGregorianDate: "blocked-400",
    preHireLeave: "blocked-409",
    activeSeparationConflict: "blocked-409",
    conflictingLeavePreview: "blocked-409",
    unauthorizedLeaveWrites: 0,
    syntheticExitRemoved: true,
  };
  (report.lifecycle as string[]).push("hcm-leave-http-negative-cases-passed");

  const shiftPayload = await expectOk(owner, "/api/workforce/schedules", {
    method: "POST",
    json: {
      organizationId,
      action: "create_shift",
      code: "PILOT-DAY",
      name: "Pilot Day Shift",
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 60,
    },
  });
  const shiftDefinitionId = Number(shiftPayload.shift?.id);
  assert.ok(shiftDefinitionId > 0, "WFM shift definition was not created.");

  const patternPayload = await expectOk(owner, "/api/workforce/schedules", {
    method: "POST",
    json: {
      organizationId,
      action: "create_pattern",
      code: "PILOT-1D",
      name: "Pilot WFM Workday",
      cycleDays: 1,
      days: [{
        isRestDay: false,
        label: "Scheduled workday",
        segments: [{ shiftDefinitionId }],
      }],
    },
  });
  const patternId = Number(patternPayload.pattern?.id);
  assert.ok(patternId > 0, "WFM schedule pattern was not created.");

  const scheduleAssignmentIds: number[] = [];
  for (const person of created) {
    const assigned = await expectOk(owner, "/api/workforce/schedules", {
      method: "POST",
      json: {
        organizationId,
        action: "assign_schedule",
        employeeId: person.id,
        patternId,
        effectiveFrom: "2026-09-16",
        effectiveUntil: "2026-09-18",
        anchorDate: "2026-09-16",
        reason: "Production pilot WFM-to-payroll proof",
      },
    });
    const assignmentId = Number(assigned.assignment?.id);
    assert.ok(assignmentId > 0, `WFM schedule assignment missing for ${person.employeeNo}.`);
    scheduleAssignmentIds.push(assignmentId);
  }
  (report.lifecycle as string[]).push("advanced-wfm-schedules-assigned");

  const dates = ["2026-09-16", "2026-09-17", "2026-09-18"];
  const insertedPunches = await db.insert(timePunches).values(
    created.flatMap((person) => dates.map((workDate) => {
      const correctionTarget =
        person.id === created[0].id && workDate === "2026-09-17";
      return {
        organizationId,
        employeeId: person.id,
        workDate,
        timeIn: new Date(`${workDate}T01:00:00.000Z`),
        timeOut: new Date(
          `${workDate}T${correctionTarget ? "09:30" : "10:00"}:00.000Z`,
        ),
        breakStart: new Date(`${workDate}T04:00:00.000Z`),
        breakEnd: new Date(`${workDate}T05:00:00.000Z`),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
        source: "pilot-qa",
      };
    })),
  ).returning();
  (report.lifecycle as string[]).push("attendance-recorded");

  const correctionPunch = insertedPunches.find((punch) =>
    punch.employeeId === created[0].id
    && String(punch.workDate) === "2026-09-17"
  );
  assert.ok(correctionPunch?.id, "Pilot correction target punch was not created.");

  const beforeCorrection = await reconcileAttendanceExceptionEvents({
    organizationId,
    employeeId: created[0].id,
    workDate: "2026-09-17",
  });
  assert.ok(
    beforeCorrection.analysis.exceptions.some((item) => item.kind === "early_departure"),
    "WFM did not detect the deliberate early-departure exception.",
  );
  const exceptionRowsBefore = await db.select().from(attendanceExceptionEvents).where(and(
    eq(attendanceExceptionEvents.organizationId, organizationId),
    eq(attendanceExceptionEvents.employeeId, created[0].id),
    eq(attendanceExceptionEvents.workDate, "2026-09-17"),
  ));
  const earlyDepartureEvent = exceptionRowsBefore.find(
    (item) => item.exceptionKind === "early_departure" && item.status === "open",
  );
  assert.ok(
    earlyDepartureEvent?.id,
    "WFM attendance exception ledger did not persist the open early-departure exception.",
  );
  assert.ok(earlyDepartureEvent.slaDueAt, "WFM attendance exception did not receive an SLA deadline.");

  const ownedException = await expectOk(owner, "/api/workforce/attendance-exception-events", {
    method: "POST",
    json: {
      organizationId,
      eventId: earlyDepartureEvent.id,
      action: "assign_owner",
      ownerUserId: payrollUser.id,
    },
  });
  assert.equal(Number(ownedException.exception?.ownerUserId), payrollUser.id);
  assert.equal(ownedException.exception?.ownerName, payrollUser.name);
  assert.equal(ownedException.exception?.slaStatus, "on_track");
  assert.ok(Number(ownedException.exception?.ageHours) >= 0);
  (report.lifecycle as string[]).push("wfm-attendance-exception-owned-with-sla");

  const payroll = await login(payrollUser.email, credentials.payroll);
  const checker = await login(checkerUser.email, credentials.checker);
  const employee = await login(employeeUser.email, credentials.employee);

  // Actual employee Web Bundy IN/OUT requests cannot be backdated. Verify
  // today's source-owned clock API and self-identity binding independently;
  // the historical Sep payroll below uses explicitly seeded attendance.
  const currentBundy = await expectOk(employee, `/api/web-bundy?organizationId=${organizationId}`);
  assert.ok(!dates.includes(String(currentBundy.date)), "Current-day clock must not overlap the historical payroll fixture.");
  const clockIn = await expectOk(employee, "/api/web-bundy", { method: "POST", json: {
    organizationId, employeeId: created[1].id, actionType: "clock_in",
  } });
  assert.equal(clockIn.action, "clock_in");
  assert.equal(Number(clockIn.punch?.employeeId), created[0].id,
    "Employee-supplied employeeId must never let them clock for a coworker.");
  const duplicateClock = await employee.json("/api/web-bundy", { method: "POST", json: {
    organizationId, employeeId: created[0].id, actionType: "clock_in",
  } });
  assert.equal(duplicateClock.response.status, 409, "Double clock-in must be refused.");
  const clockOut = await expectOk(employee, "/api/web-bundy", { method: "POST", json: {
    organizationId, employeeId: created[1].id, actionType: "clock_out",
  } });
  assert.equal(clockOut.action, "clock_out");
  assert.equal(Number(clockOut.punch?.id), Number(clockIn.punch.id));
  assert.equal(Number(clockOut.punch?.employeeId), created[0].id);
  assert.equal(clockOut.punch?.status, "Complete");
  const ownClock = await expectOk(employee, `/api/web-bundy?organizationId=${organizationId}&employeeId=${created[1].id}`);
  assert.equal(ownClock.punches?.length, 1);
  assert.equal(Number(ownClock.punches[0].employeeId), created[0].id,
    "Employee read must ignore a forged coworker ID.");
  report.webBundy = {
    result: "passed", source: "employee Web Bundy GET/POST",
    selfIdentityBinding: true, duplicateInBlocked: true, inOutMatched: true,
    currentDayOnly: String(currentBundy.date),
    payrollPeriod: "2026-09-16 through 2026-09-30",
    historicalPayrollPunchesAreSeededFixtures: true,
    realDeviceGpsBiometrics: "NOT_RUN",
  };
  (report.lifecycle as string[]).push("employee-web-bundy-clock-in-out-scoped");

  const selfWorkforce = await expectOk(
    employee,
    "/api/self/workforce?startDate=2026-09-16&endDate=2026-09-18",
  );
  assert.equal(Number(selfWorkforce.employee?.id), created[0].id);
  assert.equal(selfWorkforce.employee?.employeeNo, created[0].employeeNo);
  assert.equal(selfWorkforce.schedule?.length, 3);
  assert.ok(
    selfWorkforce.schedule?.every((day: any) => day.patternId === patternId),
    "Employee self-service did not resolve only the employee's governed schedule.",
  );
  assert.equal(selfWorkforce.punches?.length, 3);
  assert.ok(
    selfWorkforce.punches?.some((punch: any) => Number(punch.id) === correctionPunch!.id),
    "Employee self-service did not return the employee's correction-target punch.",
  );
  (report.lifecycle as string[]).push("wfm-self-service-schedule-scoped");

  const correctionRequest = await expectOk(employee, "/api/self/workforce", {
    method: "POST",
    json: {
      action: "request_correction",
      punchId: correctionPunch!.id,
      proposedTimeOut: "2026-09-17T18:00:00+08:00",
      reason: "Employee-submitted production pilot correction before payroll",
    },
  });
  (report.lifecycle as string[]).push("wfm-self-service-correction-requested");
  const correctionRequestId = Number(correctionRequest.correction?.id);
  assert.ok(correctionRequestId > 0, "Attendance correction request was not created.");

  const correctionDecision = await expectOk(owner, "/api/workforce/attendance-corrections", {
    method: "POST",
    json: {
      organizationId,
      action: "decide_request",
      requestId: correctionRequestId,
      decision: "approved",
      decisionNote: "Independent WFM correction approval for pilot payroll",
    },
  });
  assert.equal(correctionDecision.punch?.status, "Corrected");
  assert.deepEqual(correctionDecision.invalidatedPayrollRunIds ?? [], []);
  assert.equal(correctionDecision.attendanceExceptionSync?.status, "ok");

  const exceptionRowsAfter = await db.select().from(attendanceExceptionEvents).where(and(
    eq(attendanceExceptionEvents.organizationId, organizationId),
    eq(attendanceExceptionEvents.employeeId, created[0].id),
    eq(attendanceExceptionEvents.workDate, "2026-09-17"),
  ));
  const resolvedEarlyDeparture = exceptionRowsAfter.find(
    (item) => item.exceptionKind === "early_departure" && item.status === "resolved",
  );
  assert.ok(
    resolvedEarlyDeparture,
    "Approved attendance correction did not resolve the WFM exception ledger.",
  );
  assert.equal(resolvedEarlyDeparture.ownerUserId, payrollUser.id);
  assert.equal(resolvedEarlyDeparture.ownerName, payrollUser.name);
  assert.ok(resolvedEarlyDeparture.slaDueAt, "Resolved WFM exception lost its SLA evidence.");
  assert.match(
    String(resolvedEarlyDeparture.resolutionNote ?? ""),
    /Attendance correction #[0-9]+ approved/i,
    "Resolved WFM exception did not retain governed correction evidence.",
  );
  assert.equal(resolvedEarlyDeparture.resolvedByName, "Olivia Owner");
  assert.ok(resolvedEarlyDeparture.resolutionRecordedAt, "Resolved WFM exception lacks resolution timestamp evidence.");
  (report.lifecycle as string[]).push("wfm-attendance-correction-approved-four-eyes");
  (report.lifecycle as string[]).push("wfm-attendance-exception-resolution-evidence-recorded");

  await expectOk(owner, "/api/workforce/timesheets", { method: "POST", json: {
    organizationId, action: "update_policy", active: true, enforcementMode: "block",
  } });
  const blockedRun = await payroll.json("/api/payroll-runs", { method: "POST", json: {
    organizationId, periodStart: "2026-09-16", periodEnd: "2026-09-30", payDate: "2026-10-05", processNow: true,
  } });
  assert.equal(blockedRun.response.status, 422);
  assert.equal(blockedRun.payload.code, "PAYROLL_PRE_RUN_READINESS_BLOCKED");
  assert.ok((blockedRun.payload.readiness?.findings ?? []).some(
    (finding: { code: string }) => ["PRERUN_ATTENDANCE_MISSING", "PRERUN_ATTENDANCE_UNREVIEWED"].includes(finding.code),
  ), "The pre-calculation gate must identify missing employee attendance approval.");
  const [secondEmployeeUser] = await db.insert(users).values({
    email: "second.employee.pilot@linaw.test", name: "Synthetic second employee",
    passwordHash: hashPassword(credentials.employee), role: "employee",
    employeeId: created[1].id, totpEnabled: false, backupCodes: [],
  }).returning();
  await db.insert(userOrganizations).values({ userId: secondEmployeeUser.id, organizationId, role: "employee" });
  const secondEmployee = await login(secondEmployeeUser.email, credentials.employee);
  const approvedTimesheetIds: number[] = [];
  for (const [index, client] of [employee, secondEmployee].entries()) {
    const submitted = await expectOk(client, "/api/workforce/timesheets", { method: "POST", json: {
      organizationId, action: "submit", employeeId: created[index].id,
      periodStart: "2026-09-16", periodEnd: "2026-09-30",
    } });
    const approved = await expectOk(owner, "/api/workforce/timesheets", { method: "POST", json: {
      organizationId, action: "decide", timesheetId: submitted.timesheet.id,
      decision: "approved", decisionNote: "Synthetic CI review of corrected attendance; no employer attestation.",
    } });
    assert.equal(approved.timesheet.status, "approved");
    assert.notEqual(approved.timesheet.submittedByUserId, approved.timesheet.decidedByUserId);
    approvedTimesheetIds.push(Number(approved.timesheet.id));
  }
  (report.lifecycle as string[]).push("timesheet-gate-blocked-payroll-until-distinct-test-actor-approval");

  // Change time evidence after approval through the employee and manager APIs.
  // Move a fictional break without changing its duration or expected wages.
  const latePunch = insertedPunches.find((punch) => punch.employeeId === created[0].id && String(punch.workDate) === "2026-09-18");
  assert.ok(latePunch?.id);
  const lateRequest = await expectOk(employee, "/api/self/workforce", { method: "POST", json: {
    action: "request_correction", punchId: latePunch.id,
    proposedBreakStart: "2026-09-18T12:05:00+08:00", proposedBreakEnd: "2026-09-18T13:05:00+08:00",
    reason: "Synthetic post-approval break-evidence correction; unchanged break duration",
  } });
  const lateDecision = await expectOk(owner, "/api/workforce/attendance-corrections", { method: "POST", json: {
    organizationId, action: "decide_request", requestId: lateRequest.correction.id,
    decision: "approved", decisionNote: "Distinct synthetic actor verifies updated evidence; no employer attestation",
  } });
  assert.ok(lateDecision.staleTimesheetIds.includes(approvedTimesheetIds[0]), "Approved time evidence must become stale after correction.");
  const [staleTimesheet] = await db.select().from(workforceTimesheets).where(eq(workforceTimesheets.id, approvedTimesheetIds[0]));
  const [unaffectedTimesheet] = await db.select().from(workforceTimesheets).where(eq(workforceTimesheets.id, approvedTimesheetIds[1]));
  assert.equal(staleTimesheet.status, "stale");
  assert.equal(unaffectedTimesheet.status, "approved", "Another worker's approval must remain intact.");
  const staleRun = await payroll.json("/api/payroll-runs", { method: "POST", json: {
    organizationId, periodStart: "2026-09-16", periodEnd: "2026-09-30", payDate: "2026-10-05", processNow: true,
  } });
  assert.equal(staleRun.response.status, 422);
  assert.equal(staleRun.payload.code, "PAYROLL_PRE_RUN_READINESS_BLOCKED");
  assert.ok((staleRun.payload.readiness?.findings ?? []).some(
    (finding: { code: string; employeeId?: number }) =>
      finding.code === "PRERUN_ATTENDANCE_STALE" && finding.employeeId === created[0].id,
  ), "The pre-calculation gate must block the worker's stale approved-timesheet version.");
  const staleApproval = await owner.json("/api/workforce/timesheets", { method: "POST", json: {
    organizationId, action: "decide", timesheetId: staleTimesheet.id, decision: "approved",
  } });
  assert.equal(staleApproval.response.status, 409, "An old stale version cannot be reapproved.");
  const resubmitted = await expectOk(employee, "/api/workforce/timesheets", { method: "POST", json: {
    organizationId, action: "submit", employeeId: created[0].id, periodStart: "2026-09-16", periodEnd: "2026-09-30",
  } });
  assert.equal(resubmitted.timesheet.version, staleTimesheet.version + 1);
  assert.notEqual(resubmitted.timesheet.snapshotHash, staleTimesheet.snapshotHash);
  const reapproved = await expectOk(owner, "/api/workforce/timesheets", { method: "POST", json: {
    organizationId, action: "decide", timesheetId: resubmitted.timesheet.id, decision: "approved",
    decisionNote: "Synthetic independent reapproval after corrected break evidence",
  } });
  assert.equal(reapproved.timesheet.status, "approved");
  assert.notEqual(reapproved.timesheet.submittedByUserId, reapproved.timesheet.decidedByUserId);
  report.postApprovalCorrection = { result: "passed", staleApprovalBlocked: true, payrollBlockedUntilReapproval: true,
    priorTimesheetId: staleTimesheet.id, replacementTimesheetId: reapproved.timesheet.id,
    version: reapproved.timesheet.version, unaffectedWorkerApprovalPreserved: true, distinctTestActors: true };
  (report.lifecycle as string[]).push("post-approval-correction-stales-timesheet-and-requires-new-version-approval");

  const runPayload = await expectOk(payroll, "/api/payroll-runs", {
    method: "POST",
    json: { organizationId, periodStart: "2026-09-16", periodEnd: "2026-09-30", payDate: "2026-10-05", processNow: true },
  });
  const runId = Number(runPayload.run?.id);
  assert.ok(runId > 0);
  assert.ok(["Needs review", "Processed"].includes(String(runPayload.run?.status)));
  assert.equal(Number(runPayload.run?.exceptions), 0, "Pilot calculation must have zero engine exceptions.");
  assert.equal(runPayload.timesheetGate?.gate?.allowed ?? runPayload.timesheetGate?.allowed, true);
  report.runId = runId;
  (report.lifecycle as string[]).push("payroll-calculated");

  const register = await expectOk(payroll, `/api/payroll-runs?runId=${runId}&include=entries`);
  assert.equal(register.entries?.length, 2);
  assert.ok(register.entries.every((entry: any) => Number(entry.netPay) > 0));
  const employeeEntry = register.entries.find((entry: any) => Number(entry.employeeId) === created[0].id);
  assert.ok(employeeEntry?.id, "Pilot employee payroll entry is missing from the calculated register.");

  for (const entry of register.entries ?? []) {
    const trace = entry.trace as Record<string, any> | null;
    assert.equal(
      trace?.workforceSchedule?.mode,
      "advanced-with-legacy-fallback",
      `Payroll entry ${entry.id} did not retain advanced WFM schedule evidence.`,
    );
    const scheduleDays = Array.isArray(trace?.workforceSchedule?.days)
      ? trace.workforceSchedule.days
      : [];
    for (const workDate of dates) {
      const day = scheduleDays.find((item: any) => item.date === workDate);
      assert.ok(day, `Payroll entry ${entry.id} is missing WFM schedule trace for ${workDate}.`);
      assert.equal(day.source, "pattern");
      assert.equal(day.patternId, patternId);
      assert.ok(scheduleAssignmentIds.includes(Number(day.assignmentId)));
      assert.equal(day.segments?.[0]?.shiftCode, "PILOT-DAY");
    }
    assert.equal(
      trace?.payableTime?.mode,
      "calendar-segmented",
      `Payroll entry ${entry.id} did not use calendar-segmented WFM payable time.`,
    );
  }
  report.wfmEvidence = {
    shiftDefinitionId,
    patternId,
    scheduleAssignmentIds,
    correctedPunchId: correctionPunch!.id,
    correctionRequestId,
    exceptionKind: "early_departure",
    exceptionResolved: true,
    exceptionOwnerUserId: payrollUser.id,
    exceptionSlaDueAt: resolvedEarlyDeparture.slaDueAt,
    exceptionResolutionRecordedAt: resolvedEarlyDeparture.resolutionRecordedAt,
    payrollTraceMode: "advanced-with-legacy-fallback",
    payableTimeMode: "calendar-segmented",
  };
  (report.lifecycle as string[]).push("wfm-schedule-evidence-reconciled-into-payroll");

  const before = await expectOk(payroll, `/api/payroll-runs/${runId}/release-checklist`);
  const blockers = (before.items ?? []).filter((item: any) => item.blocking && !item.passed);
  assert.deepEqual(blockers.map((item: any) => item.key), ["approval"], `Unexpected pre-approval blockers: ${JSON.stringify(blockers)}`);
  (report.lifecycle as string[]).push("release-checklist-clean-before-approval");

  const approvers = await expectOk(payroll, `/api/organizations/${organizationId}/payroll-approvers`);
  assert.ok((approvers.approvers ?? []).some((item: any) => item.id === checkerUser.id), "Checker is absent from approver discovery.");

  const submission = await expectOk(payroll, `/api/payroll-runs/${runId}/submit-review`, {
    method: "POST",
    json: { approverUserId: checkerUser.id },
  });
  assert.ok(submission.task?.id);
  (report.lifecycle as string[]).push("payroll-submitted-by-payroll-officer");

  await expectOk(checker, `/api/approvals/${submission.task.id}`, { method: "PATCH", json: { status: "Approved" } });
  (report.lifecycle as string[]).push("payroll-approved-by-independent-checker");

  const approved = await expectOk(owner, `/api/payroll-runs/${runId}/release-checklist`);
  assert.equal(approved.ready, true, `Approved payroll is not release-ready: ${JSON.stringify(approved.items)}`);

  const release = await expectOk(owner, `/api/payroll-runs/${runId}/release`, { method: "POST", json: { acknowledgeExceptions: false } });
  assert.equal(Number(release.receipt?.employeeCount), 2);
  assert.ok(Number(release.receipt?.totalNetPay) > 0);
  assert.equal(release.receipt?.bankExport?.status, "waiting");
  assert.ok(Number(release.receipt?.payslips?.available) >= 2);
  (report.lifecycle as string[]).push("owner-released-payroll");

  const preflight = await owner.request(`/api/payroll-runs/${runId}/exports`, {
    method: "POST",
    json: { mode: "preflight" },
  });
  const preflightBody = await preflight.text();
  assert.equal(
    preflight.status,
    501,
    `Fresh CI pilot has no external PayMongo credentials, so no-money preflight must fail closed: ${preflightBody}`,
  );
  assert.match(preflightBody,
    selectedPayoutProvider === "xendit" ? /Xendit/i : /PAYMONGO_SECRET_KEY|PayMongo/i);
  (report.lifecycle as string[]).push(
    selectedPayoutProvider === "xendit"
      ? "xendit-default-blocks-legacy-paymongo-preflight"
      : "paymongo-preflight-fails-closed-without-provider-credentials",
  );

  const payout = await owner.request(`/api/payroll-runs/${runId}/exports`, {
    method: "POST",
    json: { mode: "disburse", confirm: true },
  });
  const payoutBody = await payout.text();
  assert.equal(
    payout.status,
    501,
    `Live PayMongo payout must stay blocked until provider credentials, wallet and webhook are configured: ${payoutBody}`,
  );
  assert.match(payoutBody, /not fully configured/i);
  (report.lifecycle as string[]).push(
    selectedPayoutProvider === "xendit"
      ? "xendit-default-prevents-legacy-paymongo-submission"
      : "live-paymongo-payout-blocked-until-provider-config",
  );

  const self = await expectOk(employee, "/api/self/payslips");
  const slip = (self.payslips ?? []).find((row: any) => Number(row.entryId) === Number(employeeEntry.id));
  assert.ok(slip, "Released payroll entry is missing from employee self-service.");
  const pdf = await employee.request(`/api/self/payslips/${slip.entryId}`);
  assert.ok(pdf.ok);
  assert.match(pdf.headers.get("content-type") ?? "", /application\/pdf/);
  assert.ok((await pdf.arrayBuffer()).byteLength > 500);
  (report.lifecycle as string[]).push("employee-payslip-available");

  const [finalRun] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.organizationId, organizationId))).limit(1);
  assert.equal(finalRun?.status, "Released");

  // Prepare all FOUR current monthly government reconciliation worksheets from
  // this exact released payroll. Verify the HTTP file bytes against the stored
  // immutable hash; never create an invented agency acceptance or submit data.
  const filingForms = [
    { agency: "SSS", form: "R-3" },
    { agency: "BIR", form: "1601-C" },
    { agency: "PhilHealth", form: "RF-1" },
    { agency: "Pag-IBIG", form: "MCRF" },
  ] as const;
  const preparedFilingRecords: Array<{ agency: string; form: string; recordId: number }> = [];
  for (const definition of filingForms) {
    const input = { organizationId, runId, ...definition };
    const generated = await expectOk(owner, "/api/compliance/filing-validations", {
      method: "POST", json: input,
    });
    assert.equal(generated.created, true, `${definition.agency} worksheet must be newly generated.`);
    assert.equal(generated.record?.status, "generated");
    assert.equal(Number(generated.record?.payrollRunId), runId);
    assert.equal(Number(generated.record?.organizationId), organizationId);
    assert.equal(generated.record?.applicableMonth, definition.agency === "BIR" ? "2026-10" : "2026-09",
      "Filing metadata must match its source month, including next-month pay dates");
    assert.match(String(generated.record?.fileSha256), /^[a-f0-9]{64}$/);

    const recordId = Number(generated.record.id);
    const download = await owner.request(
      `/api/compliance/filing-validations/${recordId}/file?organizationId=${organizationId}`,
    );
    assert.equal(download.status, 200, `${definition.agency} worksheet download failed.`);
    const employeeDenied = await employee.request(
      `/api/compliance/filing-validations/${recordId}/file?organizationId=${organizationId}`,
    );
    assert.equal(employeeDenied.status, 403, "Employee cannot download company filing evidence.");
    assert.match(download.headers.get("content-type") ?? "", /text\/csv/);
    const worksheet = await download.text();
    assert.match(worksheet, /DRAFT ONLY, not a certified government submission file/);
    const digest = createHash("sha256").update(worksheet, "utf8").digest("hex");
    assert.equal(digest, generated.record.fileSha256, "Downloaded bytes must match the recorded SHA-256.");
    assert.equal(download.headers.get("x-filing-sha256"), digest);

    const duplicate = await expectOk(owner, "/api/compliance/filing-validations", {
      method: "POST", json: input,
    });
    assert.equal(duplicate.created, false, "Identical filing bytes must not create duplicate evidence.");
    assert.equal(Number(duplicate.record?.id), recordId);
    preparedFilingRecords.push({ ...definition, recordId });
  }
  const forgedAcceptance = await owner.json(
    `/api/compliance/filing-validations/${preparedFilingRecords[0].recordId}`,
    { method: "PATCH", json: {
      organizationId, outcome: "accepted", submissionMethod: "manual_entry",
      agencyReference: "", submittedAt: "2026-10-05",
    } },
  );
  assert.ok(!forgedAcceptance.response.ok,
    "A fictional filing without an agency acknowledgement must never be accepted.");
  const filingRead = await expectOk(owner, `/api/compliance/filing-validations?organizationId=${organizationId}`);
  for (const prepared of preparedFilingRecords) {
    const record = filingRead.records.find((row: any) => Number(row.id) === prepared.recordId);
    assert.equal(record?.status, "generated", "CI-generated worksheet is not an agency receipt.");
    assert.equal(record?.agencyReference ?? null, null, "Do not invent a government reference in CI.");
  }
  report.filingEvidence = {
    result: "passed", scope: "reconciliation worksheet generation and byte-hash binding only",
    forms: preparedFilingRecords.map(({ agency, form }) => `${agency} ${form}`),
    generatedCount: preparedFilingRecords.length, duplicateGenerationBlocked: true,
    unreferencedAgencyAcceptanceRejected: true, officialAgencyAcceptance: "NOT_RUN",
    officialImportFormatsCertified: false, governmentSubmissionPerformed: false,
  };
  (report.lifecycle as string[]).push("government-reconciliation-worksheets-prepared-hash-verified-not-submitted");

  const afterReleaseRequest = await expectOk(employee, "/api/self/workforce", { method: "POST", json: {
    action: "request_correction", punchId: latePunch.id,
    proposedBreakStart: "2026-09-18T12:10:00+08:00", proposedBreakEnd: "2026-09-18T13:10:00+08:00",
    reason: "Synthetic immutable-payroll negative case; must use a later adjustment",
  } });
  const afterReleaseDecision = await owner.json("/api/workforce/attendance-corrections", { method: "POST", json: {
    organizationId, action: "decide_request", requestId: afterReleaseRequest.correction.id,
    decision: "approved", decisionNote: "Synthetic denial proof; no historical payroll rewrite permitted",
  } });
  assert.equal(afterReleaseDecision.response.status, 409);
  assert.match(afterReleaseDecision.payload.error, /immutable payroll run/i);
  const [unchangedPunch] = await db.select().from(timePunches).where(eq(timePunches.id, latePunch.id));
  assert.equal(unchangedPunch.breakStart?.toISOString(), "2026-09-18T04:05:00.000Z");
  const [unchangedApproval] = await db.select().from(workforceTimesheets).where(eq(workforceTimesheets.id, reapproved.timesheet.id));
  assert.equal(unchangedApproval.status, "approved");
  report.immutableAttendance = { result: "passed", correctionDeniedAfterRelease: true, punchAndApprovalUnchanged: true };
  (report.lifecycle as string[]).push("released-payroll-blocks-historical-attendance-rewrite");

  if (process.env.SYNTHETIC_SEPARATION_QA === "true") {
    await verifySyntheticSeparation(owner, payroll, organizationId);
    (report.lifecycle as string[]).push("synthetic-separation-cap-and-stale-approval-verified-no-release");
  }

  const events = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, organizationId));
  const actions = new Set(events.map((event) => event.action));
  const expectedActions = [
    "Workforce shift definition created",
    "Workforce schedule pattern created",
    "Employee workforce schedule assigned",
    "Employee self-service attendance correction requested",
    "Attendance correction approved and applied",
    "Payroll submitted for review",
    "Approval approved",
    "Payroll released",
    ...(selectedPayoutProvider === "paymongo" ? ["PayMongo payroll preflight failed"] : []),
    "Provisioning item completed",
    "Web Bundy Clock IN",
    "Web Bundy Clock OUT",
    "SSS R-3 filing record created",
    "BIR 1601-C filing record created",
    "PhilHealth RF-1 filing record created",
    "Pag-IBIG MCRF filing record created",
  ];
  for (const action of expectedActions) assert.ok(actions.has(action), `Missing audit event: ${action}`);
  report.auditEventsVerified = expectedActions;

  const readinessResponse = await fetch(`${base}/api/readiness`, { headers: { "x-readiness-token": readinessToken } });
  assert.ok(readinessResponse.ok);
  const readiness = await readinessResponse.json();
  report.externalReadinessBlockers = (readiness.gates ?? [])
    .filter((gate: any) => gate.blocks === "launch" && !gate.ready)
    .map((gate: any) => ({ key: gate.key, label: gate.label, manualWorkaround: gate.manualWorkaround ?? null }));
  report.readiness = {
    status: readiness.status,
    launchBlockersRemaining: readiness.launchBlockersRemaining,
    manualLaunchReady: readiness.manualLaunch?.ready ?? false,
  };
  const journeySteps = [
    { step: "Hire", evidence: "employees-created-with-payout-details", caveat: "Core People direct hire; governed candidate Hire BP not exercised" },
    { step: "Onboard", evidence: "onboarding-checklist-handoff-scoped-and-audited", caveat: "Synthetic manual task; third-party verification not implied" },
    { step: "Schedule", evidence: "advanced-wfm-schedules-assigned" },
    { step: "Clock In", evidence: "employee-web-bundy-clock-in-out-scoped", caveat: "Real current-day Web Bundy test; payroll-period time punches are separate fictional historical fixtures" },
    { step: "Approve Time", evidence: "timesheet-gate-blocked-payroll-until-distinct-test-actor-approval" },
    { step: "Run Payroll", evidence: "payroll-calculated" },
    { step: "Review", evidence: "payroll-approved-by-independent-checker" },
    { step: "Release Payroll Records", evidence: "owner-released-payroll", caveat: "Synthetic payroll ledger only; no payment instructions" },
    { step: "Prepare Filing Evidence", evidence: "government-reconciliation-worksheets-prepared-hash-verified-not-submitted", caveat: "Draft worksheets only; no agency acceptance" },
  ];
  for (const step of journeySteps) {
    assert.ok((report.lifecycle as string[]).includes(step.evidence), `Missing journey step: ${step.step}`);
  }
  report.employerJourney = {
    result: "passed-synthetic-only",
    stages: journeySteps.map(({ evidence, ...step }) => ({ ...step, result: "passed", evidence })),
    independentHumanUat: "NOT_RUN", realEmployerShadowPayroll: "NOT_RUN",
    fieldDeviceCertification: "NOT_RUN", governmentPortalAcceptance: "NOT_RUN",
    realBankOrProviderSubmission: "NOT_RUN", productionActivation: "NOT_AUTHORIZED",
  };
  report.result = "passed";
  writeFileSync("qa-artifacts/pilot-payroll-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    report.result = "failed";
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    mkdirSync("qa-artifacts", { recursive: true });
    writeFileSync("qa-artifacts/pilot-payroll-report.json", JSON.stringify(report, null, 2));
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
