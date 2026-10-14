/**
 * #853: one source-connected fictional first payroll, never a payment or UAT.
 * This deliberately does NOT reuse the September seeded punches from pilot-payroll-qa.
 * The source punch must be created by Web Bundy in the very period released here.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { hashPassword } from "../../src/lib/crypto";
import {
  auditEvents, employees, governmentFilingValidations, orgUnits, organizations, payrollEntries,
  payrollRuns, timePunches, userOrganizations, users, workforceTimesheets,
} from "../../src/db/schema";

const BASE = "http://127.0.0.1:3000";
const PATH = "qa-artifacts/nine-stage-connected-report.json";
const names = [
  "Hire", "Onboard", "Schedule", "Clock In", "Approve Time", "Run Payroll",
  "Review", "Release Payroll Records", "Prepare Filing Evidence",
];
type Stage = { name: string; status: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN"; evidence: string[]; reason?: string };
const stages: Stage[] = names.map(name => ({ name, status: "NOT_RUN", evidence: [] }));
const report = {
  schemaVersion: 1, sourceSha: process.env.PR_HEAD_SHA ?? "local",
  virtualGeneratedAt: new Date().toISOString(), githubRunId: process.env.GITHUB_RUN_ID ?? "local", result: "BLOCKED",
  scope: "synthetic-local-postgres16-only", independentHumanUat: "NOT_RUN",
  clock: { mode: "CI_GUARDED_VIRTUAL_MANILA_MONTH_END", manilaWorkDate: process.env.NINE_STAGE_SYNTHETIC_CLOCK ?? "NOT_CONFIGURED",
    realWallClockAttendance: false, actualApiCapture: true },
  bankOrPaymentSubmission: "PROHIBITED", officialAgencySubmission: "NOT_RUN",
  physicalDeviceUat: "NOT_RUN", realEmployerReconciliation: "NOT_RUN",
  stages, negativeControls: [] as string[],
  lineage: {} as Record<string, unknown>,
};
const password = "FictionalOnly!" + randomUUID().replaceAll("-", "").slice(0, 20);
const dateInManila = (now: Date) => new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Manila",
}).format(now);
function localMinutes(d: Date) {
  const p = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Manila",
  }).format(d);
  const [hh, mm] = p.split(":").map(Number);
  return hh * 60 + mm;
}
function hhmm(d: Date) {
  const m = localMinutes(d);
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}
function requireSafeTarget() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.QA_URL, BASE);
  assert.equal(process.env.DEMO_MODE, "false");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  assert.equal(process.env.PAYMONGO_SECRET_KEY ?? "", "");
  assert.equal(process.env.XENDIT_SECRET_KEY ?? "", "");
  for (const flag of [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "XENDIT_PAYOUTS_LIVE_APPROVED",
    "WFM_GEOFENCE_PILOT_ENABLED", "WFM_PUNCH_EVIDENCE_ENABLED",
    "FINAL_PAY_MANUAL_RELEASE_ENABLED",
  ]) assert.notEqual(process.env[flag], "true", flag + " must be disabled");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.username, "postgres");
}
class Client {
  cookie = "";
  async request(path: string, method = "GET", data?: unknown) {
    const headers = new Headers();
    if (this.cookie) headers.set("cookie", this.cookie);
    if (method !== "GET") {
      headers.set("origin", BASE);
      headers.set("content-type", "application/json");
    }
    // The production setup route requires its bootstrap token; use only the
    // disposable CI token and never weaken the application authorization.
    if (path === "/api/setup" && method === "POST") {
      assert.ok(process.env.SETUP_TOKEN, "Missing isolated setup token");
      headers.set("x-setup-token", process.env.SETUP_TOKEN);
    }
    const response = await fetch(BASE + path, {
      method, headers, body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(30000),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return response;
  }
  async json(path: string, method = "GET", data?: unknown) {
    const response = await this.request(path, method, data);
    const body = await response.json().catch(() => ({})) as Record<string, any>;
    return { status: response.status, ok: response.ok, body };
  }
  async ok(path: string, method = "GET", data?: unknown) {
    const response = await this.json(path, method, data);
    assert.ok(response.ok, method + " " + path.split("?")[0] + ": HTTP " + response.status
      + " code=" + String(response.body.code ?? "unknown"));
    return response.body;
  }
}
async function login(email: string) {
  assert.equal(email, email.toLowerCase(), "Synthetic account email must match login normalization");
  const c = new Client();
  await c.ok("/api/auth/login", "POST", { email, password });
  assert.ok(c.cookie, "Missing synthetic login session");
  return c;
}
async function stage(index: number, action: (evidence: string[]) => Promise<void>) {
  const s = stages[index];
  try {
    await action(s.evidence);
    s.status = "PASS";
  } catch (error) {
    s.status = "FAIL";
    s.reason = error instanceof Error ? error.message.slice(0, 260) : "Unclassified test failure";
    throw error;
  }
}
function save() {
  report.result = stages.every(s => s.status === "PASS") ? "PASS"
    : stages.some(s => s.status === "FAIL") ? "FAIL" : "PARTIAL";
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(PATH, JSON.stringify(report, null, 2) + "\n");
}
function denied(code: number, actual: number, label: string) {
  assert.equal(actual, code, label + " must fail closed at HTTP " + code);
  report.negativeControls.push(label);
}
async function main() {
  requireSafeTarget();
  // Browser handoff is never uploaded; create the temporary fixture folder
  // before the first real authenticated step and remove its credential file in CI.
  mkdirSync("qa-artifacts", { recursive: true });
  assert.equal((await db.select({ id: organizations.id }).from(organizations)).length, 0,
    "Never run connected fixture against a populated database");
  const now = new Date();
  const workDate = dateInManila(now);
  assert.match(process.env.NINE_STAGE_SYNTHETIC_CLOCK ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(workDate, process.env.NINE_STAGE_SYNTHETIC_CLOCK,
    "Connected filing tests require the authorized virtual final cutoff, not a manufactured mid-month BIR worksheet");
  // One real browser clock IN and OUT with a reviewer-corrected synthetic shift.
  // No application clock overrides, future punches, or historical inserts.
  assert.ok(localMinutes(now) >= 75, "BLOCKED: run after 01:15 Manila time for same-day clock correction");
  const shiftStart = new Date(now.getTime() - 66 * 60000);
  const shiftEnd = new Date(now.getTime() - 6 * 60000);
  // Schedule definitions are HH:mm. Precise correction timestamps must have
  // identical minute boundaries or seconds can fabricate unauthorized OT.
  shiftStart.setUTCSeconds(0, 0);
  shiftEnd.setUTCSeconds(0, 0);
  assert.equal(dateInManila(shiftStart), workDate);
  const periodStart = workDate;
  const periodEnd = workDate;
  const payDate = dateInManila(new Date(now.getTime() + 86400000));
  let orgA = 0, orgB = 0, worker = 0, runId = 0, punchId = 0;
  let owner!: Client, hr!: Client, manager!: Client, employee!: Client;
  let payroll!: Client, checker!: Client, tenantB!: Client;
  let employeeNo = "NINE-001";
  let patternId = 0, assignmentId = 0, currentTimesheetId = 0;
  await stage(0, async evidence => {
    const init = new Client();
    const setup = await init.ok("/api/setup", "POST", {
      companyName: "Fictional Connected Employer A",
      legalName: "Fictional Connected Employer A Inc.",
      name: "Fictional Owner A", email: "owner.nine@linaw.test", password,
    });
    orgA = Number(setup.organizationId);
    assert.ok(orgA > 0);
    owner = await login("owner.nine@linaw.test");
    const created = await owner.ok("/api/employees", "POST", {
      organizationId: orgA, employeeNo,
      firstName: "Fictional", lastName: "Worker",
      title: "Synthetic Attendance Worker", email: "worker.nine@linaw.test",
      payBasis: "monthly", rateAmount: 28000,
      standardWorkDaysPerMonth: 22, standardHoursPerDay: 8,
      region: "NCR", startDate: workDate, bankAccount: "QA-ACCOUNT-NOT-REAL-01",
      bankCode: "BDO", mobile: "QA-ONLY-0001",
      tin: "QA-TIN-1001", sssNo: "QA-SSS-1001",
      philHealthNo: "QA-PHIC-1001", pagIbigNo: "QA-HDMF-1001", tinBranchCode: "0000",
    });
    worker = Number(created.employee?.id);
    assert.ok(worker > 0);
    const [hiredWorker] = await db.select({ startDate: employees.startDate })
      .from(employees).where(eq(employees.id, worker));
    assert.equal(String(hiredWorker.startDate), workDate,
      "First-payroll test must not invent a prior statutory cutoff for an existing worker");
    const [unit] = await db.insert(orgUnits).values({
      organizationId: orgA, type: "department", code: "NINE-QA",
      name: "Fictional Schedule Team",
    }).returning();
    await db.update(employees).set({ orgUnitId: unit.id }).where(eq(employees.id, worker));
    const [other] = await db.insert(organizations).values({
      name: "Fictional Connected Employer B", legalName: "Fictional Connected Employer B Inc.",
    }).returning();
    orgB = other.id;
    await db.insert(employees).values({
      organizationId: orgB, employeeNo,
      firstName: "Fictional", lastName: "Tenant B",
      title: "Isolation Only", avatarInitials: "FB", basicRate: "28000",
      startDate: workDate,
    });
    const specs = [
      { key: "hr", role: "hr" }, { key: "manager", role: "manager" },
      { key: "employee", role: "employee" }, { key: "payroll", role: "payroll" },
      { key: "checker", role: "checker" }, { key: "tenantB", role: "owner" },
    ];
    const roleUsers = await db.insert(users).values(specs.map(item => ({
      email: item.key.toLowerCase() + ".nine@linaw.test", name: "Fictional " + item.key,
      role: item.role, passwordHash: hashPassword(password),
      employeeId: item.key === "employee" ? worker : null,
      totpEnabled: false, backupCodes: [],
    }))).returning();
    await db.insert(userOrganizations).values(roleUsers.map((user, i) => ({
      userId: user.id, organizationId: i === 5 ? orgB : orgA,
      role: specs[i].role, orgUnitId: specs[i].role === "manager" ? unit.id : null,
      workerEmployeeId: specs[i].role === "employee" ? worker : null,
    })));
    // The owner can switch A/B in the mobile UI. The independent B-only owner cannot view A.
    const [root] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, "owner.nine@linaw.test"));
    await db.insert(userOrganizations).values({ userId: root.id, organizationId: orgB, role: "owner" });
    [hr, manager, employee, payroll, checker, tenantB] = await Promise.all(
      specs.map(x => login(x.key.toLowerCase() + ".nine@linaw.test")),
    );
    const bReadA = await tenantB.json("/api/employees?organizationId=" + orgA);
    denied(403, bReadA.status, "tenant B-only owner denied A employees");
    const payrollReadB = await payroll.json("/api/payroll-runs?organizationId=" + orgB);
    denied(403, payrollReadB.status, "tenant A payroll officer denied B payroll");
    const aEmployee = await owner.ok("/api/employees?organizationId=" + orgA);
    const bEmployee = await owner.ok("/api/employees?organizationId=" + orgB);
    assert.equal(aEmployee.length, 1);
    assert.equal(bEmployee.length, 1);
    assert.notEqual(Number(aEmployee[0].id), Number(bEmployee[0].id));
    evidence.push("API employee-create returned worker identity; distinct tenant A/B and seven login sessions");
    report.lineage = { organizationId: orgA, shadowOrganizationId: orgB, employeeId: worker,
      periodStart, periodEnd, payDate, employeeHireDate: workDate, sourcePunchId: null, payrollRunId: null,
      separateEmployerSameLocalEmployeeNo: true };
    // Private localhost browser sign-in handoff, never uploaded as an artifact.
    writeFileSync("qa-artifacts/.nine-stage-browser-auth.json",
      JSON.stringify({ password, organizationId: orgA, otherOrganizationId: orgB,
        owner: "owner.nine@linaw.test", employee: "employee.nine@linaw.test" }));
  });
  await stage(1, async evidence => {
    const before = await hr.ok("/api/provisioning?organizationId=" + orgA);
    const record = before.employees?.find((x: any) => Number(x.employeeId) === worker);
    assert.ok(record?.onboarding?.length >= 5, "Employee-specific onboarding is missing");
    for (const task of record.onboarding) {
      await hr.ok("/api/provisioning", "PATCH", {
        organizationId: orgA, employeeId: worker, id: task.id, done: true,
      });
    }
    const after = await hr.ok("/api/provisioning?organizationId=" + orgA);
    const verified = after.employees.find((x: any) => Number(x.employeeId) === worker);
    assert.ok(verified.onboarding.every((x: any) => x.done));
    evidence.push("HR completed and read back source-owned provisioning tasks for employee");
  });
  await stage(2, async evidence => {
    const shift = await hr.ok("/api/workforce/schedules", "POST", {
      organizationId: orgA, action: "create_shift", code: "NINE-SHIFT",
      name: "Fictional One-Hour Shift", startTime: hhmm(shiftStart),
      endTime: hhmm(shiftEnd), breakMinutes: 0,
    });
    const sid = Number(shift.shift?.id);
    assert.ok(sid);
    const pattern = await hr.ok("/api/workforce/schedules", "POST", {
      organizationId: orgA, action: "create_pattern", code: "NINE-PATTERN",
      name: "Fictional Single-Day Shift", cycleDays: 1,
      days: [{ isRestDay: false, label: "Work", segments: [{ shiftDefinitionId: sid }] }],
    });
    patternId = Number(pattern.pattern?.id);
    assert.ok(patternId);
    const assigned = await hr.ok("/api/workforce/schedules", "POST", {
      organizationId: orgA, action: "assign_schedule",
      employeeId: worker, patternId, effectiveFrom: workDate,
      effectiveUntil: workDate, anchorDate: workDate,
      reason: "Authorized HR scheduling in ephemeral acceptance",
    });
    assignmentId = Number(assigned.assignment?.id);
    assert.ok(assignmentId);
    // Default-off roster-scale mode does not grant this manager People-admin
    // roster reads. HR publishes the supported schedule; do not activate flags
    // or grant a manager broader permissions to turn the test green.
    const rosterUrl = "/api/workforce/team-roster?organizationId=" + orgA
      + "&startDate=" + workDate + "&page=1";
    const roster = await hr.ok(rosterUrl);
    assert.ok(roster.rows?.some((r: any) => Number(r.employee?.id) === worker));
    const managerDenied = await manager.json(rosterUrl);
    denied(403, managerDenied.status,
      "flag-off manager cannot read People-admin roster");
    const attempted = await manager.json("/api/workforce/schedules", "POST", {
      organizationId: orgA, action: "create_shift", code: "ESCALATE",
      name: "Unauthorized Manager Definition", startTime: "09:00", endTime: "18:00",
      breakMinutes: 0,
    });
    denied(403, attempted.status, "manager may review roster but not create company-wide shift");
    evidence.push("HR-authorized schedule visible in HR roster; manager roster privilege denied with default-off flags");
  });
  await stage(3, async evidence => {
    const inEvent = await employee.ok("/api/web-bundy", "POST", {
      organizationId: orgA, employeeId: worker, actionType: "clock_in",
    });
    punchId = Number(inEvent.punch?.id);
    assert.ok(punchId && Number(inEvent.punch?.employeeId) === worker);
    const duplicate = await employee.json("/api/web-bundy", "POST", {
      organizationId: orgA, employeeId: worker, actionType: "clock_in",
    });
    denied(409, duplicate.status, "duplicate Web Bundy IN rejected");
    const outEvent = await employee.ok("/api/web-bundy", "POST", {
      organizationId: orgA, employeeId: worker, actionType: "clock_out",
    });
    assert.equal(Number(outEvent.punch?.id), punchId);
    assert.equal(outEvent.punch?.source, "web_bundy");
    assert.equal(outEvent.punch?.workDate, periodStart,
      "Web Bundy capture must be IN THE ACTUAL PAYROLL PERIOD");
    const [persisted] = await db.select().from(timePunches).where(eq(timePunches.id, punchId));
    assert.equal(persisted.organizationId, orgA);
    assert.equal(persisted.employeeId, worker);
    assert.equal(persisted.workDate, periodStart);
    assert.equal(persisted.source, "web_bundy");
    report.lineage.sourcePunchId = punchId;
    evidence.push("authenticated Web Bundy IN/OUT for SAME worker and virtual Manila month-end (no seeded punch)");
  });
  await stage(4, async evidence => {
    const requested = await employee.ok("/api/self/workforce", "POST", {
      action: "request_correction", punchId,
      proposedTimeIn: shiftStart.toISOString(),
      proposedTimeOut: shiftEnd.toISOString(),
      reason: "Fictional source clock captured; separate manager verifies corrected shift time",
    });
    assert.ok(Number(requested.correction?.id) > 0);
    const unauthorized = await employee.json("/api/workforce/attendance-corrections", "POST", {
      organizationId: orgA, action: "decide_request",
      requestId: requested.correction.id, decision: "approved",
    });
    denied(403, unauthorized.status, "employee self-correction approval denied");
    const corrected = await manager.ok("/api/workforce/attendance-corrections", "POST", {
      organizationId: orgA, action: "decide_request", requestId: requested.correction.id,
      decision: "approved", decisionNote: "Fictional independent manager source review",
    });
    assert.equal(corrected.punch?.status, "Corrected");
    await owner.ok("/api/workforce/timesheets", "POST", {
      organizationId: orgA, action: "update_policy", active: true, enforcementMode: "block",
    });
    const submitted = await employee.ok("/api/workforce/timesheets", "POST", {
      organizationId: orgA, action: "submit", employeeId: worker,
      periodStart, periodEnd,
    });
    currentTimesheetId = Number(submitted.timesheet?.id);
    assert.ok(currentTimesheetId > 0);
    const firstBlockers = (submitted.timesheet?.snapshot?.days ?? []).flatMap((day: any) =>
      (day.exceptions ?? []).filter((e: any) => e.severity === "blocker")
        .map((e: any) => String(e.kind).slice(0, 40)));
    assert.equal(Number(submitted.timesheet?.blockerCount), 0,
      "First timecard blocker kinds: " + [...new Set(firstBlockers)].join(","));
    const approved = await manager.ok("/api/workforce/timesheets", "POST", {
      organizationId: orgA, action: "decide",
      timesheetId: currentTimesheetId, decision: "approved",
      decisionNote: "Synthetic manager acceptance (NOT independent human UAT)",
    });
    assert.equal(approved.timesheet?.status, "approved");
    assert.notEqual(approved.timesheet?.submittedByUserId, approved.timesheet?.decidedByUserId);
    const second = await employee.ok("/api/self/workforce", "POST", {
      action: "request_correction", punchId,
      proposedTimeIn: new Date(shiftStart.getTime() + 60000).toISOString(),
      reason: "Fictional one-minute later arrival proves prior approval becomes stale without overtime",
    });
    const secondDecision = await manager.ok("/api/workforce/attendance-corrections", "POST", {
      organizationId: orgA, action: "decide_request", requestId: second.correction.id,
      decision: "approved", decisionNote: "Second source review invalidates previous snapshot",
    });
    assert.ok((secondDecision.staleTimesheetIds ?? []).includes(currentTimesheetId));
    const [stale] = await db.select().from(workforceTimesheets)
      .where(eq(workforceTimesheets.id, currentTimesheetId));
    assert.equal(stale.status, "stale");
    const oldVersion = await manager.json("/api/workforce/timesheets", "POST", {
      organizationId: orgA, action: "decide", timesheetId: currentTimesheetId,
      decision: "approved",
    });
    denied(409, oldVersion.status, "stale timesheet approval refused");
    const replacement = await employee.ok("/api/workforce/timesheets", "POST", {
      organizationId: orgA, action: "submit", employeeId: worker, periodStart, periodEnd,
    });
    assert.ok(Number(replacement.timesheet.version) > Number(stale.version));
    const secondBlockers = (replacement.timesheet?.snapshot?.days ?? []).flatMap((day: any) =>
      (day.exceptions ?? []).filter((e: any) => e.severity === "blocker")
        .map((e: any) => String(e.kind).slice(0, 40)));
    assert.equal(Number(replacement.timesheet?.blockerCount), 0,
      "Revised timecard blocker kinds: " + [...new Set(secondBlockers)].join(","));
    const decision = await manager.ok("/api/workforce/timesheets", "POST", {
      organizationId: orgA, action: "decide", timesheetId: replacement.timesheet.id,
      decision: "approved",
      decisionNote: "New snapshot, new independent synthetic approval",
    });
    assert.equal(decision.timesheet?.status, "approved");
    currentTimesheetId = Number(replacement.timesheet.id);
    const [timecard] = await db.select().from(workforceTimesheets)
      .where(eq(workforceTimesheets.id, currentTimesheetId));
    assert.equal(timecard.employeeId, worker);
    assert.equal(timecard.organizationId, orgA);
    assert.equal(timecard.periodStart, periodStart);
    assert.equal(timecard.periodEnd, periodEnd);
    assert.ok((timecard.snapshot as any)?.days?.some((day: any) =>
      day.date === workDate && day.punches?.some((p: any) =>
        Number(p.id) === punchId && p.source === "web_bundy")),
      "Approved timesheet snapshot must contain same Web Bundy source punch");
    const lock = await hr.ok("/api/workforce/attendance-locks", "POST", {
      organizationId: orgA, action: "lock_period", periodStart, periodEnd,
      lockType: "payroll_cutoff", reason: "Fictional approved period frozen before processing",
    });
    assert.ok(lock.lock?.id);
    const lockedClock = await employee.json("/api/web-bundy", "POST", {
      organizationId: orgA, actionType: "clock_in", employeeId: worker,
    });
    denied(423, lockedClock.status, "post-cutoff attendance mutation denied");
    evidence.push("reviewed source correction, stale approval rejection, fresh timesheet and immutable cutoff");
  });
  await stage(5, async evidence => {
    const payrollRun = await payroll.ok("/api/payroll-runs", "POST", {
      organizationId: orgA, periodStart, periodEnd, payDate, processNow: true,
    });
    runId = Number(payrollRun.run?.id);
    assert.ok(runId > 0);
    const register = await payroll.ok("/api/payroll-runs?runId=" + runId + "&include=entries");
    const entry = register.entries?.find((x: any) => Number(x.employeeId) === worker);
    assert.ok(entry && Number(entry.netPay) > 0, "Same Web Bundy worker missing from payable register");
    assert.equal(register.entries?.length, 1);
    const flagCategories = [...new Set(
      (Array.isArray(entry.trace?.flags) ? entry.trace.flags : []).map((flag: unknown) =>
        typeof flag === "string"
          ? flag.match(/^([A-Z][A-Z0-9_]+):/)?.[1] ?? "UNCLASSIFIED"
          : "UNCLASSIFIED"),
    )];
    assert.equal(Number(payrollRun.run?.exceptions), 0,
      "Unexpected payroll exception categories: " + flagCategories.join(","));
    assert.equal(entry.status, "Ready", "Calculated worker must be free of review exceptions");
    assert.equal(entry.trace?.payableTime?.mode, "calendar-segmented");
    const payableSegments = entry.trace?.payableTime?.segments ?? [];
    assert.ok(payableSegments.some((segment: any) =>
      Number(segment.punchId) === punchId && segment.sourceWorkDate === workDate
      && Number(segment.minutes) > 0),
      "Calculated payroll must contain payable-time trace from the actual Web Bundy punch");
    const scheduleTrace = entry.trace?.workforceSchedule?.days ?? [];
    assert.ok(scheduleTrace.some((day: any) =>
      day.date === workDate && Number(day.assignmentId) === assignmentId
      && Number(day.patternId) === patternId),
      "Payroll trace must preserve assigned WFM schedule evidence");
    const [persistedRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
    const [persistedEntry] = await db.select().from(payrollEntries)
      .where(and(eq(payrollEntries.payrollRunId, runId), eq(payrollEntries.employeeId, worker)));
    assert.equal(persistedRun.organizationId, orgA);
    assert.equal(persistedRun.periodStart, periodStart);
    assert.equal(persistedRun.periodEnd, periodEnd);
    assert.ok(persistedEntry);
    const [liveSource] = await db.select().from(timePunches)
      .where(and(eq(timePunches.id, punchId), eq(timePunches.employeeId, worker)));
    assert.equal(liveSource.source, "web_bundy");
    assert.equal(liveSource.workDate, persistedRun.periodEnd);
    report.lineage.payrollRunId = runId;
    report.lineage.timesheetId = currentTimesheetId;
    report.lineage.scheduleAssignmentId = assignmentId;
    evidence.push("calculated payroll entry and timecard share actual Web Bundy worker and period");
  });
  await stage(6, async evidence => {
    const deniedReview = await employee.json("/api/payroll-runs?runId=" + runId + "&include=entries");
    denied(403, deniedReview.status, "employee cannot review employer payroll register");
    const review = await payroll.ok("/api/payroll-runs/" + runId + "/submit-review", "POST", {
      approverUserId: (await db.select({ id: users.id }).from(users)
        .where(eq(users.email, "checker.nine@linaw.test")))[0].id,
    });
    assert.ok(review.task?.id);
    const selfCheck = await payroll.json("/api/approvals/" + review.task.id, "PATCH", {
      status: "Approved",
    });
    denied(403, selfCheck.status, "payroll maker cannot approve checker task");
    const checked = await checker.ok("/api/approvals/" + review.task.id, "PATCH", {
      status: "Approved",
    });
    assert.ok(checked);
    evidence.push("separate logged-in payroll maker and independent synthetic checker approval");
  });
  await stage(7, async evidence => {
    const checkerRelease = await checker.json("/api/payroll-runs/" + runId + "/release", "POST", {
      acknowledgeExceptions: false,
    });
    denied(403, checkerRelease.status, "checker cannot release payroll records");
    const preview = await owner.ok("/api/payroll-runs/" + runId + "/release-checklist");
    assert.equal(preview.ready, true);
    const released = await owner.ok("/api/payroll-runs/" + runId + "/release", "POST", {
      acknowledgeExceptions: false,
    });
    assert.equal(Number(released.receipt?.employeeCount), 1);
    assert.equal(released.receipt?.bankExport?.status, "waiting");
    const [stored] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
    assert.equal(stored.status, "Released");
    const duplicate = await owner.json("/api/payroll-runs/" + runId + "/release", "POST", {
      acknowledgeExceptions: false,
    });
    denied(409, duplicate.status, "duplicate record release rejected");
    const otherTenant = await tenantB.json("/api/payroll-runs?runId=" + runId + "&include=entries");
    denied(403, otherTenant.status, "tenant B cannot inspect the released tenant A payroll");
    const events = await db.select({ action: auditEvents.action }).from(auditEvents)
      .where(eq(auditEvents.organizationId, orgA));
    assert.ok(events.some(event => event.action === "Payroll released"),
      "Release must leave auditable evidence in the original employer");
    evidence.push("owner released records once; payment export remains waiting, with tenant denial and audit event");
  });
  await stage(8, async evidence => {
    const forms = [
      { agency: "BIR", form: "1601-C" }, { agency: "SSS", form: "R-3" },
      { agency: "PhilHealth", form: "RF-1" }, { agency: "Pag-IBIG", form: "MCRF" },
    ];
    const hashes: Record<string, string> = {};
    for (const form of forms) {
      const input = { organizationId: orgA, runId, ...form };
      const generated = await owner.ok("/api/compliance/filing-validations", "POST", input);
      assert.equal(generated.record?.status, "generated");
      assert.equal(Number(generated.record?.payrollRunId), runId);
      assert.equal(Number(generated.record?.organizationId), orgA);
      assert.match(generated.record?.fileSha256 ?? "", /^[a-f0-9]{64}$/);
      const id = Number(generated.record.id);
      const file = await owner.request("/api/compliance/filing-validations/" + id
        + "/file?organizationId=" + orgA);
      assert.equal(file.status, 200);
      const bytes = Buffer.from(await file.arrayBuffer());
      assert.match(bytes.toString("utf8"), /DRAFT ONLY, not a certified government submission file/);
      const sha = createHash("sha256").update(bytes).digest("hex");
      assert.equal(sha, generated.record.fileSha256);
      assert.equal(file.headers.get("x-filing-sha256"), sha);
      const employeeAttempt = await employee.request("/api/compliance/filing-validations/" + id
        + "/file?organizationId=" + orgA);
      denied(403, employeeAttempt.status, form.agency + " employee file access denied");
      const duplicate = await owner.ok("/api/compliance/filing-validations", "POST", input);
      assert.equal(duplicate.created, false);
      assert.equal(Number(duplicate.record?.id), id);
      hashes[form.agency] = sha;
    }
    const rows = await db.select().from(governmentFilingValidations)
      .where(eq(governmentFilingValidations.payrollRunId, runId));
    assert.equal(rows.length, 4);
    assert.ok(rows.every(r => r.organizationId === orgA && r.status === "generated"
      && r.agencyReference === null));
    report.lineage.draftHashes = hashes;
    const before = await db.select().from(timePunches).where(eq(timePunches.id, punchId));
    const refusedCorrection = await employee.ok("/api/self/workforce", "POST", {
      action: "request_correction", punchId,
      proposedTimeIn: new Date(before[0].timeIn!.getTime() + 60000).toISOString(),
      reason: "Synthetic after-release immutability denial, not a legitimate attendance change",
    });
    const deniedRewrite = await manager.json("/api/workforce/attendance-corrections", "POST", {
      organizationId: orgA, action: "decide_request",
      requestId: refusedCorrection.correction.id, decision: "approved",
      decisionNote: "Test denial; released records must not be silently rewritten",
    });
    denied(423, deniedRewrite.status, "active payroll cutoff prevents post-release correction");
    assert.equal(deniedRewrite.body?.code, "ATTENDANCE_PERIOD_LOCKED");
    const after = await db.select().from(timePunches).where(eq(timePunches.id, punchId));
    assert.deepEqual(after[0].timeIn, before[0].timeIn);
    assert.deepEqual(after[0].timeOut, before[0].timeOut);
    evidence.push("all four HTTP worksheet byte hashes match recorded SHA256; draft-only, never submitted");
    evidence.push("attempted post-release punch rewrite rejected with original times unchanged");
  });
  assert.equal(report.lineage.sourcePunchId, punchId);
  assert.equal(report.lineage.payrollRunId, runId);
}
main().catch(error => {
  // Only bounded test labels and generic errors, no response bodies or credentials.
  const message = error instanceof Error ? error.message.slice(0, 260) : "unknown acceptance error";
  console.error("Connected acceptance did not pass:", message);
  process.exitCode = 1;
}).finally(async () => {
  save();
  console.log("Nine-stage result=" + report.result + " statuses="
    + stages.map(s => s.name + ":" + s.status).join(", "));
  await pool.end();
});
