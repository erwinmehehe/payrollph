import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { separationRecords } from "@/db/schema";

/**
 * Default OFF until independently reconciled workforce/HR/payroll staging
 * cases and employer policy signoff have authorized enforcement.
 */
export function hcmWorkPeriodGuardEnabled() {
  return process.env.HCM_WORK_PERIOD_GUARD_ENABLED === "true";
}

export type HcmWorkEvidence = {
  employeeId: number;
  organizationId: number;
  status: string;
  startDate: string;
};

export type HcmSeparationWindow = {
  status: string;
  lastDay: string;
} | null;

export type HcmWorkDecision =
  | { ok: true }
  | { ok: false; code: string; error: string };

function deny(code: string, error: string): HcmWorkDecision {
  return { ok: false, code, error };
}

export function isRealIsoWorkDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Never infer a worker's termination date from an application status alone.
 * The intent of this gate is prevention of *new* wages/attendance authorizations
 * after verified employment ended, NOT deletion of unpaid historical wages.
 *
 * An authorized payroll/HR correction workflow must resolve genuine earned pay
 * that was not processed before exit. A normal WFM submit/approve route must
 * not become an unreviewed backdoor into a Released final-pay package.
 */
export function evaluateHcmWorkPeriod(input: {
  employee: HcmWorkEvidence;
  startDate: string;
  endDate: string;
  separation: HcmSeparationWindow;
}): HcmWorkDecision {
  const { employee, startDate, endDate, separation } = input;
  if (!isRealIsoWorkDate(startDate) || !isRealIsoWorkDate(endDate)
      || !isRealIsoWorkDate(String(employee.startDate)) || endDate < startDate) {
    return deny("HCM_WORK_PERIOD_INVALID_DATE", "The work period and verified employment start date must be real calendar dates.");
  }
  if (startDate < employee.startDate) {
    return deny(
      "HCM_WORK_BEFORE_HIRE",
      "This work predates the employee's recorded start date. Verify the HR record or use an approved historical correction.",
    );
  }

  if (!["Active", "On leave", "Separating"].includes(employee.status)) {
    return deny(
      "HCM_WORKER_NOT_ACTIVE",
      "New overtime or timesheet authorization is unavailable for an exited or inactive worker. Reconcile genuine earned wages through an approved HR/payroll correction workflow.",
    );
  }

  if (employee.status === "Separating") {
    if (!separation || !["draft", "approved", "released"].includes(separation.status)
      || !isRealIsoWorkDate(String(separation.lastDay))) {
      return deny(
        "HCM_SEPARATION_END_DATE_UNVERIFIED",
        "This worker is separating but has no verifiable current separation end date. Ask People Operations to reconcile the lifecycle record.",
      );
    }
    if (startDate > separation.lastDay || endDate > separation.lastDay) {
      return deny(
        "HCM_WORK_AFTER_LAST_DAY",
        "The work period extends beyond the recorded final employment day. Do not approve new pay evidence; review the separation and final-pay source.",
      );
    }
  } else if (separation && ["draft", "approved", "released"].includes(separation.status)) {
    // Active workers with an overlapping open/released separation require an
    // explicit HR reconciliation. A legitimate later rehire uses a newer
    // start date and is excluded from the separation lookup below.
    return deny(
      "HCM_WORKER_EXIT_STATE_CONFLICT",
      "This worker has an overlapping separation record inconsistent with their active status. Reconcile HCM state before adding wage evidence.",
    );
  }
  return { ok: true };
}

/**
 * Read only this employer's latest relevant separation; an old separation
 * ending before the worker's current start date must not block a rehire.
 * The caller must first authorize the worker for this organization and unit.
 */
export async function loadCurrentHcmSeparation(
  employee: HcmWorkEvidence,
  executor: Pick<typeof db, "select"> = db,
): Promise<HcmSeparationWindow> {
  const [row] = await executor.select({
    status: separationRecords.status,
    lastDay: separationRecords.lastDay,
  }).from(separationRecords).where(and(
    eq(separationRecords.organizationId, employee.organizationId),
    eq(separationRecords.employeeId, employee.employeeId),
    gte(separationRecords.lastDay, employee.startDate),
    inArray(separationRecords.status, ["draft", "approved", "released"]),
  )).orderBy(desc(separationRecords.id)).limit(1);
  return row ?? null;
}

export async function checkHcmWorkPeriod(
  employee: HcmWorkEvidence,
  startDate: string,
  endDate: string,
  executor: Pick<typeof db, "select"> = db,
): Promise<HcmWorkDecision> {
  if (!hcmWorkPeriodGuardEnabled()) return { ok: true };
  const separation = await loadCurrentHcmSeparation(employee, executor);
  return evaluateHcmWorkPeriod({ employee, startDate, endDate, separation });
}

export function workPeriodDeniedResponse(decision: HcmWorkDecision) {
  if (decision.ok) return null;
  return Response.json(
    { code: decision.code, error: decision.error, policy: "hcm-work-period" },
    { status: 409, headers: { "Cache-Control": "private, no-store" } },
  );
}
