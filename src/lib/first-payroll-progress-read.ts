import { FIRST_PAYROLL_STEPS, type FirstPayrollKey } from "./first-payroll-journey";

export type SavedFirstPayrollProgress = {
  stepOwners: Partial<Record<FirstPayrollKey, string>>;
  completedSteps: Partial<Record<FirstPayrollKey, {
    byUserId: number;
    at: string;
    periodStart?: string;
    periodEnd?: string;
  }>>;
};

const readError = () => new Error("Saved first-payroll progress could not be verified for this employer.");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/**
 * A successful HTTP response without valid progress evidence is not an
 * empty, completed or authorized payroll setup. Employer isolation is owned
 * by the authenticated endpoint and the consuming view's request scope.
 */
export function parseFirstPayrollProgressRead(value: unknown): SavedFirstPayrollProgress | null {
  if (!isRecord(value) || !Object.hasOwn(value, "progress")) {
    throw readError();
  }
  if (value.progress === null) return null;
  if (!isRecord(value.progress) || !isRecord(value.progress.stepOwners) ||
      !isRecord(value.progress.completedSteps)) throw readError();

  const stepOwners: SavedFirstPayrollProgress["stepOwners"] = {};
  const completedSteps: SavedFirstPayrollProgress["completedSteps"] = {};

  for (const [key, role] of Object.entries(value.progress.stepOwners)) {
    const step = FIRST_PAYROLL_STEPS.find(item => item.key === key);
    if (!step || typeof role !== "string" || !step.allowedOwners.some(allowed => allowed === role)) {
      throw readError();
    }
    stepOwners[step.key] = role;
  }
  for (const [key, evidence] of Object.entries(value.progress.completedSteps)) {
    const step = FIRST_PAYROLL_STEPS.find(item => item.key === key);
    if (!step || !isRecord(evidence) || !Number.isSafeInteger(evidence.byUserId) ||
        typeof evidence.byUserId !== "number" || evidence.byUserId <= 0 ||
        typeof evidence.at !== "string" || !Number.isFinite(Date.parse(evidence.at))) {
      throw readError();
    }
    const hasPeriod = evidence.periodStart !== undefined || evidence.periodEnd !== undefined;
    if ((key === "time" || hasPeriod) &&
        (key !== "time" || !validDate(evidence.periodStart) || !validDate(evidence.periodEnd) ||
         evidence.periodStart > evidence.periodEnd)) {
      throw readError();
    }
    completedSteps[step.key] = {
      byUserId: evidence.byUserId,
      at: evidence.at,
      ...(hasPeriod ? { periodStart: evidence.periodStart as string, periodEnd: evidence.periodEnd as string } : {}),
    };
  }
  return { stepOwners, completedSteps };
}
