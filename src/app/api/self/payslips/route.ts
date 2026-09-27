import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, payrollEntries, payrollRuns, payslips, userOrganizations, users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Employee self-service. A session with role="employee" resolves to exactly one
 * employee record, and every query below is filtered by that id — not by a
 * client-supplied parameter — so an employee cannot read a colleague's payslip.
 */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  if (session.role !== "employee") {
    return Response.json({ error: "This endpoint is for employee self-service accounts." }, { status: 403 });
  }
  if (!session.employeeId) {
    return Response.json({ error: "This account is not linked to an employee record. Contact your administrator." }, { status: 403 });
  }

  const [employee] = await db.select().from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!employee) return Response.json({ error: "Employee record not found." }, { status: 404 });

  const [organization] = await db.select().from(organizations).where(eq(organizations.id, employee.organizationId)).limit(1);

  const rows = await db
    .select({ entry: payrollEntries, run: payrollRuns, slip: payslips })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .leftJoin(payslips, eq(payslips.payrollEntryId, payrollEntries.id))
    .where(eq(payrollEntries.employeeId, session.employeeId))
    .orderBy(desc(payrollRuns.payDate))
    .limit(52);

  const released = rows.filter((row) => row.run.status === "Released");

  const yearToDate = released.reduce(
    (totals, row) => {
      const items = Array.isArray(row.entry.lineItems) ? row.entry.lineItems as Array<{ code?: string; amount?: number }> : [];
      for (const item of items) {
        const amount = Number(item.amount ?? 0);
        if (item.code === "WHT") totals.tax += Math.abs(amount);
      }
      totals.gross += Number(row.entry.grossPay);
      totals.net += Number(row.entry.netPay);
      totals.deductions += Number(row.entry.deductions);
      return totals;
    },
    { gross: 0, net: 0, deductions: 0, tax: 0 },
  );

  return Response.json({
    employee: {
      employeeNo: employee.employeeNo,
      firstName: employee.firstName,
      lastName: employee.lastName,
      title: employee.title,
      employmentType: employee.employmentType,
      status: employee.status,
      monthlyBasic: employee.basicRate,
    },
    employer: organization ? { name: organization.name } : null,
    yearToDate: {
      gross: yearToDate.gross.toFixed(2),
      net: yearToDate.net.toFixed(2),
      deductions: yearToDate.deductions.toFixed(2),
      tax: yearToDate.tax.toFixed(2),
      periodsPaid: released.length,
    },
    payslips: released.map((row) => ({
      entryId: row.entry.id,
      period: row.run.periodLabel,
      payDate: row.run.payDate,
      gross: row.entry.grossPay,
      deductions: row.entry.deductions,
      net: row.entry.netPay,
      ruleVersion: row.run.ruleVersion,
      lineItems: row.entry.lineItems,
    })),
  });
}

/** Links (or re-links) a signed-in employee account to their employee record. */
export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const employeeNo = String(body.employeeNo ?? "").trim();
  if (!employeeNo) return Response.json({ error: "employeeNo is required." }, { status: 400 });

  // Cross-tenant guard: the caller may only link to an employee record inside an
  // organization they are actually a member of. The organizationId in the request
  // body is ignored entirely — trusting it let any authenticated user claim a
  // record at another company by guessing an employee number.
  const memberships = await db
    .select({ organizationId: userOrganizations.organizationId })
    .from(userOrganizations)
    .where(eq(userOrganizations.userId, session.id));
  const myOrganizations = memberships.map((row) => row.organizationId);
  if (myOrganizations.length === 0) {
    return Response.json({ error: "Your account is not a member of any workspace." }, { status: 403 });
  }

  const candidates = await db.select().from(employees).where(
    and(eq(employees.employeeNo, employeeNo), inArray(employees.organizationId, myOrganizations)),
  );
  if (candidates.length === 0) {
    return Response.json({ error: "No employee found with that number in your workspace." }, { status: 404 });
  }
  if (candidates.length > 1) {
    return Response.json({ error: "That employee number exists in more than one of your workspaces. Ask your administrator to link it directly." }, { status: 409 });
  }
  const employee = candidates[0];

  const claimed = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.employeeId, employee.id)).limit(1);
  if (claimed.length && claimed[0].id !== session.id) {
    return Response.json({ error: `This employee record is already linked to ${claimed[0].email}.` }, { status: 409 });
  }

  // Never demote a privileged account. Linking is for dedicated employee
  // logins; an admin following this path would otherwise lose workspace access.
  if (session.role === "admin" || session.role === "bookkeeper") {
    return Response.json({
      error: "This account has administrator access and cannot be converted to a self-service login. Invite a separate employee account instead.",
      hint: "POST /api/invitations with role=employee",
    }, { status: 409 });
  }

  await db.update(users).set({ employeeId: employee.id, role: "employee" }).where(eq(users.id, session.id));

  return Response.json({ ok: true, employeeId: employee.id, employeeNo: employee.employeeNo });
}
