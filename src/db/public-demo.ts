import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalTasks,
  auditEvents,
  employees,
  leaveBalances,
  leavePolicies,
  leaveRequests,
  organizations,
  orgUnits,
  payrollEntries,
  payrollRuns,
  subscriptions,
  timePunches,
} from "@/db/schema";
import { ensureSubscription } from "@/lib/billing";

const PUBLIC_DEMO_ORG = "Loom & Local";

const people = [
  { firstName: "Mariel", lastName: "Santos", title: "Operations Lead", initials: "MS", status: "Active", basicRate: "38500.00", bankAccount: "1234567890", bankCode: "BDO", mobile: "09171230001" },
  { firstName: "Jonas", lastName: "Reyes", title: "Customer Experience", initials: "JR", status: "Active", basicRate: "29200.00", bankAccount: "2234567890", bankCode: "BPI", mobile: "09171230002" },
  { firstName: "Aira", lastName: "Villanueva", title: "People Operations", initials: "AV", status: "On leave", basicRate: "36500.00", bankAccount: "3234567890", bankCode: "UB", mobile: "09171230003" },
  { firstName: "Paolo", lastName: "Cruz", title: "Finance Associate", initials: "PC", status: "Active", basicRate: "32500.00", bankAccount: "4234567890", bankCode: "BDO", mobile: "09171230004" },
  { firstName: "Nina", lastName: "Garcia", title: "Support Specialist", initials: "NG", status: "Active", basicRate: "24500.00", bankAccount: "5234567890", bankCode: "BPI", mobile: "09171230005" },
  { firstName: "Rico", lastName: "Mendoza", title: "Warehouse Officer", initials: "RM", status: "Active", basicRate: "21800.00", bankAccount: "6234567890", bankCode: "BDO", mobile: "09171230006" },
  { firstName: "Trish", lastName: "Dela Cruz", title: "Account Executive", initials: "TD", status: "Separating", basicRate: "41000.00", bankAccount: "7234567890", bankCode: "GCASH", mobile: "09171230007" },
  { firstName: "Eli", lastName: "Tan", title: "Implementation Analyst", initials: "ET", status: "Active", basicRate: "34800.00", bankAccount: "8234567890", bankCode: "UB", mobile: "09171230008" },
] as const;

