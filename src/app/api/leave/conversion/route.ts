import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, leaveBalances, leaveConversions, leavePolicies } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { approvedLeaveConversionCap, leaveConversionAllowance, validateLeaveConversionDays } from "@/lib/leave-conversion-policy";

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
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const leaveType = String(body.leaveType ?? "Vacation leave").trim();
  const daysConverted = Number(body.daysConverted);
  const manilaYear = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric" }).format(new Date()));
  const year = Number(body.year ?? manilaYear);

  if (
    !Number.isInteger(organizationId) ||
    !Number.isInteger(employeeId) ||
    !leaveType ||
    !validateLeaveConversionDays(daysConverted) ||
    !Number.isInteger(year) || year !== manilaYear
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

  const authorizedCap = approvedLeaveConversionCap(organizationId, leaveType);
  if (authorizedCap === null) {
    return Response.json({
      error: "Cash conversion is not enabled without an approved per-organization leave-type conversion cap.",
      code: "LEAVE_CONVERSION_POLICY_NOT_APPROVED",
    }, { status: 409 });
  }

  // Lock the authoritative balance while inspecting reservations and posting.
  // Two concurrent requests for the same employee/type/year cannot both spend
  // the same leave days; unrelated employees continue independently.
  const result = await db.transaction(async (tx) => {
    const policies = await tx.select().from(leavePolicies)
      .where(and(eq(leavePolicies.organizationId, organizationId), eq(leavePolicies.active, true)));
    const matching = policies.filter((row) => row.leaveType.toLowerCase() === leaveType.toLowerCase());
    if (matching.length !== 1) {
      return { error: "One active leave policy is required for cash conversion.", code: "LEAVE_POLICY_AMBIGUOUS_OR_MISSING" } as const;
    }
    const policy = matching[0];

    const balances = await tx.select().from(leaveBalances)
      .where(and(
        eq(leaveBalances.organizationId, organizationId),
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.year, year),
        eq(leaveBalances.leaveType, policy.leaveType),
      )).for("update");
    if (balances.length !== 1) {
      return { error: `An authoritative ${leaveType} balance is required for this employee and year.`, code: "LEAVE_BALANCE_MISSING" } as const;
    }
    const balance = balances[0];
    const available =
      Number(balance.opening) + Number(balance.accrued) - Number(balance.used) - Number(balance.pending);

    const previous = await tx.select().from(leaveConversions)
      .where(and(eq(leaveConversions.organizationId, organizationId), eq(leaveConversions.employeeId, employeeId)));
    const reserved = previous.filter((row) =>
      row.status !== "rejected" &&
      row.leaveType.toLowerCase() === leaveType.toLowerCase() &&
      Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric" }).format(row.createdAt)) === year,
    ).reduce((sum, row) => sum + Number(row.daysConverted), 0);
    const convertible = leaveConversionAllowance({
      available, reserved, alreadyConverted: reserved,
      policyAnnualDays: Number(policy.annualDays),
      approvedAnnualConversionCap: authorizedCap,
    });
    if (daysConverted > convertible) {
      return {
        error: `Requested ${daysConverted.toFixed(1)} day(s), but the policy and unspent balance authorize only ${convertible.toFixed(1)} day(s).`,
        code: "LEAVE_CONVERSION_CAP_EXCEEDED",
        available: Number(Math.max(0, available).toFixed(1)),
        alreadyReserved: Number(reserved.toFixed(1)),
        convertible,
      } as const;
    }

    const dailyRate = Number((Number(employee.basicRate) / 22).toFixed(2));
    if (!Number.isFinite(dailyRate) || dailyRate <= 0) {
      return { error: "Employee daily rate cannot be verified.", code: "LEAVE_CONVERSION_PAY_RATE_INVALID" } as const;
    }
    const cashAmount = Number((daysConverted * dailyRate).toFixed(2));
    // Existing tax-exemption policy is deliberately unchanged by this
    // reservation fix; tax classification requires separate fiscal review.
    const taxExempt = daysConverted <= 12;

    const [created] = await tx.insert(leaveConversions).values({
      organizationId, employeeId, leaveType: policy.leaveType,
      daysConverted: daysConverted.toFixed(1),
      dailyRate: dailyRate.toFixed(2),
      cashAmount: cashAmount.toFixed(2),
      taxExempt,
      status: "approved",
    }).returning();

    await tx.insert(auditEvents).values({
      organizationId, actor: user.name, action: "Leave credits approved for cash conversion",
      resource: `${employee.firstName} ${employee.lastName} (${daysConverted} days = PHP ${cashAmount.toFixed(2)})`,
      metadata: {
        conversionId: created.id, leaveBalanceId: balance.id,
        year, daysConverted, availableBefore: available, reservedBefore: reserved,
        convertibleBefore: convertible, authorizedCap, leavePolicyId: policy.id,
        dailyRate, cashAmount, taxExempt,
      },
    });
    return { created } as const;
  });

  if ("error" in result) {
    return Response.json(result, { status: result.code === "LEAVE_CONVERSION_CAP_EXCEEDED" ? 422 : 409 });
  }
  return Response.json(result.created, { status: 201 });
}
