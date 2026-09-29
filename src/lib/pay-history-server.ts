import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employeePayAdjustments,
  employeePayProfiles,
  employeePayRateChanges,
  employees,
  payrollEntries,
  payrollRuns,
  timePunches,
} from "@/db/schema";
import { resolvePayProfile, type EmployeePayProfileInput } from "@/lib/pay-basis";
import { ensureEmployeePayHistory } from "@/lib/pay-basis-schema";
import {
  calculateMonthlyRetroDelta,
  calculateWorkedRetroDelta,
  previousDay,
  round2,
} from "@/lib/pay-history";

export function philippinesToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function yearOf(date: string) {
  return Number(date.slice(0, 4));
}

function earlier(left: string, right: string) {
  return left < right ? left : right;
}

function later(left: string, right: string) {
  return left > right ? left : right;
}

function profileInput(row: {
  payBasis: string;
  rateAmount: string | number;
  standardWorkDaysPerMonth: string | number;
  standardHoursPerDay: string | number;
}): EmployeePayProfileInput {
  return {
    payBasis: row.payBasis,
    rateAmount: row.rateAmount,
    standardWorkDaysPerMonth: row.standardWorkDaysPerMonth,
    standardHoursPerDay: row.standardHoursPerDay,
  };
}

export async function syncCurrentPayProfile(organizationId: number, employeeId: number, asOf = philippinesToday()) {
  await ensureEmployeePayHistory(organizationId);
  const [employee] = await db.select().from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) throw new Error("Employee not found.");

  const changes = await db.select().from(employeePayRateChanges)
    .where(and(
      eq(employeePayRateChanges.organizationId, organizationId),
      eq(employeePayRateChanges.employeeId, employeeId),
      lte(employeePayRateChanges.effectiveFrom, asOf),
    ))
    .orderBy(asc(employeePayRateChanges.effectiveFrom));
  const selected = changes.at(-1);
  if (!selected) throw new Error("Employee pay history is missing an opening rate.");

  const resolved = resolvePayProfile(profileInput(selected));
  await db.insert(employeePayProfiles).values({
    employeeId,
    organizationId,
    payBasis: resolved.payBasis,
    rateAmount: resolved.rateAmount.toFixed(2),
    standardWorkDaysPerMonth: resolved.standardWorkDaysPerMonth.toFixed(2),
    standardHoursPerDay: resolved.standardHoursPerDay.toFixed(2),
  }).onConflictDoUpdate({
    target: employeePayProfiles.employeeId,
    set: {
      payBasis: resolved.payBasis,
      rateAmount: resolved.rateAmount.toFixed(2),
      standardWorkDaysPerMonth: resolved.standardWorkDaysPerMonth.toFixed(2),
      standardHoursPerDay: resolved.standardHoursPerDay.toFixed(2),
      updatedAt: new Date(),
    },
  });
  await db.update(employees)
    .set({ basicRate: resolved.monthlyEquivalent.toFixed(2) })
    .where(eq(employees.id, employeeId));

  return resolved;
}

