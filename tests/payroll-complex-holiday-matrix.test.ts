import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees,
  holidays,
  organizations,
  payPolicies,
  payPolicyRules,
  payrollEntries,
  payrollRuns,
  timePunches,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function line(entry: typeof payrollEntries.$inferSelect, code: string) {
  const items = Array.isArray(entry.lineItems)
    ? entry.lineItems as Array<{ code?: string; amount?: string | number }>
    : [];
  return items.find((item) => item.code === code);
}

function linePrefix(entry: typeof payrollEntries.$inferSelect, prefix: string) {
  const items = Array.isArray(entry.lineItems)
    ? entry.lineItems as Array<{ code?: string; amount?: string | number; notes?: string[] }>
    : [];
  return items.find((item) => String(item.code ?? "").startsWith(prefix));
}

async function runComplexHoliday(input: {
  workDate: string;
  label: string;
  restDay: string;
  localHolidays?: Array<{ name: string; kind: "regular" | "special" }>;
  holidayRestDayPremium?: {
    conditions: Record<string, unknown>;
    additionalPremiumPercent: number;
    taxable: boolean;
    includeInSssBase: boolean;
    includeInPagIbigBase: boolean;
  };
  attendance?: {
    timeIn: string;
    timeOut: string;
    shiftStart: string;
    shiftEnd: string;
    breakStart?: string;
    breakEnd?: string;
  };
}) {
  const [org] = await db.insert(organizations).values({
    name: `Complex Holiday QA ${input.label}`,
    legalName: `Complex Holiday QA ${input.label} Inc.`,
    plan: "Core",
  }).returning();

  const [employee] = await db.insert(employees).values({
    organizationId: org.id,
    employeeNo: `HOL-${input.label}`,
    firstName: "Holiday",
    lastName: "Matrix",
    title: "Associate",
    avatarInitials: "HM",
    basicRate: "35200.00",
    startDate: "2025-01-01",
    restDay: input.restDay,
  }).returning();

  if (input.holidayRestDayPremium) {
    const [policy] = await db.insert(payPolicies).values({
      organizationId: org.id,
      code: `HOLIDAY-REST-${input.label}`,
      name: `Holiday/rest policy ${input.label}`,
      policyKind: "company",
      version: "2026.1",
      scopeType: "organization",
      priority: 100,
      effectiveFrom: input.workDate,
      active: true,
      approvedBy: "Payroll QA",
      approvedAt: new Date(`${input.workDate}T00:00:00+08:00`),
    }).returning();

    await db.insert(payPolicyRules).values({
      policyId: policy.id,
      ruleKey: "DAY-CLASS-TOPUP",
      eventType: "holiday_rest_day_premium",
      conditions: input.holidayRestDayPremium.conditions,
      outcome: {
        label: "Company holiday/rest top-up",
        additionalPremiumPercent: input.holidayRestDayPremium.additionalPremiumPercent,
        taxable: input.holidayRestDayPremium.taxable,
        includeInSssBase: input.holidayRestDayPremium.includeInSssBase,
        includeInPagIbigBase: input.holidayRestDayPremium.includeInPagIbigBase,
      },
      priority: 100,
      statutoryFloorProtected: true,
      enabled: true,
    });
  }

  for (const holiday of input.localHolidays ?? []) {
    await db.insert(holidays).values({
      organizationId: org.id,
      holidayDate: input.workDate,
      name: holiday.name,
      kind: holiday.kind,
    });
  }

  const [year, month, day] = input.workDate.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);

  const attendance = input.attendance ?? {
    timeIn: `${input.workDate}T14:00:00+08:00`,
    timeOut: `${nextDate}T01:00:00+08:00`,
    shiftStart: "14:00",
    shiftEnd: "23:00",
  };

  await db.insert(timePunches).values({
    organizationId: org.id,
    employeeId: employee.id,
    workDate: input.workDate,
    timeIn: new Date(attendance.timeIn),
    timeOut: new Date(attendance.timeOut),
    breakStart: attendance.breakStart ? new Date(attendance.breakStart) : null,
    breakEnd: attendance.breakEnd ? new Date(attendance.breakEnd) : null,
    shiftStart: attendance.shiftStart,
    shiftEnd: attendance.shiftEnd,
    status: "Complete",
  });

  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id,
    periodLabel: input.label,
    periodStart: input.workDate,
    periodEnd: input.workDate,
    scopeLabel: "All locations",
    status: "Draft",
    payDate: input.workDate,
  }).returning();

  await enqueuePayrollRun(run.id);
  await drainPayrollQueue(10, run.id);
  const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.ok(entry);
  return { org, entry };
}

