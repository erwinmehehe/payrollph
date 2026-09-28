import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaveBalances, leaveConversions } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can view leave cash conversions.",
  );
  if (denied) return denied;

  const filter = employeeId > 0
    ? and(eq(leaveConversions.organizationId, organizationId), eq(leaveConversions.employeeId, employeeId))
    : eq(leaveConversions.organizationId, organizationId);

  const conversions = await db.select({
    conv: leaveConversions,
    employee: employees,
  })
    .from(leaveConversions)
    .innerJoin(employees, eq(leaveConversions.employeeId, employees.id))
    .where(filter)
    .orderBy(desc(leaveConversions.id));

  return Response.json({
    conversions: conversions.map(({ conv, employee }) => ({
      ...conv,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const leaveType = String(body.leaveType ?? "Vacation leave").trim();
  const daysConverted = Number(body.daysConverted);
  const year = Number(body.year ?? new Date().getFullYear());

  if (
    !Number.isInteger(organizationId) ||
    !Number.isInteger(employeeId) ||
    !leaveType ||
    !Number.isFinite(daysConverted) ||
    daysConverted <= 0 ||
    !Number.isInteger(year)
  ) {
    return Response.json({
      error: "organizationId, employeeId, leaveType, year and positive daysConverted are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can approve leave cash conversions.",
  );
  if (denied) return denied;

  const [employee] = await db.select().from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });

  const balances = await db.select().from(leaveBalances)
    .where(and(
      eq(leaveBalances.organizationId, organizationId),
      eq(leaveBalances.employeeId, employeeId),
      eq(leaveBalances.year, year),
    ));

  const balance = balances.find((row) => row.leaveType.toLowerCase() === leaveType.toLowerCase());
  if (!balance) {
    return Response.json({
      error: `No ${leaveType} balance exists for this employee in ${year}. Create/accrue the balance before monetizing it.`,
    }, { status: 409 });
  }

  const available =
    Number(balance.opening) +
    Number(balance.accrued) -
    Number(balance.used) -
    Number(balance.pending);

  const alreadyConverted = await db.select().from(leaveConversions)
    .where(and(
      eq(leaveConversions.organizationId, organizationId),
      eq(leaveConversions.employeeId, employeeId),
    ));
  const reserved = alreadyConverted
    .filter((row) =>
      row.status !== "rejected" &&
      row.leaveType.toLowerCase() === leaveType.toLowerCase() &&
      new Date(row.createdAt).getFullYear() === year,
    )
    .reduce((sum, row) => sum + Number(row.daysConverted), 0);

  const convertible = Math.max(0, available - reserved);
  if (daysConverted > convertible + 0.001) {
    return Response.json({
      error: `Requested ${daysConverted} day(s), but only ${convertible.toFixed(1)} day(s) are available for conversion.`,
      available: Number(available.toFixed(1)),
      alreadyReserved: Number(reserved.toFixed(1)),
      convertible: Number(convertible.toFixed(1)),
    }, { status: 422 });
  }

  const dailyRate = Number((Number(employee.basicRate) / 22).toFixed(2));
  const cashAmount = Number((daysConverted * dailyRate).toFixed(2));
  const taxExempt = daysConverted <= 12;

  const [created] = await db.insert(leaveConversions).values({
    organizationId,
    employeeId,
    leaveType,
    daysConverted: daysConverted.toFixed(1),
    dailyRate: dailyRate.toFixed(2),
    cashAmount: cashAmount.toFixed(2),
    taxExempt,
    status: "approved",
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Leave credits approved for cash conversion",
    resource: `${employee.firstName} ${employee.lastName} (${daysConverted} days = ₱${cashAmount.toFixed(2)})`,
    metadata: {
      conversionId: created.id,
      leaveBalanceId: balance.id,
      year,
      daysConverted,
      availableBefore: available,
      convertibleBefore: convertible,
      dailyRate,
      cashAmount,
      taxExempt,
    },
  });

  return Response.json(created, { status: 201 });
}