export async function recordEffectivePayChange(input: {
  organizationId: number;
  employeeId: number;
  effectiveFrom: string;
  payProfile: EmployeePayProfileInput;
  reason?: string | null;
  actor: string;
}) {
  await ensureEmployeePayHistory(input.organizationId);
  const [employee] = await db.select().from(employees)
    .where(and(
      eq(employees.id, input.employeeId),
      eq(employees.organizationId, input.organizationId),
    ))
    .limit(1);
  if (!employee) throw new Error("Employee not found in this organization.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new Error("Effective date must be YYYY-MM-DD.");
  if (input.effectiveFrom < String(employee.startDate)) {
    throw new Error("Effective date cannot be before the employee start date.");
  }

  const nextProfile = resolvePayProfile(input.payProfile);
  const today = philippinesToday();
  const history = await db.select().from(employeePayRateChanges)
    .where(and(
      eq(employeePayRateChanges.organizationId, input.organizationId),
      eq(employeePayRateChanges.employeeId, input.employeeId),
    ))
    .orderBy(asc(employeePayRateChanges.effectiveFrom));

  const earliestKnown = history[0];
  if (
    earliestKnown &&
    input.effectiveFrom < String(earliestKnown.effectiveFrom) &&
    input.effectiveFrom < today
  ) {
    throw new Error(
      `Cannot auto-calculate retro pay before the first known effective rate (${earliestKnown.effectiveFrom}). Add the historical rate first or handle the prior-period correction manually.`,
    );
  }

  const sameDate = history.find((row) => String(row.effectiveFrom) === input.effectiveFrom);
  if (sameDate) {
    const adjustments = await db.select().from(employeePayAdjustments)
      .where(eq(employeePayAdjustments.rateChangeId, sameDate.id));
    if (adjustments.some((row) => row.status === "paid")) {
      throw new Error("This effective-dated change already produced a paid retro adjustment and cannot be overwritten.");
    }
  }

  const previous = history
    .filter((row) => String(row.effectiveFrom) < input.effectiveFrom)
    .at(-1);
  const opening = history[0];
  const previousProfile = previous
    ? profileInput(previous)
    : opening
      ? profileInput(opening)
      : {
          payBasis: "monthly",
          rateAmount: employee.basicRate,
          standardWorkDaysPerMonth: 22,
          standardHoursPerDay: 8,
        };
  const previousResolved = resolvePayProfile(previousProfile);

  if (input.effectiveFrom < today && previousResolved.payBasis !== nextProfile.payBasis) {
    throw new Error(
      "Retroactive pay-basis changes are not auto-adjusted. Use a current/future cutoff boundary and handle prior-period correction manually.",
    );
  }

  const nextExisting = history.find((row) => String(row.effectiveFrom) > input.effectiveFrom);
  const serviceThrough = earlier(
    previousDay(today),
    nextExisting ? previousDay(String(nextExisting.effectiveFrom)) : previousDay(today),
  );

  const retroRows: Array<{
    serviceYear: number;
    serviceFrom: string;
    serviceThrough: string;
    amount: number;
    status: "pending" | "review";
  }> = [];

  if (input.effectiveFrom < today && input.effectiveFrom <= serviceThrough) {
    const candidateRuns = await db.select().from(payrollRuns)
      .where(and(
        eq(payrollRuns.organizationId, input.organizationId),
        eq(payrollRuns.status, "Released"),
        gte(payrollRuns.periodEnd, input.effectiveFrom),
        lte(payrollRuns.periodStart, serviceThrough),
      ))
      .orderBy(asc(payrollRuns.periodStart));
    const candidateRunIds = candidateRuns.map((run) => run.id);
    const employeeEntries = candidateRunIds.length
      ? await db.select({ payrollRunId: payrollEntries.payrollRunId }).from(payrollEntries).where(and(
          eq(payrollEntries.employeeId, input.employeeId),
          inArray(payrollEntries.payrollRunId, candidateRunIds),
        ))
      : [];
    const employeeRunIds = new Set(employeeEntries.map((entry) => entry.payrollRunId));
    const releasedRuns = candidateRuns.filter((run) => employeeRunIds.has(run.id));

    const buckets = new Map<number, { amount: number; from: string; through: string }>();
    for (const run of releasedRuns) {
      const overlapFrom = later(String(run.periodStart), input.effectiveFrom);
      const overlapThrough = earlier(String(run.periodEnd), serviceThrough);
      if (overlapFrom > overlapThrough) continue;
      const serviceYear = yearOf(overlapThrough);
      let delta = 0;

      if (nextProfile.payBasis === "monthly") {
        delta = calculateMonthlyRetroDelta({
          previousProfile,
          newProfile: nextProfile,
          runStart: String(run.periodStart),
          runEnd: String(run.periodEnd),
          effectiveFrom: overlapFrom,
          serviceThrough: overlapThrough,
        });
      } else {
        const punches = await db.select().from(timePunches).where(and(
          eq(timePunches.organizationId, input.organizationId),
          eq(timePunches.employeeId, input.employeeId),
          gte(timePunches.workDate, overlapFrom),
          lte(timePunches.workDate, overlapThrough),
        ));
        delta = calculateWorkedRetroDelta({
          previousProfile,
          newProfile: nextProfile,
          punches: punches.map((punch) => ({
            workDate: String(punch.workDate),
            timeIn: punch.timeIn,
            timeOut: punch.timeOut,
            shiftStart: punch.shiftStart,
            shiftEnd: punch.shiftEnd,
          })),
          effectiveFrom: overlapFrom,
          serviceThrough: overlapThrough,
        });
      }

      const current = buckets.get(serviceYear);
      buckets.set(serviceYear, {
        amount: round2((current?.amount ?? 0) + delta),
        from: current ? earlier(current.from, overlapFrom) : overlapFrom,
        through: current ? later(current.through, overlapThrough) : overlapThrough,
      });
    }

    for (const [serviceYear, bucket] of buckets) {
      if (Math.abs(bucket.amount) < 0.01) continue;
      retroRows.push({
        serviceYear,
        serviceFrom: bucket.from,
        serviceThrough: bucket.through,
        amount: bucket.amount,
        status: bucket.amount > 0 ? "pending" : "review",
      });
    }
  }

  const result = await db.transaction(async (tx) => {
    const [change] = sameDate
      ? await tx.update(employeePayRateChanges).set({
          payBasis: nextProfile.payBasis,
          rateAmount: nextProfile.rateAmount.toFixed(2),
          standardWorkDaysPerMonth: nextProfile.standardWorkDaysPerMonth.toFixed(2),
          standardHoursPerDay: nextProfile.standardHoursPerDay.toFixed(2),
          reason: input.reason?.trim() || null,
          createdBy: input.actor,
        }).where(eq(employeePayRateChanges.id, sameDate.id)).returning()
      : await tx.insert(employeePayRateChanges).values({
          employeeId: input.employeeId,
          organizationId: input.organizationId,
          effectiveFrom: input.effectiveFrom,
          payBasis: nextProfile.payBasis,
          rateAmount: nextProfile.rateAmount.toFixed(2),
          standardWorkDaysPerMonth: nextProfile.standardWorkDaysPerMonth.toFixed(2),
          standardHoursPerDay: nextProfile.standardHoursPerDay.toFixed(2),
          reason: input.reason?.trim() || null,
          createdBy: input.actor,
        }).returning();

    if (sameDate) {
      await tx.delete(employeePayAdjustments).where(eq(employeePayAdjustments.rateChangeId, sameDate.id));
    }

    if (retroRows.length > 0) {
      await tx.insert(employeePayAdjustments).values(retroRows.map((row) => ({
        organizationId: input.organizationId,
        employeeId: input.employeeId,
        rateChangeId: change.id,
        adjustmentType: "retro_basic",
        amount: row.amount.toFixed(2),
        serviceYear: row.serviceYear,
        serviceFrom: row.serviceFrom,
        serviceThrough: row.serviceThrough,
        status: row.status,
        notes: row.amount > 0
          ? `Retro basic pay generated from effective rate change dated ${input.effectiveFrom}.`
          : "Negative retro delta requires manual review; no automatic payroll deduction is allowed.",
      })));
    }

    return change;
  });

  if (input.effectiveFrom <= today) {
    await syncCurrentPayProfile(input.organizationId, input.employeeId, today);
  }

  return { change: result, retroAdjustments: retroRows };
}
