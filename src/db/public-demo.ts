import { count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalTasks,
  auditEvents,
  employees,
  holidays,
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
import { holidayCalendarFingerprint } from "@/lib/payroll-calendar";
import { NATIONAL_HOLIDAYS_2026, type HolidayCalendarEntry } from "@/lib/wage-orders";

const PUBLIC_DEMO_ORG = "Loom & Local";

const people = [
  { firstName: "Mariel", lastName: "Santos", title: "Operations Lead", initials: "MS", status: "Active", basicRate: "38500.00", mobile: "09171230001" },
  { firstName: "Jonas", lastName: "Reyes", title: "Customer Experience", initials: "JR", status: "Active", basicRate: "29200.00", mobile: "09171230002" },
  { firstName: "Aira", lastName: "Villanueva", title: "People Operations", initials: "AV", status: "On leave", basicRate: "36500.00", mobile: "09171230003" },
  { firstName: "Paolo", lastName: "Cruz", title: "Finance Associate", initials: "PC", status: "Active", basicRate: "32500.00", mobile: "09171230004" },
  { firstName: "Nina", lastName: "Garcia", title: "Support Specialist", initials: "NG", status: "Active", basicRate: "24500.00", mobile: "09171230005" },
  { firstName: "Rico", lastName: "Mendoza", title: "Warehouse Officer", initials: "RM", status: "Active", basicRate: "21800.00", mobile: "09171230006" },
  { firstName: "Trish", lastName: "Dela Cruz", title: "Account Executive", initials: "TD", status: "Separating", basicRate: "41000.00", mobile: "09171230007" },
  { firstName: "Eli", lastName: "Tan", title: "Implementation Analyst", initials: "ET", status: "Active", basicRate: "34800.00", mobile: "09171230008" },
] as const;

const periods = {
  released: {
    periodLabel: "Aug 16–31, 2026",
    periodStart: "2026-08-16",
    periodEnd: "2026-08-31",
    status: "Released",
    payDate: "2026-09-05",
    grossPay: "181300.00",
    netPay: "147400.00",
    exceptions: 0,
  },
  checker: {
    periodLabel: "Sep 1–15, 2026",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-15",
    status: "Pending approval",
    payDate: "2026-09-18",
    grossPay: "182800.00",
    netPay: "148600.00",
    exceptions: 0,
  },
  work: {
    periodLabel: "Sep 16–30, 2026",
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
    status: "Needs review",
    payDate: "2026-10-05",
    grossPay: "184300.00",
    netPay: "149800.00",
    exceptions: 2,
  },
} as const;

function employeeEmail(firstName: string, lastName: string) {
  return `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "") + "@linaw.ph";
}

function paymentSnapshot(employee: {
  firstName: string;
  lastName: string;
  employeeNo: string;
  mobile: string | null;
}) {
  return {
    employeeName: `${employee.firstName} ${employee.lastName}`,
    employeeNo: employee.employeeNo,
    bankAccount: null,
    bankCode: null,
    mobile: employee.mobile,
    demoDataMode: "synthetic-redacted",
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

async function optionalSeed(label: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    // Optional product-tour enrichment must never make the public sandbox
    // unavailable. The core tenant/payroll/session data is provisioned first.
    console.warn(`Public demo optional seed skipped: ${label}`, error);
  }
}

async function ensureOptionalDemoData(organizationId: number) {
  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));

  await optionalSeed("subscription", async () => {
    await ensureSubscription(organizationId);
    await db
      .update(subscriptions)
      .set({ plan: "Scale", seatLimit: 50, status: "trialing" })
      .where(eq(subscriptions.organizationId, organizationId));
  });

  await optionalSeed("attendance", async () => {
    const [{ value }] = await db
      .select({ value: count() })
      .from(timePunches)
      .where(eq(timePunches.organizationId, organizationId));
    if (value > 0) return;

    await db.insert(timePunches).values(
      staff.flatMap((employee, index) => [
        {
          organizationId,
          employeeId: employee.id,
          workDate: "2026-09-25",
          timeIn: new Date("2026-09-25T01:00:00.000Z"),
          timeOut: new Date("2026-09-25T10:00:00.000Z"),
          shiftStart: "09:00",
          shiftEnd: "18:00",
          status: "Complete",
        },
        {
          organizationId,
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
  });

  await optionalSeed("leave", async () => {
    const [{ value: policyCount }] = await db
      .select({ value: count() })
      .from(leavePolicies)
      .where(eq(leavePolicies.organizationId, organizationId));

    if (policyCount === 0) {
      await db.insert(leavePolicies).values([
        {
          organizationId,
          leaveType: "Vacation",
          annualDays: "15.0",
          carryOverMax: "5.0",
          maxBalance: "20.0",
          payTreatment: "paid",
          paidPercentage: "100",
        },
        {
          organizationId,
          leaveType: "Sick",
          annualDays: "10.0",
          carryOverMax: "0.0",
          maxBalance: "10.0",
          payTreatment: "paid",
          paidPercentage: "100",
        },
      ]);
    }

    const [aira] = staff.filter((employee) => employee.firstName === "Aira" && employee.lastName === "Villanueva");
    const [jonas] = staff.filter((employee) => employee.firstName === "Jonas" && employee.lastName === "Reyes");

    const [{ value: requestCount }] = await db
      .select({ value: count() })
      .from(leaveRequests)
      .where(eq(leaveRequests.organizationId, organizationId));

    if (requestCount === 0 && aira) {
      await db.insert(leaveRequests).values({
        organizationId,
        employeeId: aira.id,
        leaveType: "Vacation",
        startDate: "2026-10-08",
        endDate: "2026-10-09",
        days: "2.0",
        reason: "Family appointment",
        status: "Pending",
      });
    }

    const [{ value: balanceCount }] = await db
      .select({ value: count() })
      .from(leaveBalances)
      .where(eq(leaveBalances.organizationId, organizationId));

    if (balanceCount === 0) {
      const balances = [
        aira
          ? {
              organizationId,
              employeeId: aira.id,
              leaveType: "Vacation",
              year: 2026,
              opening: "10.0",
              accrued: "5.0",
              used: "6.0",
              pending: "2.0",
            }
          : null,
        jonas
          ? {
              organizationId,
              employeeId: jonas.id,
              leaveType: "Vacation",
              year: 2026,
              opening: "10.0",
              accrued: "5.0",
              used: "4.0",
              pending: "0.0",
            }
          : null,
      ].filter((row): row is NonNullable<typeof row> => Boolean(row));

      if (balances.length) await db.insert(leaveBalances).values(balances);
    }
  });

  await optionalSeed("audit", async () => {
    const [{ value }] = await db
      .select({ value: count() })
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId));
    if (value > 0) return;

    const runs = await db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.organizationId, organizationId));
    const workRun = runs.find((run) => run.periodLabel === periods.work.periodLabel);
    const checkerRun = runs.find((run) => run.periodLabel === periods.checker.periodLabel);

    await db.insert(auditEvents).values([
      {
        organizationId,
        actor: "Andrea Lim",
        action: "Payroll run created",
        resource: workRun?.periodLabel ?? periods.work.periodLabel,
        metadata: { runId: workRun?.id ?? null, ruleVersion: "PH-2026.01" },
      },
      {
        organizationId,
        actor: "Paolo Cruz",
        action: "Payroll submitted for review",
        resource: checkerRun?.periodLabel ?? periods.checker.periodLabel,
        metadata: { runId: checkerRun?.id ?? null, approver: "Mariel Santos" },
      },
      {
        organizationId,
        actor: "System",
        action: "Payroll assurance completed",
        resource: workRun?.periodLabel ?? periods.work.periodLabel,
        metadata: { findings: 2, ruleVersion: "PH-2026.01" },
      },
    ]);
  });
}

/**
 * Creates one isolated public demo tenant on the official hosted application.
 * The caller validates the hostname first. Core session/payroll data is atomic;
 * optional HR-tour data is best-effort so an older production schema cannot
 * make every persona launch fail.
 */
export async function ensurePublicDemoTenant() {
  const organizationId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('linaw-public-demo-tenant-v2'))`);

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

    let units = await tx
      .select()
      .from(orgUnits)
      .where(eq(orgUnits.organizationId, organization.id));

    if (units.length === 0) {
      units = await tx
        .insert(orgUnits)
        .values([
          { organizationId: organization.id, type: "Branch", name: "Makati HQ", code: "MKT" },
          { organizationId: organization.id, type: "Branch", name: "Cebu Hub", code: "CEB" },
          { organizationId: organization.id, type: "Department", name: "Operations", code: "OPS" },
        ])
        .returning();
    }

    let staff = await tx
      .select()
      .from(employees)
      .where(eq(employees.organizationId, organization.id));

    // Repair older demo tenants in-place instead of assuming an empty tenant.
    // This keeps production sandboxes launchable after schema/seed changes.
    for (const [index, person] of people.entries()) {
      const email = employeeEmail(person.firstName, person.lastName);
      const existing = staff.find(
        (employee) =>
          employee.firstName === person.firstName &&
          employee.lastName === person.lastName,
      );
      const values = {
        organizationId: organization.id,
        orgUnitId: index < 3 ? units[0]?.id ?? null : index < 5 ? units[1]?.id ?? null : units[2]?.id ?? null,
        employeeNo: `LL-${String(index + 101).padStart(3, "0")}`,
        firstName: person.firstName,
        lastName: person.lastName,
        title: person.title,
        employmentType: index === 4 ? "Probationary" : "Regular",
        status: person.status,
        avatarInitials: person.initials,
        basicRate: person.basicRate,
        // MWE is a statutory classification, not a low-income label. Rico's
        // demo pay is above the stored NCR minimum-wage screen, so the sandbox
        // must not carry the old illustrative MWE=true flag.
        mwe: false,
        // The hosted sandbox contains no payout destination or government-ID
        // values at all. This keeps the public demo usable without production
        // encryption keys without weakening any real-customer storage rule.
        bankAccount: null,
        bankCode: null,
        mobile: person.mobile,
        email,
        region: "NCR",
        tin: null,
        sssNo: null,
        philHealthNo: null,
        pagIbigNo: null,
        startDate: `202${(index % 4) + 1}-0${(index % 8) + 1}-15`,
      };

      if (existing) {
        await tx.update(employees).set(values).where(eq(employees.id, existing.id));
      } else {
        await tx.insert(employees).values(values);
      }
    }

    staff = await tx
      .select()
      .from(employees)
      .where(eq(employees.organizationId, organization.id));

    const activeStaff = staff.filter((employee) => employee.status === "Active");
    const holidayRows = await tx.select().from(holidays).where(eq(holidays.organizationId, organization.id));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const holidayFingerprintForEmployee = (employee: typeof employees.$inferSelect) => {
      const scopeIds = new Set<number>();
      let cursor = employee.orgUnitId;
      let guard = 0;
      while (cursor != null && guard < 50) {
        if (scopeIds.has(cursor)) break;
        scopeIds.add(cursor);
        cursor = unitById.get(cursor)?.parentId ?? null;
        guard += 1;
      }
      const local: HolidayCalendarEntry[] = holidayRows
        .filter((holiday) => holiday.orgUnitId == null || scopeIds.has(holiday.orgUnitId))
        .flatMap((holiday) =>
          holiday.kind === "regular" || holiday.kind === "special"
            ? [{
                date: String(holiday.holidayDate),
                name: holiday.name,
                kind: holiday.kind as "regular" | "special",
              }]
            : []
        )
        .filter((localHoliday) => !NATIONAL_HOLIDAYS_2026.some(
          (national) =>
            national.date === localHoliday.date
            && national.name === localHoliday.name
            && national.kind === localHoliday.kind
        ));
      return holidayCalendarFingerprint([...NATIONAL_HOLIDAYS_2026, ...local]);
    };

    const existingRuns = await tx
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.organizationId, organization.id));

    async function ensureRun(key: keyof typeof periods) {
      const definition = periods[key];
      const existing = existingRuns.find((run) => run.periodLabel === definition.periodLabel);
      if (existing) return existing;

      const [created] = await tx
        .insert(payrollRuns)
        .values({
          organizationId: organization.id,
          periodLabel: definition.periodLabel,
          periodStart: definition.periodStart,
          periodEnd: definition.periodEnd,
          scopeLabel: "All locations",
          status: definition.status,
          payDate: definition.payDate,
          employeeCount: activeStaff.length,
          grossPay: definition.grossPay,
          netPay: definition.netPay,
          exceptions: definition.exceptions,
          ruleVersion: "PH-2026.01",
          processedChunks: 1,
          totalChunks: 1,
        })
        .returning();
      existingRuns.push(created);
      return created;
    }

    const releasedRun = await ensureRun("released");
    const checkerRun = await ensureRun("checker");
    const workRun = await ensureRun("work");

    const grossValues = [38500, 29200, 32500, 24500, 21800, 34800];
    const deductionValues = [7200, 5400, 6100, 4600, 4100, 6500];

    for (const [runIndex, run] of [releasedRun, checkerRun, workRun].entries()) {
      const [{ value: entryCount }] = await tx
        .select({ value: count() })
        .from(payrollEntries)
        .where(eq(payrollEntries.payrollRunId, run.id));
      if (entryCount > 0) continue;

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
            status: run.id === workRun.id && (index === 1 || index === 4) ? "Exception" : "Ready",
            lineItems: lineItems(gross, deductions),
            trace: {
              ruleVersion: "PH-2026.01",
              inputs: [
                "punches=10",
                "payBasis=monthly",
                "approved attendance",
                "statutory tables",
                "semi-monthly payroll",
                `holidayCalendarFingerprint=${holidayFingerprintForEmployee(employee)}`,
              ],
              payment: paymentSnapshot(employee),
              payProfile: {
                payBasis: "monthly",
                rateAmount: Number(employee.basicRate),
                standardWorkDaysPerMonth: 22,
                standardHoursPerDay: 8,
                monthlyEquivalent: Number(employee.basicRate),
              },
            },
          };
        }),
      );
    }

    // Repair historical public-demo snapshots too. Older demo builds stored
    // realistic-looking fake bank numbers in trace.payment. They are not real
    // customer data, but keeping them would unnecessarily couple sandbox access
    // to production key configuration and would make encryption audits noisy.
    const demoRunIds = [releasedRun.id, checkerRun.id, workRun.id];
    const allDemoEntries = await tx
      .select()
      .from(payrollEntries)
      .where(inArray(payrollEntries.payrollRunId, demoRunIds));
    for (const entry of allDemoEntries) {
      const trace = entry.trace && typeof entry.trace === "object"
        ? entry.trace as Record<string, unknown>
        : {};
      const payment = trace.payment && typeof trace.payment === "object"
        ? trace.payment as Record<string, unknown>
        : {};
      await tx.update(payrollEntries).set({
        trace: {
          ...trace,
          payment: {
            ...payment,
            bankAccount: null,
            bankCode: null,
            demoDataMode: "synthetic-redacted",
          },
        },
      }).where(eq(payrollEntries.id, entry.id));
    }

    const demoEntries = await tx
      .select()
      .from(payrollEntries)
      .where(eq(payrollEntries.payrollRunId, workRun.id));
    for (const entry of demoEntries) {
      const employee = activeStaff.find((person) => person.id === entry.employeeId);
      if (!employee) continue;
      const trace = entry.trace && typeof entry.trace === "object"
        ? entry.trace as Record<string, unknown>
        : {};
      const inputs = Array.isArray(trace.inputs)
        ? trace.inputs.filter((item): item is string => typeof item === "string")
        : [];
      const withoutFingerprint = inputs.filter((item) => !item.startsWith("holidayCalendarFingerprint="));
      await tx.update(payrollEntries).set({
        trace: {
          ...trace,
          inputs: [
            ...withoutFingerprint,
            `holidayCalendarFingerprint=${holidayFingerprintForEmployee(employee)}`,
          ],
        },
      }).where(eq(payrollEntries.id, entry.id));
    }

    const tasks = await tx
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.organizationId, organization.id));

    if (!tasks.some((task) => task.detail.includes(`Payroll run #${checkerRun.id}`))) {
      await tx.insert(approvalTasks).values({
        organizationId: organization.id,
        title: "Review Sep 1–15 payroll",
        detail: `Payroll run #${checkerRun.id} · 0 review item(s)`,
        approver: "Mariel Santos",
        dueLabel: "Required before release",
        priority: "Normal",
      });
    }

    if (!tasks.some((task) => task.title === "Approve leave request")) {
      await tx.insert(approvalTasks).values({
        organizationId: organization.id,
        title: "Approve leave request",
        detail: "Aira Villanueva · Oct 8–9",
        approver: "Mariel Santos",
        dueLabel: "Due in 2 days",
        priority: "Normal",
      });
    }

    return organization.id;
  });

  await ensureOptionalDemoData(organizationId);
  return organizationId;
}