function employeeEmail(firstName: string, lastName: string) {
  return `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "") + "@linaw.ph";
}

function paymentSnapshot(employee: {
  firstName: string;
  lastName: string;
  employeeNo: string;
  bankAccount: string | null;
  bankCode: string | null;
  mobile: string | null;
}) {
  return {
    employeeName: `${employee.firstName} ${employee.lastName}`,
    employeeNo: employee.employeeNo,
    bankAccount: employee.bankAccount,
    bankCode: employee.bankCode,
    mobile: employee.mobile,
  };
}

function lineItems(gross: number, deductions: number) {
  return [
    { code: "BASIC", label: "Basic / worked pay", amount: gross.toFixed(2) },
    { code: "SSS", label: "SSS contribution", amount: (-(deductions * 0.24)).toFixed(2) },
    { code: "PHIC", label: "PhilHealth contribution", amount: (-(deductions * 0.18)).toFixed(2) },
    { code: "HDMF", label: "Pag-IBIG contribution", amount: (-(deductions * 0.06)).toFixed(2) },
    { code: "WHT", label: "Withholding tax", amount: (-(deductions * 0.52)).toFixed(2) },
  ];
}

/**
 * Creates one isolated public demo tenant on the official hosted application.
 * This never runs for normal customer/self-hosted deployments; the route that
 * calls it first validates the public demo hostname.
 *
 * The transaction uses an advisory lock so concurrent first clicks cannot
 * create duplicate Loom & Local tenants.
 */
export async function ensurePublicDemoTenant() {
  const organizationId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('linaw-public-demo-tenant'))`);

    let [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.name, PUBLIC_DEMO_ORG))
      .limit(1);

    if (!organization) {
      [organization] = await tx
        .insert(organizations)
        .values({
          name: PUBLIC_DEMO_ORG,
          legalName: "Loom & Local Philippines Inc.",
          accountType: "business",
          plan: "Scale",
          employeeCount: people.length,
          color: "#176B5D",
        })
        .returning();
    }

    const [{ value: employeeCount }] = await tx
      .select({ value: count() })
      .from(employees)
      .where(eq(employees.organizationId, organization.id));

    if (employeeCount === 0) {
      const units = await tx
        .insert(orgUnits)
        .values([
          { organizationId: organization.id, type: "Branch", name: "Makati HQ", code: "MKT" },
          { organizationId: organization.id, type: "Branch", name: "Cebu Hub", code: "CEB" },
          { organizationId: organization.id, type: "Department", name: "Operations", code: "OPS" },
        ])
        .returning();

      const staff = await tx
        .insert(employees)
        .values(
          people.map((person, index) => ({
            organizationId: organization.id,
            orgUnitId: index < 3 ? units[0].id : index < 5 ? units[1].id : units[2].id,
            employeeNo: `LL-${String(index + 101).padStart(3, "0")}`,
            firstName: person.firstName,
            lastName: person.lastName,
            title: person.title,
            employmentType: index === 4 ? "Probationary" : "Regular",
            status: person.status,
            avatarInitials: person.initials,
            basicRate: person.basicRate,
            mwe: index === 5,
            bankAccount: person.bankAccount,
            bankCode: person.bankCode,
            mobile: person.mobile,
            email: employeeEmail(person.firstName, person.lastName),
            region: "NCR",
            startDate: `202${(index % 4) + 1}-0${(index % 8) + 1}-15`,
          })),
        )
        .returning();

      const activeStaff = staff.filter((employee) => employee.status === "Active");

      await tx.insert(timePunches).values(
        staff.flatMap((employee, index) => [
          {
            organizationId: organization.id,
            employeeId: employee.id,
            workDate: "2026-09-25",
            timeIn: new Date("2026-09-25T01:00:00.000Z"),
            timeOut: new Date("2026-09-25T10:00:00.000Z"),
            shiftStart: "09:00",
            shiftEnd: "18:00",
            status: "Complete",
          },
          {
            organizationId: organization.id,
            employeeId: employee.id,
            workDate: "2026-09-26",
            timeIn: new Date("2026-09-26T01:00:00.000Z"),
            timeOut: index === 5 ? null : new Date("2026-09-26T10:15:00.000Z"),
            shiftStart: "09:00",
            shiftEnd: "18:00",
            status: index === 5 ? "Incomplete" : "Complete",
          },
        ]),
      );

      const [releasedRun, checkerRun, workRun] = await tx
        .insert(payrollRuns)
        .values([
          {
            organizationId: organization.id,
            periodLabel: "Aug 16–31, 2026",
            periodStart: "2026-08-16",
            periodEnd: "2026-08-31",
            scopeLabel: "All locations",
            status: "Released",
            payDate: "2026-09-05",
            employeeCount: activeStaff.length,
            grossPay: "176300.00",
            netPay: "145645.00",
            exceptions: 0,
            ruleVersion: "PH-2026.01",
            processedChunks: 1,
            totalChunks: 1,
          },
          {
            organizationId: organization.id,
            periodLabel: "Sep 1–15, 2026",
            periodStart: "2026-09-01",
            periodEnd: "2026-09-15",
            scopeLabel: "All locations",
            status: "Pending approval",
            payDate: "2026-09-18",
            employeeCount: activeStaff.length,
            grossPay: "181250.00",
            netPay: "149768.00",
            exceptions: 0,
            ruleVersion: "PH-2026.01",
            processedChunks: 1,
            totalChunks: 1,
          },
          {
            organizationId: organization.id,
            periodLabel: "Sep 16–30, 2026",
            periodStart: "2026-09-16",
            periodEnd: "2026-09-30",
            scopeLabel: "All locations",
            status: "Needs review",
            payDate: "2026-10-05",
            employeeCount: activeStaff.length,
            grossPay: "183400.00",
            netPay: "151524.00",
            exceptions: 2,
            ruleVersion: "PH-2026.01",
            processedChunks: 1,
            totalChunks: 1,
          },
        ])
        .returning();

      const grossValues = [38500, 29200, 32500, 24500, 21800, 34800];
      const deductionValues = [7200, 5400, 6100, 4600, 4100, 6500];

      for (const [runIndex, run] of [releasedRun, checkerRun, workRun].entries()) {
        await tx.insert(payrollEntries).values(
          activeStaff.map((employee, index) => {
            const gross = grossValues[index] + runIndex * 250;
            const deductions = deductionValues[index] + runIndex * 50;
            return {
              payrollRunId: run.id,
              employeeId: employee.id,
              grossPay: gross.toFixed(2),
              deductions: deductions.toFixed(2),
              netPay: (gross - deductions).toFixed(2),
              status: run === workRun && (index === 1 || index === 4) ? "Exception" : "Ready",
              lineItems: lineItems(gross, deductions),
              trace: {
                ruleVersion: "PH-2026.01",
                inputs: ["approved attendance", "statutory tables", "semi-monthly payroll"],
                payment: paymentSnapshot(employee),
              },
            };
          }),
        );
      }

      const checkerEmployee = staff.find((employee) => employee.firstName === "Mariel" && employee.lastName === "Santos");
      const leaveEmployee = staff.find((employee) => employee.firstName === "Aira" && employee.lastName === "Villanueva");
      const jonas = staff.find((employee) => employee.firstName === "Jonas" && employee.lastName === "Reyes");

      await tx.insert(approvalTasks).values([
        {
          organizationId: organization.id,
          title: "Review Sep 1–15 payroll",
          detail: `Payroll run #${checkerRun.id} · 0 review item(s)`,
          approver: "Mariel Santos",
          dueLabel: "Required before release",
          priority: "Normal",
        },
        {
          organizationId: organization.id,
          title: "Approve leave request",
          detail: "Aira Villanueva · Oct 8–9",
          approver: "Mariel Santos",
          dueLabel: "Due in 2 days",
          priority: "Normal",
        },
      ]);

      await tx.insert(leavePolicies).values([
        {
          organizationId: organization.id,
          leaveType: "Vacation",
          annualDays: "15.0",
          carryOverMax: "5.0",
          maxBalance: "20.0",
          payTreatment: "paid",
          paidPercentage: "100",
        },
        {
          organizationId: organization.id,
          leaveType: "Sick",
          annualDays: "10.0",
          carryOverMax: "0.0",
          maxBalance: "10.0",
          payTreatment: "paid",
          paidPercentage: "100",
        },
      ]);

      if (leaveEmployee) {
        await tx.insert(leaveRequests).values({
          organizationId: organization.id,
          employeeId: leaveEmployee.id,
          leaveType: "Vacation",
          startDate: "2026-10-08",
          endDate: "2026-10-09",
          days: "2.0",
          reason: "Family appointment",
          status: "Pending",
        });
        await tx.insert(leaveBalances).values({
          organizationId: organization.id,
          employeeId: leaveEmployee.id,
          leaveType: "Vacation",
          year: 2026,
          opening: "10.0",
          accrued: "5.0",
          used: "6.0",
          pending: "2.0",
        });
      }

      if (jonas) {
        await tx.insert(leaveBalances).values({
          organizationId: organization.id,
          employeeId: jonas.id,
          leaveType: "Vacation",
          year: 2026,
          opening: "10.0",
          accrued: "5.0",
          used: "4.0",
          pending: "0.0",
        });
      }

      await tx.insert(auditEvents).values([
        {
          organizationId: organization.id,
          actor: "Andrea Lim",
          action: "Payroll run created",
          resource: workRun.periodLabel,
          metadata: { runId: workRun.id, ruleVersion: "PH-2026.01" },
        },
        {
          organizationId: organization.id,
          actor: "Paolo Cruz",
          action: "Payroll submitted for review",
          resource: checkerRun.periodLabel,
          metadata: { runId: checkerRun.id, approver: "Mariel Santos" },
        },
        {
          organizationId: organization.id,
          actor: "System",
          action: "Payroll assurance completed",
          resource: workRun.periodLabel,
          metadata: { findings: 2, ruleVersion: "PH-2026.01" },
        },
      ]);

      void checkerEmployee;
    }

    return organization.id;
  });

  await ensureSubscription(organizationId);
  await db
    .update(subscriptions)
    .set({ plan: "Scale", seatLimit: 50, status: "trialing" })
    .where(eq(subscriptions.organizationId, organizationId));

  return organizationId;
}
