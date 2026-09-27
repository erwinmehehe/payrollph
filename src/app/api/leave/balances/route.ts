import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaveBalances, leavePolicies, leaveRequests } from "@/db/schema";
import { assertPermission } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { computeBalance, type LeavePolicyInput } from "@/lib/leave-accrual";

export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const asOf = url.searchParams.get("asOf") ?? today();
  const year = Number(asOf.slice(0, 4));

  const denied = await assertPermission(user.id, organizationId, "hr:read");
  if (denied) return denied;

  const [policies, staff, requests, stored] = await Promise.all([
    db.select().from(leavePolicies).where(and(eq(leavePolicies.organizationId, organizationId), eq(leavePolicies.active, true))),
    db.select().from(employees).where(eq(employees.organizationId, organizationId)).orderBy(asc(employees.id)),
    db.select().from(leaveRequests).where(eq(leaveRequests.organizationId, organizationId)),
    db.select().from(leaveBalances).where(and(eq(leaveBalances.organizationId, organizationId), eq(leaveBalances.year, year))),
  ]);

  const storedByKey = new Map(stored.map((row) => [`${row.employeeId}:${row.leaveType}`, row]));

  const balances = staff.flatMap((employee) =>
    policies.map((policy) => {
      const mine = requests.filter((r) => r.employeeId === employee.id && r.leaveType === policy.leaveType && String(r.startDate).slice(0, 4) === String(year));
      const used = mine.filter((r) => r.status === "Approved").reduce((s, r) => s + Number(r.days), 0);
      const pending = mine.filter((r) => r.status === "Pending").reduce((s, r) => s + Number(r.days), 0);
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
    policies: policies.map((p) => ({
      id: p.id,
      leaveType: p.leaveType,
      annualDays: p.annualDays,
      carryOverMax: p.carryOverMax,
      maxBalance: p.maxBalance,
    })),
    balances,
    employees: staff.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const denied = await assertPermission(user.id, organizationId, "hr:manage");
  if (denied) return denied;

  const leaveType = String(body.leaveType ?? "").trim();
  const annualDays = Number(body.annualDays);
  if (!leaveType || !Number.isFinite(annualDays) || annualDays <= 0) {
    return Response.json({ error: "leaveType and a positive annualDays are required." }, { status: 400 });
  }

  const [row] = await db.insert(leavePolicies).values({
    organizationId,
    leaveType,
    annualDays: annualDays.toFixed(1),
    carryOverMax: body.carryOverMax == null ? null : Number(body.carryOverMax).toFixed(1),
    maxBalance: body.maxBalance == null ? null : Number(body.maxBalance).toFixed(1),
  }).returning();

  return Response.json(row, { status: 201 });
}
