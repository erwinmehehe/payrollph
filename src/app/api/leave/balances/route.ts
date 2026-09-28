import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaveBalances, leavePolicies, leaveRequests } from "@/db/schema";
import { assertMembership, assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { computeBalance } from "@/lib/leave-accrual";

export const dynamic = "force-dynamic";

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const asOf = url.searchParams.get("asOf") ?? today();
  const year = Number(asOf.slice(0, 4));
  if (!Number.isInteger(organizationId) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return Response.json({ error: "organizationId and a valid asOf date are required." }, { status: 400 });
  }

  let employeeFilterId: number | null = null;
  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
    employeeFilterId = user.employeeId;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can view team leave balances.",
    );
    if (denied) return denied;
  }

  const [policies, allStaff, requests, stored] = await Promise.all([
    db.select().from(leavePolicies).where(and(eq(leavePolicies.organizationId, organizationId), eq(leavePolicies.active, true))),
    db.select().from(employees).where(eq(employees.organizationId, organizationId)).orderBy(asc(employees.id)),
    db.select().from(leaveRequests).where(eq(leaveRequests.organizationId, organizationId)),
    db.select().from(leaveBalances).where(and(eq(leaveBalances.organizationId, organizationId), eq(leaveBalances.year, year))),
  ]);

  const staff = employeeFilterId == null ? allStaff : allStaff.filter((employee) => employee.id === employeeFilterId);
  const storedByKey = new Map(stored.map((row) => [`${row.employeeId}:${row.leaveType}`, row]));

  const balances = staff.flatMap((employee) =>
    policies.map((policy) => {
      const mine = requests.filter(
        (requestRow) =>
          requestRow.employeeId === employee.id &&
          requestRow.leaveType === policy.leaveType &&
          String(requestRow.startDate).slice(0, 4) === String(year),
      );
      const used = mine.filter((requestRow) => requestRow.status === "Approved").reduce((sum, requestRow) => sum + Number(requestRow.days), 0);
      const pending = mine.filter((requestRow) => requestRow.status === "Pending").reduce((sum, requestRow) => sum + Number(requestRow.days), 0);
      const opening = Number(storedByKey.get(`${employee.id}:${policy.leaveType}`)?.opening ?? 0);
      const balance = computeBalance({
        policy: {
          leaveType: policy.leaveType,
          annualDays: Number(policy.annualDays),
          carryOverMax: policy.carryOverMax == null ? null : Number(policy.carryOverMax),
          maxBalance: policy.maxBalance == null ? null : Number(policy.maxBalance),
        },
        startDate: String(employee.startDate),
        asOf,
        opening,
        used,
        pending,
      });
      return {
        ...balance,
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
      };
    }),
  );

  return Response.json({
    asOf,
    year,
    policies: policies.map((policy) => ({
      id: policy.id,
      leaveType: policy.leaveType,
      annualDays: policy.annualDays,
      carryOverMax: policy.carryOverMax,
      maxBalance: policy.maxBalance,
    })),
    balances,
    employees: staff.map((employee) => ({ id: employee.id, name: `${employee.firstName} ${employee.lastName}` })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can create leave policies.",
  );
  if (denied) return denied;

  const leaveType = String(body.leaveType ?? "").trim();
  const annualDays = Number(body.annualDays);
  if (!leaveType || !Number.isFinite(annualDays) || annualDays <= 0) {
    return Response.json({ error: "leaveType and a positive annualDays are required." }, { status: 400 });
  }

  const [row] = await db.insert(leavePolicies).values({
    organizationId,
    leaveType: leaveType.slice(0, 40),
    annualDays: annualDays.toFixed(1),
    carryOverMax: body.carryOverMax == null ? null : Number(body.carryOverMax).toFixed(1),
    maxBalance: body.maxBalance == null ? null : Number(body.maxBalance).toFixed(1),
  }).returning();

  return Response.json(row, { status: 201 });
}
