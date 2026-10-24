import type { DashboardData } from "@/components/workspace/types";
import { isValidDashboardSnapshot } from "@/lib/dashboard-read-recovery";

/** Shared initial-server/API boundary. Failure never becomes an empty dashboard. */
export function parseDashboardSnapshotRead(
  ok: boolean, value: unknown, organizationId: number,
): DashboardData | null {
  return ok && isValidDashboardSnapshot(value, organizationId) ? value : null;
}
