import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employeePayProfiles, employees, provisioningTasks } from "@/db/schema";
import { buildHirePayrollInputReview, type HirePayrollInputReview } from "@/lib/hcm-hire-payroll-review";

const ONBOARDING_PREVIEW_LIMIT = 25;

/**
 * Must be called only AFTER organization membership, People-admin custom-deny,
 * company-wide scope and feature-allowlist checks by the server page.
 *
 * Only boolean presence checks and task done flags cross the DB boundary.
 * Nothing selects salary amounts, account numbers, statutory IDs or names.
 */
export async function loadHirePayrollInputReview(
  organizationId: number, employeeId: number,
): Promise<HirePayrollInputReview | null> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(employeeId) || employeeId <= 0) return null;

  const [worker] = await db.select({
    id: employees.id,
    status: employees.status,
    statutoryIdsRecorded: sql<boolean>`NULLIF(BTRIM(${employees.tin}), '') IS NOT NULL
      AND NULLIF(BTRIM(${employees.tinBranchCode}), '') IS NOT NULL
      AND NULLIF(BTRIM(${employees.sssNo}), '') IS NOT NULL
      AND NULLIF(BTRIM(${employees.philHealthNo}), '') IS NOT NULL
      AND NULLIF(BTRIM(${employees.pagIbigNo}), '') IS NOT NULL`,
    payoutDetailsRecorded: sql<boolean>`NULLIF(BTRIM(${employees.bankAccount}), '') IS NOT NULL
      AND NULLIF(BTRIM(${employees.bankCode}), '') IS NOT NULL`,
    restDayRecorded: sql<boolean>`NULLIF(BTRIM(${employees.restDay}), '') IS NOT NULL`,
  }).from(employees).where(and(
    eq(employees.organizationId, organizationId),
    eq(employees.id, employeeId),
  )).limit(1);
  if (!worker) return null;

  const [payRows, taskRows] = await Promise.all([
    db.select({
      basisRecognized: sql<boolean>`${employeePayProfiles.payBasis} IN ('monthly', 'daily', 'hourly')`,
      ratePositive: sql<boolean>`${employeePayProfiles.rateAmount} > 0`,
      standardDaysPositive: sql<boolean>`${employeePayProfiles.standardWorkDaysPerMonth} > 0`,
      standardHoursPositive: sql<boolean>`${employeePayProfiles.standardHoursPerDay} > 0`,
    }).from(employeePayProfiles).where(and(
      eq(employeePayProfiles.organizationId, organizationId),
      eq(employeePayProfiles.employeeId, employeeId),
    )).limit(1),
    db.select({ done: provisioningTasks.done })
      .from(provisioningTasks).where(and(
        eq(provisioningTasks.organizationId, organizationId),
        eq(provisioningTasks.employeeId, employeeId),
        eq(provisioningTasks.kind, "onboarding"),
      ))
      .orderBy(provisioningTasks.id)
      .limit(ONBOARDING_PREVIEW_LIMIT + 1),
  ]);

  return buildHirePayrollInputReview({
    organizationId,
    employeeId,
    observedAt: new Date().toISOString(),
    employee: {
      active: worker.status === "Active",
      statutoryIdsRecorded: worker.statutoryIdsRecorded === true,
      payoutDetailsRecorded: worker.payoutDetailsRecorded === true,
      restDayRecorded: worker.restDayRecorded === true,
    },
    payProfile: payRows[0] ?? null,
    recordedOnboardingTasks: taskRows.slice(0, ONBOARDING_PREVIEW_LIMIT),
    onboardingPreviewHasMore: taskRows.length > ONBOARDING_PREVIEW_LIMIT,
  });
}
