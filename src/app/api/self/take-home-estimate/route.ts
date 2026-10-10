import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employeePayProfiles, employees } from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { resolvePayProfile } from "@/lib/pay-basis";
import { estimateMonthlyTakeHome } from "@/lib/take-home-estimate";

export const dynamic = "force-dynamic";

/**
 * Baseline for the employee's own take-home what-if estimator. The employee is
 * resolved from the session only; what-if scenarios run client-side with the
 * same estimator, so nothing the employee types is sent or stored.
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
  const membershipDenied = await assertMembership(session.id, employee.organizationId);
  if (membershipDenied) return membershipDenied;

  const [profile] = await db.select().from(employeePayProfiles)
    .where(eq(employeePayProfiles.employeeId, employee.id))
    .limit(1);
  const recordedMonthly = Number(employee.basicRate);
  if (!profile && !(recordedMonthly > 0)) {
    return Response.json({ error: "Your pay profile is not set up yet. Ask HR or payroll to complete it." }, { status: 409 });
  }

  const resolved = profile
    ? resolvePayProfile({
        payBasis: profile.payBasis,
        rateAmount: profile.rateAmount,
        standardWorkDaysPerMonth: profile.standardWorkDaysPerMonth,
        standardHoursPerDay: profile.standardHoursPerDay,
      })
    : { monthlyEquivalent: recordedMonthly, payBasis: "monthly" as const };
  const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const baseline = {
    monthlyBasic: resolved.monthlyEquivalent,
    payBasis: resolved.payBasis,
    mwe: Boolean(employee.mwe),
  };

  return Response.json({
    asOf,
    baseline,
    estimate: estimateMonthlyTakeHome({ monthlyBasic: baseline.monthlyBasic, mwe: baseline.mwe, asOf }),
    note: "An estimate of a full month of regular pay. Attendance, overtime, holidays, loans and one-off items are not included, and your released payslip is the official amount.",
  }, { headers: { "Cache-Control": "no-store, private" } });
}
