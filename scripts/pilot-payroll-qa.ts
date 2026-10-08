import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { attendanceExceptionEvents, auditEvents, employees, payrollRuns, timePunches, userOrganizations, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/crypto";
import { isEncryptedBankAccount } from "../src/lib/bank-account-crypto";
import { reconcileAttendanceExceptionEvents } from "../src/lib/workforce-attendance-exception-events";

const base = process.env.QA_URL ?? "http://127.0.0.1:3000";
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

async function main() {
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

  const runPayload = await expectOk(payroll, "/api/payroll-runs", {
    method: "POST",
    json: { organizationId, periodStart: "2026-09-16", periodEnd: "2026-09-30", payDate: "2026-10-05", processNow: true },
  });
  const runId = Number(runPayload.run?.id);
  assert.ok(runId > 0);
  assert.ok(["Needs review", "Processed"].includes(String(runPayload.run?.status)));
  assert.equal(Number(runPayload.run?.exceptions), 0, "Pilot calculation must have zero engine exceptions.");
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
  assert.match(preflightBody, /PAYMONGO_SECRET_KEY|PayMongo/i);
  (report.lifecycle as string[]).push("paymongo-preflight-fails-closed-without-provider-credentials");

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
  (report.lifecycle as string[]).push("live-paymongo-payout-blocked-until-provider-config");

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
    "PayMongo payroll preflight failed",
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
