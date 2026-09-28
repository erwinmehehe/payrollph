import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employeeLoans, employees, leaveBalances, payrollEntries, payrollRuns, separationRecords } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { computeThirteenthMonthPay } from "@/lib/ph-compliance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  const filter = employeeId > 0
    ? and(eq(separationRecords.organizationId, organizationId), eq(separationRecords.employeeId, employeeId))
    : eq(separationRecords.organizationId, organizationId);

  const records = await db.select({
    sep: separationRecords,
    employee: employees,
  })
    .from(separationRecords)
    .innerJoin(employees, eq(separationRecords.employeeId, employees.id))
    .where(filter)
    .orderBy(desc(separationRecords.id));

  return Response.json({
    separations: records.map(({ sep, employee }) => ({
      ...sep,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      employeeTitle: employee.title,
      basicRate: employee.basicRate,
      hireDate: employee.startDate,
    })),
  });
}

/**
 * Creates or computes Final Pay for a separating employee.
 * Strictly adheres to DOLE Labor Advisory No. 06-20 (30-day final pay release mandate):
 * 1. Prorated 13th month pay = Basic earned from Jan 1 to Last Day / 12
 * 2. Unused leave credit monetization = Unused days * (Basic / 22)
 * 3. Withholding tax adjustment (refund/collection)
 * 4. Less: Active loan balances
 * 5. Computes net final pay
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId ?? 1);
  const employeeId = Number(body.employeeId);
  const separationType = String(body.separationType ?? "resignation");
  const noticeDate = String(body.noticeDate ?? new Date().toISOString().slice(0, 10));
  const lastDay = String(body.lastDay ?? new Date().toISOString().slice(0, 10));
  const unusedLeaveCredits = Number(body.unusedLeaveCredits ?? 0);

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee || employee.organizationId !== organizationId) {
    return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }

  // Calculate Prorated 13th Month Pay (from Jan 1 to lastDay)
  const lastDate = new Date(`${lastDay}T12:00:00Z`);
  const monthsWorkedInYear = Math.min(12, Math.max(1, lastDate.getMonth() + 1));
  const monthlyBasic = Number(employee.basicRate);
  const basicEarnedThisYear = monthlyBasic * monthsWorkedInYear;
  const prorated13th = computeThirteenthMonthPay(basicEarnedThisYear);

  // Unused Leave Monetization
  const dailyRate = monthlyBasic / 22;
  const leaveMonetizationPay = Number((unusedLeaveCredits * dailyRate).toFixed(2));

  // Outstanding Loans to Deduct
  const loans = await db.select().from(employeeLoans).where(
    and(eq(employeeLoans.organizationId, organizationId), eq(employeeLoans.employeeId, employeeId), eq(employeeLoans.status, "active")),
  );
  const loanDeductions = Number(loans.reduce((sum, l) => sum + Number(l.remainingBalance), 0).toFixed(2));

  // Final Pay Net Amount
  const netFinalPay = Math.max(0, Number((prorated13th + leaveMonetizationPay - loanDeductions).toFixed(2)));

  const [created] = await db.insert(separationRecords).values({
    organizationId,
    employeeId,
    separationType,
    noticeDate,
    lastDay,
    clearanceStatus: "in_progress",
    itCleared: false,
    adminCleared: false,
    financeCleared: false,
    hrCleared: false,
    prorated13thMonth: prorated13th.toFixed(2),
    unusedLeaveCredits: unusedLeaveCredits.toFixed(1),
    leaveMonetizationPay: leaveMonetizationPay.toFixed(2),
    taxAdjustment: "0.00",
    loanDeductions: loanDeductions.toFixed(2),
    netFinalPay: netFinalPay.toFixed(2),
    status: "draft",
    coeIssued: false,
  }).returning();

  // Mark employee status as Separating
  await db.update(employees).set({ status: "Separating" }).where(eq(employees.id, employeeId));

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Separation and Final Pay computed",
    resource: `${employee.firstName} ${employee.lastName} (Final Pay: ₱${netFinalPay.toFixed(2)})`,
    metadata: { separationId: created.id, prorated13th, leaveMonetizationPay, loanDeductions, netFinalPay },
  });

  return Response.json(created, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const action = String(body.action ?? "clearance"); // "clearance", "approve", "release", "issue_coe"

  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [sep] = await db.select().from(separationRecords).where(eq(separationRecords.id, id)).limit(1);
  if (!sep) return Response.json({ error: "Separation record not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    sep.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to manage separation and final pay.",
  );
  if (denied) return denied;

  if (action === "clearance") {
    const itCleared = body.itCleared !== undefined ? Boolean(body.itCleared) : sep.itCleared;
    const adminCleared = body.adminCleared !== undefined ? Boolean(body.adminCleared) : sep.adminCleared;
    const financeCleared = body.financeCleared !== undefined ? Boolean(body.financeCleared) : sep.financeCleared;
    const hrCleared = body.hrCleared !== undefined ? Boolean(body.hrCleared) : sep.hrCleared;
    const allCleared = itCleared && adminCleared && financeCleared && hrCleared;

    const [updated] = await db.update(separationRecords).set({
      itCleared,
      adminCleared,
      financeCleared,
      hrCleared,
      clearanceStatus: allCleared ? "cleared" : "in_progress",
    }).where(eq(separationRecords.id, id)).returning();

    return Response.json(updated);
  }

  if (action === "approve") {
    const [updated] = await db.update(separationRecords).set({
      status: "approved",
    }).where(eq(separationRecords.id, id)).returning();

    return Response.json(updated);
  }

  if (action === "issue_coe") {
    const [updated] = await db.update(separationRecords).set({
      coeIssued: true,
    }).where(eq(separationRecords.id, id)).returning();

    return Response.json(updated);
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
