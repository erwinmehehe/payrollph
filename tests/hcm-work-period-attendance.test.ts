import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, separationRecords } from "../src/db/schema";
import {
  evaluateHcmWorkPeriod, hcmWorkPeriodGuardEnabled,
  isRealIsoWorkDate, loadCurrentHcmSeparation,
  workPeriodDeniedResponse,
} from "../src/lib/hcm-work-period-guard";

const regular = {
  employeeId: 7,
  organizationId: 11,
  status: "Active",
  startDate: "2026-01-15",
};

test("work dates must be real Gregorian calendar dates and ordered", () => {
  for (const candidate of ["", "2026-02-30", "2026-13-01", "10/09/2026", "2026-2-09"]) {
    assert.equal(isRealIsoWorkDate(candidate), false, candidate);
  }
  assert.equal(isRealIsoWorkDate("2024-02-29"), true);
  assert.equal(isRealIsoWorkDate("2026-10-09"), true);
  const invalid = evaluateHcmWorkPeriod({
    employee: regular,
    startDate: "2026-10-12",
    endDate: "2026-10-10",
    separation: null,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "HCM_WORK_PERIOD_INVALID_DATE");
});

test("new overtime and timesheet evidence cannot predate verified employment", () => {
  const decision = evaluateHcmWorkPeriod({
    employee: regular,
    startDate: "2025-12-31",
    endDate: "2026-01-20",
    separation: null,
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.code, "HCM_WORK_BEFORE_HIRE");
  assert.deepEqual(evaluateHcmWorkPeriod({
    employee: regular,
    startDate: "2026-01-15",
    endDate: "2026-02-01",
    separation: null,
  }), { ok: true });
});

test("separating employees can finish authorized work up to but not past actual last day", () => {
  const employee = { ...regular, status: "Separating" };
  const sep = { status: "draft", lastDay: "2026-06-30" };
  assert.equal(evaluateHcmWorkPeriod({
    employee, startDate: "2026-06-30", endDate: "2026-06-30", separation: sep,
  }).ok, true);
  const overtimeAfter = evaluateHcmWorkPeriod({
    employee, startDate: "2026-07-01", endDate: "2026-07-01", separation: sep,
  });
  assert.equal(overtimeAfter.ok, false);
  if (!overtimeAfter.ok) assert.equal(overtimeAfter.code, "HCM_WORK_AFTER_LAST_DAY");
  const cutoffCrossing = evaluateHcmWorkPeriod({
    employee, startDate: "2026-06-16", endDate: "2026-07-15", separation: sep,
  });
  assert.equal(cutoffCrossing.ok, false, "mixed valid/invalid timesheet periods must not be silently split");
  const missing = evaluateHcmWorkPeriod({
    employee, startDate: "2026-06-01", endDate: "2026-06-15", separation: null,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "HCM_SEPARATION_END_DATE_UNVERIFIED");
  const staleReleasedExit = evaluateHcmWorkPeriod({
    employee, startDate: "2026-06-01", endDate: "2026-06-15",
    separation: { status: "released", lastDay: "2026-06-30" },
  });
  assert.equal(staleReleasedExit.ok, false);
  if (!staleReleasedExit.ok) assert.equal(staleReleasedExit.code, "HCM_WORKER_EXIT_STATE_CONFLICT");
});

test("separated, terminated and inactive workers cannot create new wages via standard WFM routes", () => {
  for (const status of ["Separated", "Terminated", "Inactive", "Suspended", "Other"]) {
    const decision = evaluateHcmWorkPeriod({
      employee: { ...regular, status },
      startDate: "2026-02-01", endDate: "2026-02-15",
      separation: { status: "released", lastDay: "2026-06-30" },
    });
    assert.equal(decision.ok, false, status);
    if (!decision.ok) assert.equal(decision.code, "HCM_WORKER_NOT_ACTIVE");
  }
  const oldWorker = evaluateHcmWorkPeriod({
    employee: { ...regular, status: "On leave" },
    startDate: "2026-01-16", endDate: "2026-01-16", separation: null,
  });
  assert.equal(oldWorker.ok, true);
});

test("active worker with an overlapping termination record is not silently treated as employed", () => {
  const conflict = evaluateHcmWorkPeriod({
    employee: regular,
    startDate: "2026-03-01", endDate: "2026-03-15",
    separation: { status: "approved", lastDay: "2026-06-01" },
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, "HCM_WORKER_EXIT_STATE_CONFLICT");
});

test("default OFF is server-enforced; invalid work period has a stable HTTP 409 response", async () => {
  assert.equal(hcmWorkPeriodGuardEnabled(), process.env.HCM_WORK_PERIOD_GUARD_ENABLED === "true");
  const blocked = workPeriodDeniedResponse({
    ok: false, code: "HCM_WORK_AFTER_LAST_DAY", error: "Late work period.",
  });
  assert.equal(blocked?.status, 409);
  assert.equal((await blocked!.json()).code, "HCM_WORK_AFTER_LAST_DAY");
  assert.equal(workPeriodDeniedResponse({ ok: true }), null);
  const source = readFileSync("src/lib/hcm-work-period-guard.ts", "utf8");
  assert.ok(source.includes('process.env.HCM_WORK_PERIOD_GUARD_ENABLED === "true"'));
  assert.ok(source.includes('eq(separationRecords.organizationId, employee.organizationId)'));
  assert.ok(source.includes("gte(separationRecords.lastDay, employee.startDate)"));
});

test("two-tenant separation evidence never crosses organizations, and rehire ignores old exit", async () => {
  const code = randomUUID().slice(0, 8);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: `HCM work-period A ${code}`, legalName: "Employment QA", plan: "Core" },
    { name: `HCM work-period B ${code}`, legalName: "Employment QA", plan: "Core" },
  ]).returning();
  try {
    const [workerA, workerB] = await db.insert(employees).values([
      { organizationId: alpha.id, employeeNo: `A-${code}`,
        firstName: "Anna", lastName: "QA", title: "Staff",
        basicRate: "22000.00", avatarInitials: "AQ", status: "Separating",
        startDate: "2026-01-01" },
      { organizationId: beta.id, employeeNo: `B-${code}`,
        firstName: "Ben", lastName: "QA", title: "Staff",
        basicRate: "23000.00", avatarInitials: "BQ", status: "Separating",
        startDate: "2026-01-01" },
    ]).returning();
    await db.insert(separationRecords).values({
      organizationId: beta.id,
      employeeId: workerB.id,
      separationType: "resignation",
      noticeDate: "2026-05-01",
      lastDay: "2026-06-20",
      status: "draft",
    });
    const a = {
      employeeId: workerA.id, organizationId: alpha.id,
      status: workerA.status, startDate: String(workerA.startDate),
    };
    const b = {
      employeeId: workerB.id, organizationId: beta.id,
      status: workerB.status, startDate: String(workerB.startDate),
    };
    assert.equal(await loadCurrentHcmSeparation(a), null);
    assert.deepEqual(await loadCurrentHcmSeparation(b), {
      status: "draft", lastDay: "2026-06-20",
    });
    await db.insert(separationRecords).values({
      organizationId: alpha.id,
      employeeId: workerA.id,
      separationType: "resignation",
      noticeDate: "2026-06-01",
      lastDay: "2026-06-30",
      status: "released",
    });
    assert.equal((await loadCurrentHcmSeparation(a))?.lastDay, "2026-06-30");

    // Employer rehire with an explicitly later start does not inherit a
    // historical termination cap for their newly documented employment.
    const rehired = { ...a, status: "Active", startDate: "2026-07-15" };
    assert.equal(await loadCurrentHcmSeparation(rehired), null);
    assert.equal(evaluateHcmWorkPeriod({
      employee: rehired, startDate: "2026-08-01", endDate: "2026-08-15", separation: null,
    }).ok, true);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});

test("workforce routes gate new pay evidence and approvals without blocking rejections", () => {
  const overtime = readFileSync("src/app/api/workforce/overtime/route.ts", "utf8");
  const timesheet = readFileSync("src/app/api/workforce/timesheets/route.ts", "utf8");
  assert.ok(overtime.includes('if (action === "create_request")'));
  assert.ok(overtime.includes('const verifiedWindow = await checkHcmWorkPeriod('));
  assert.ok(overtime.includes('decision === "approved" && hcmWorkPeriodGuardEnabled()'));
  assert.ok(overtime.includes("for share"), "OT request and approval must hold the employee lifecycle row");
  assert.ok(timesheet.includes('if (action === "submit")'));
  assert.ok(timesheet.includes('if (decision === "approved")'));
  assert.ok(timesheet.includes("hcmWorkPeriodGuardEnabled()"));
  assert.ok(timesheet.includes("for share"), "timesheet submit and approval must lock employee row");
  assert.ok(timesheet.includes("TIMESHEET_APPROVAL_STALE_OR_OUTSIDE_EMPLOYMENT"));
  assert.ok(overtime.includes('["approved", "rejected"].includes(decision)'));
  assert.ok(timesheet.includes('["approved", "rejected"].includes(decision)'));
});
