import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, payrollEntries, payrollRuns, payslips, userOrganizations, users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { employeePayStatusLabel } from "@/lib/payroll-handoff";
import { recordAuditEvent } from "@/lib/audit";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

/**
 * Employee self-service. A session with role="employee" resolves to exactly one
 * employee record, and every query below is filtered by that id, not by a
 * client-supplied parameter, so an employee cannot read a colleague's payslip.
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
    .where(and(
      eq(payrollEntries.employeeId, session.employeeId),
      eq(payrollRuns.organizationId, employee.organizationId),
    ))
    .orderBy(desc(payrollRuns.payDate))
    .limit(52);

  const released = rows.filter((row) => row.run.status === "Released");
  const upcoming = rows
    .filter((row) => row.run.status !== "Released")
    .sort((a, b) => a.run.payDate.localeCompare(b.run.payDate))[0];

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
    employer: organization ? { id: organization.id, name: organization.name } : null,
    yearToDate: {
      gross: yearToDate.gross.toFixed(2),
      net: yearToDate.net.toFixed(2),
      deductions: yearToDate.deductions.toFixed(2),
      tax: yearToDate.tax.toFixed(2),
      periodsPaid: released.length,
    },
    nextPay: upcoming
      ? {
          period: upcoming.run.periodLabel,
          payDate: upcoming.run.payDate,
          status: upcoming.run.status,
          label: employeePayStatusLabel(upcoming.run.status),
        }
      : null,
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
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const employeeNo = String(body.employeeNo ?? "").trim();
  if (!employeeNo) return Response.json({ error: "employeeNo is required." }, { status: 400 });

  // Cross-tenant guard: the caller may only link to an employee record inside an
  // organization they are actually a member of. The organizationId in the request
  // body is ignored entirely, trusting it let any authenticated user claim a
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

  // Linking is only for dedicated employee identities. Never let an owner,
  // HR, payroll, checker, manager, admin or bookkeeper session demote itself by
  // submitting an employee number.
  if (session.role !== "employee") {
    return Response.json({
      error: "Only employee self-service accounts can link an employee record.",
      hint: "Invite a separate employee account instead of reusing a privileged account.",
    }, { status: 403 });
  }

  await db.update(users).set({ employeeId: employee.id }).where(eq(users.id, session.id));

  await recordAuditEvent({
    organizationId: employee.organizationId,
    actor: session.name,
    action: "Employee self-service account linked",
    resource: employee.employeeNo,
    metadata: { userId: session.id, employeeId: employee.id },
  });

  return Response.json({ ok: true, employeeId: employee.id, employeeNo: employee.employeeNo });
}