test("special non-working day + rest day + OT + NSD uses 150% / 195% and compounds NSD", async () => {
  // 17 Feb 2026 is a special non-working day and Tuesday.
  const { org, entry } = await runComplexHoliday({
    workDate: "2026-02-17",
    label: "special-rest-ot-nsd",
    restDay: "Tuesday",
  });

  try {
    const hourly = 200;
    assert.equal(line(entry, "HOLIDAY")?.amount, money(8 * hourly * (1.5 - 1)));
    assert.equal(line(entry, "OT")?.amount, money(2 * hourly * 1.95));
    assert.equal(
      line(entry, "ND")?.amount,
      money((1 * hourly * 1.5 * 0.1) + (2 * hourly * 1.95 * 0.1)),
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("double regular holiday + rest day + OT + NSD uses 390% / 507% and compounds NSD", async () => {
  // Two employer-calendar regular holidays on one date create the represented
  // DOLE double-regular state. 16 Jun 2026 is Tuesday and not a national holiday.
  const { org, entry } = await runComplexHoliday({
    workDate: "2026-06-16",
    label: "double-regular-rest-ot-nsd",
    restDay: "Tuesday",
    localHolidays: [
      { name: "Regular Holiday A", kind: "regular" },
      { name: "Regular Holiday B", kind: "regular" },
    ],
  });

  try {
    const hourly = 200;
    assert.equal(line(entry, "HOLIDAY")?.amount, money(8 * hourly * (3.9 - 1)));
    assert.equal(line(entry, "OT")?.amount, money(2 * hourly * 5.07));
    assert.equal(
      line(entry, "ND")?.amount,
      money((1 * hourly * 3.9 * 0.1) + (2 * hourly * 5.07 * 0.1)),
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("configurable special-holiday/rest-day top-up adds pay without changing statutory OT or NSD", async () => {
  const { org, entry } = await runComplexHoliday({
    workDate: "2026-02-17",
    label: "special-rest-policy-topup",
    restDay: "Tuesday",
    holidayRestDayPremium: {
      conditions: { holidayTypes: ["special"], restDay: true },
      additionalPremiumPercent: 20,
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: false,
    },
    attendance: {
      timeIn: "2026-02-17T12:00:00+08:00",
      timeOut: "2026-02-17T23:00:00+08:00",
      breakStart: "2026-02-17T16:00:00+08:00",
      breakEnd: "2026-02-17T17:00:00+08:00",
      shiftStart: "12:00",
      shiftEnd: "21:00",
    },
  });

  try {
    const hourly = 200;
    assert.equal(line(entry, "HOLIDAY")?.amount, money(8 * hourly * (1.5 - 1)));
    assert.equal(line(entry, "OT")?.amount, money(2 * hourly * 1.95));
    assert.equal(
      line(entry, "ND")?.amount,
      money(1 * hourly * 1.95 * 0.1),
    );
    assert.equal(linePrefix(entry, "DAYPREM-")?.amount, money(8 * hourly * 0.2));

    const trace = entry.trace as {
      payPolicyExecution?: {
        migratedRuleFamilies?: string[];
        appliedRules?: Array<{ eventType?: string; statutoryMultiplier?: number }>;
      };
      inputs?: string[];
    };
    assert.ok(trace.payPolicyExecution?.migratedRuleFamilies?.includes("holiday_rest_day_premium"));
    assert.equal(
      trace.payPolicyExecution?.appliedRules?.find((item) => item.eventType === "holiday_rest_day_premium")?.statutoryMultiplier,
      1.5,
    );
    assert.ok(trace.inputs?.includes("holidayRestDayPremium=320.00"));
    assert.ok(trace.inputs?.includes("holidayRestDayPremiumExcludedFromPagIbigBase=320.00"));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("incomplete cross-midnight evidence blocks configurable holiday/rest-day premium execution", async () => {
  const { org, entry } = await runComplexHoliday({
    workDate: "2026-02-17",
    label: "policy-xmid-block",
    restDay: "Tuesday",
    holidayRestDayPremium: {
      conditions: { holidayTypes: ["special"], restDay: true },
      additionalPremiumPercent: 20,
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: true,
    },
  });

  try {
    assert.equal(linePrefix(entry, "DAYPREM-"), undefined);
    const trace = entry.trace as { flags?: string[] };
    assert.ok(
      trace.flags?.some((flag) =>
        flag.includes(
          "configurable holiday/rest-day premium was not executed because cross-midnight payable-time allocation is incomplete",
        ),
      ),
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
