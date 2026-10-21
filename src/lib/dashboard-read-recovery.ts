import type { DashboardData } from "@/components/workspace/types";
import { verifiedDashboardAmount } from "@/lib/dashboard-presentation";

/** Source-only dashboard GET classification. Never display a server error body or treat a failed read as empty. */
export type DashboardReadFailureKind =
  "session" | "forbidden" | "server" | "network" | "invalid" | "scope";

export class DashboardReadError extends Error {
  constructor(public readonly kind: DashboardReadFailureKind, message: string) {
    super(message);
    this.name = "DashboardReadError";
  }
}

type DashboardFetch = (url: string, options: { cache: "no-store" }) => Promise<Response>;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function natural(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function matchingOrgRow(value: unknown, organizationId: number): value is Record<string, unknown> {
  return object(value) && value.organizationId === organizationId;
}
function validPayrollRun(value: unknown, organizationId: number): boolean {
  return matchingOrgRow(value, organizationId) && positive(value.id) &&
    typeof value.periodLabel === "string" && typeof value.status === "string" &&
    natural(value.employeeCount) && natural(value.exceptions) &&
    verifiedDashboardAmount(value.grossPay) !== null &&
    verifiedDashboardAmount(value.netPay) !== null;
}
function validPayrollEntry(value: unknown): boolean {
  // payroll_entries has no organization_id column: prove employer via an
  // authorized payrollRunId that belongs to this selected employer.
  return object(value) && positive(value.id) &&
    positive(value.employeeId) && typeof value.status === "string" &&
    verifiedDashboardAmount(value.netPay) !== null;
}

/** Validates a complete employer-scoped dashboard source, not only its top-level array names. */
export function isValidDashboardSnapshot(value: unknown, organizationId: number): value is DashboardData {
  if (!positive(organizationId) || !object(value)) return false;
  const selected = value.selectedOrganization;
  if (!object(selected) || selected.id !== organizationId ||
      typeof selected.name !== "string" || typeof selected.legalName !== "string") return false;

  const names = [
    "organizations", "employees", "tasks", "payrollRuns", "payrollEntries",
    "auditEvents", "plans", "templates", "advisories", "punches", "leaveRequests",
    "provisioning", "retroAdjustments",
  ];
  if (names.some((name) => !Array.isArray(value[name]))) return false;
  if (!(value.organizations as unknown[]).some((org) => object(org) && org.id === organizationId)) return false;
  const employees = value.employees as unknown[];
  const runs = value.payrollRuns as unknown[];
  const entries = value.payrollEntries as unknown[];
  if (!employees.every((employee) => matchingOrgRow(employee, organizationId) &&
      positive(employee.id) && typeof employee.status === "string")) return false;
  if (!runs.every((run) => validPayrollRun(run, organizationId))) return false;
  if (!entries.every((entry) => validPayrollEntry(entry))) return false;
  const ids = runs.map((run) => (run as Record<string, unknown>).id);
  if (new Set(ids).size !== ids.length) return false;
  const runIds = new Set(ids);
  if (entries.some((entry) => {
    const row = entry as Record<string, unknown>;
    return !positive(row.payrollRunId) || !runIds.has(row.payrollRunId);
  })) return false;
  return true;
}

export async function readAuthorizedDashboard(
  organizationId: number,
  request: DashboardFetch = fetch,
): Promise<DashboardData> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new DashboardReadError("scope", "The selected employer is invalid. Reload the secure workspace.");
  }

  let response: Response;
  try {
    response = await request(`/api/dashboard?organizationId=${organizationId}`, { cache: "no-store" });
  } catch {
    throw new DashboardReadError("network", "The workspace could not reconnect. Previously loaded information may be out of date.");
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new DashboardReadError("session", "Your session could not be confirmed. Sign in again to reload this workspace.");
    }
    if (response.status === 403) {
      throw new DashboardReadError("forbidden", "Access to this employer could not be confirmed. Reload to check your permissions.");
    }
    throw new DashboardReadError(
      "server",
      response.status >= 500
        ? "The workspace server could not load fresh records. Previously loaded information may be out of date."
        : "The workspace could not load fresh records. Previously loaded information may be out of date.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DashboardReadError("invalid", "The workspace returned an unreadable response. Existing information may be out of date.");
  }

  if (!isValidDashboardSnapshot(payload, organizationId)) {
    throw new DashboardReadError(
      "scope",
      "The dashboard response was missing required records or did not match the selected employer. Reload the secure workspace.",
    );
  }
  return payload;
}
