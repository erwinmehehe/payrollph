import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaveRequests, overtimeRequests, payrollRuns, timePunches } from "@/db/schema";
import { getAccess, PEOPLE_PAYROLL_ROLES, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function roleAllowed(role: string, roles: readonly string[]) {
  return roles.includes(role);
}

function inclusiveDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const endDate = url.searchParams.get("endDate") ?? new Date().toISOString().slice(0, 10);
  const defaultStart = new Date(`${endDate}T00:00:00Z`);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 89);
  const startDate = url.searchParams.get("startDate") ?? defaultStart.toISOString().slice(0, 10);

  if (!Number.isInteger(organizationId) || !ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    return Response.json({ error: "organizationId and valid startDate/endDate are required." }, { status: 400 });
  }
  const days = inclusiveDays(startDate, endDate);
  if (!days || days > 366) {
    return Response.json({ error: "Analytics window must be between 1 and 366 days." }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access || !roleAllowed(access.role, WORKFORCE_MANAGER_ROLES as readonly string[])) {
    return Response.json({ error: "Workforce-manager access is required." }, { status: 403 });
  }

  const employeeRows = await db.select().from(employees)
    .where(eq(employees.organizationId, organizationId))
    .orderBy(asc(employees.id));
  const visibleEmployees = access.companyWide
    ? employeeRows
    : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const employeeIds = visibleEmployees.map((employee) => employee.id);

  const [otRows, leaveRows, punchRows, runRows] = await Promise.all([
    employeeIds.length
      ? db.select().from(overtimeRequests).where(and(
          eq(overtimeRequests.organizationId, organizationId),
          inArray(overtimeRequests.employeeId, employeeIds),
          gte(overtimeRequests.workDate, startDate),
          lte(overtimeRequests.workDate, endDate),
        ))
      : [],
    employeeIds.length
      ? db.select().from(leaveRequests).where(and(
          eq(leaveRequests.organizationId, organizationId),
          inArray(leaveRequests.employeeId, employeeIds),
          lte(leaveRequests.startDate, endDate),
          gte(leaveRequests.endDate, startDate),
        ))
      : [],
    employeeIds.length
      ? db.select().from(timePunches).where(and(
          eq(timePunches.organizationId, organizationId),
          inArray(timePunches.employeeId, employeeIds),
          gte(timePunches.workDate, startDate),
          lte(timePunches.workDate, endDate),
        ))
      : [],
    access.companyWide && roleAllowed(access.role, PEOPLE_PAYROLL_ROLES as readonly string[])
      ? db.select().from(payrollRuns).where(and(
          eq(payrollRuns.organizationId, organizationId),
          gte(payrollRuns.payDate, startDate),
          lte(payrollRuns.payDate, endDate),
        )).orderBy(asc(payrollRuns.payDate), asc(payrollRuns.id))
      : [],
  ]);

  const requestedOtMinutes = otRows.reduce((sum, row) => sum + Math.max(0, row.requestedMinutes), 0);
  const approvedOtMinutes = otRows.filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + Math.max(0, row.requestedMinutes), 0);
  const approvedLeaveDays = leaveRows.filter((row) => row.status.toLowerCase() === "approved")
    .reduce((sum, row) => sum + Number(row.days), 0);
  const pendingLeaveDays = leaveRows.filter((row) => row.status.toLowerCase() === "pending")
    .reduce((sum, row) => sum + Number(row.days), 0);
  const attendanceExceptions = punchRows.filter((row) =>
    !row.timeIn || !row.timeOut || row.status.toLowerCase() !== "complete"
  ).length;

  const latestRun = runRows.at(-1) ?? null;
  const previousRun = runRows.at(-2) ?? null;
  const latestGross = latestRun ? Number(latestRun.grossPay) : null;
  const previousGross = previousRun ? Number(previousRun.grossPay) : null;

  const trendMap = new Map<string, {
    month: string;
    overtimeMinutes: number;
    approvedLeaveDays: number;
    attendanceExceptions: number;
    payrollGross: number | null;
  }>();

  const ensureMonth = (month: string) => {
    const existing = trendMap.get(month);
    if (existing) return existing;
    const created = { month, overtimeMinutes: 0, approvedLeaveDays: 0, attendanceExceptions: 0, payrollGross: runRows.length ? 0 : null };
    trendMap.set(month, created);
    return created;
  };

  for (const row of otRows) {
    const bucket = ensureMonth(monthKey(String(row.workDate)));
    bucket.overtimeMinutes += Math.max(0, row.requestedMinutes);
  }
  for (const row of leaveRows.filter((item) => item.status.toLowerCase() === "approved")) {
    const bucket = ensureMonth(monthKey(String(row.startDate)));
    bucket.approvedLeaveDays = round2(bucket.approvedLeaveDays + Number(row.days));
  }
  for (const row of punchRows) {
    if (row.timeIn && row.timeOut && row.status.toLowerCase() === "complete") continue;
    ensureMonth(monthKey(String(row.workDate))).attendanceExceptions += 1;
  }
  for (const row of runRows) {
    const bucket = ensureMonth(monthKey(String(row.payDate)));
    bucket.payrollGross = round2((bucket.payrollGross ?? 0) + Number(row.grossPay));
  }

  return Response.json({
    window: { startDate, endDate, days },
    scope: {
      companyWide: access.companyWide,
      orgUnitId: access.orgUnitId,
      visibleEmployees: visibleEmployees.length,
    },
    costVisible: runRows.length > 0 || (access.companyWide && roleAllowed(access.role, PEOPLE_PAYROLL_ROLES as readonly string[])),
    summary: {
      activeHeadcount: visibleEmployees.filter((employee) => employee.status.toLowerCase() === "active").length,
      requestedOtHours: round2(requestedOtMinutes / 60),
      approvedOtHours: round2(approvedOtMinutes / 60),
      pendingOtRequests: otRows.filter((row) => row.status === "pending").length,
      rejectedOtRequests: otRows.filter((row) => row.status === "rejected").length,
      approvedLeaveDays: round2(approvedLeaveDays),
      pendingLeaveDays: round2(pendingLeaveDays),
      attendanceExceptions,
      punchRows: punchRows.length,
      latestPayrollGross: latestGross,
      previousPayrollGross: previousGross,
      payrollGrossVariance: latestGross != null && previousGross != null ? round2(latestGross - previousGross) : null,
    },
    trend: [...trendMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
  });
}
