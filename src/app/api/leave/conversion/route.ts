import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaveConversions, leaveRequests, organizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertAnyPermission, assertPermission } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);

  const denied = await assertAnyPermission(user.id, organizationId, ["payroll:read", "hr:read"]);
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

/**
 * Monetizes unused leave credits to cash.
 * Formula: Cash Amount = Days Converted * ((Monthly Basic * 12) / company annual payroll divisor)
 * Under BIR RR 29-2025, monetized unused vacation leave up to 12 days per year is tax-exempt.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId ?? 1);
  const employeeId = Number(body.employeeId);
  const leaveType = String(body.leaveType ?? "Vacation leave");
  const daysConverted = Number(body.daysConverted);

  const denied = await assertPermission(user.id, organizationId, "hr:manage");
  if (denied) return denied;

  if (!employeeId || !Number.isFinite(daysConverted) || daysConverted <= 0) {
    return Response.json({ error: "Employee and positive daysConverted are required." }, { status: 400 });
  }

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee || employee.organizationId !== organizationId) {
    return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }

  const [organization] = await db.select({ payrollAnnualDivisor: organizations.payrollAnnualDivisor }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const annualPayDivisor = Number(organization?.payrollAnnualDivisor ?? 365);
  const dailyRate = Number(((Number(employee.basicRate) * 12) / annualPayDivisor).toFixed(2));
  const cashAmount = Number((daysConverted * dailyRate).toFixed(2));
  const taxExempt = daysConverted <= 12; // RR 29-2025 exemption limit

  const [created] = await db.insert(leaveConversions).values({
    organizationId,
    employeeId,
    leaveType,
    daysConverted: daysConverted.toFixed(1),
    dailyRate: dailyRate.toFixed(2),
    cashAmount: cashAmount.toFixed(2),
    taxExempt,
    status: "approved", // Approved and ready to credit on the next payroll run
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Leave credits monetized to cash",
    resource: `${employee.firstName} ${employee.lastName} (${daysConverted} days = ₱${cashAmount.toFixed(2)})`,
    metadata: { conversionId: created.id, daysConverted, dailyRate, annualPayDivisor, cashAmount, taxExempt },
  });

  return Response.json(created, { status: 201 });
}
