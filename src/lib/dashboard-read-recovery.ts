import type { DashboardData } from "@/components/workspace/types";

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

function isValidDashboardSnapshot(value: unknown, organizationId: number): value is DashboardData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const selected = record.selectedOrganization;
  if (!selected || typeof selected !== "object" ||
      (selected as Record<string, unknown>).id !== organizationId) return false;
  // Do not silently coerce missing source collections into empty employee, task or payroll lists.
  return Array.isArray(record.employees) && Array.isArray(record.organizations) &&
    Array.isArray(record.tasks) && Array.isArray(record.payrollRuns);
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
