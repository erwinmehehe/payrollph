"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DashboardData } from "@/components/workspace/types";
import { DashboardReadError, readAuthorizedDashboard } from "@/lib/dashboard-read-recovery";

/** Keep async generation refs outside render-time workspace action / palette derivation. */
export function useDashboardReadRecovery(
  organizationId: number,
  setData: Dispatch<SetStateAction<DashboardData>>,
) {
  const [refreshIssue, setRefreshIssue] = useState<DashboardReadError | null>(null);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const dashboardReadVersion = useRef(0);

  useEffect(() => () => {
    dashboardReadVersion.current += 1;
  }, []);

  const refresh = useCallback(async (requestedOrganizationId = organizationId) => {
    const readVersion = ++dashboardReadVersion.current;
    setRefreshLoading(true);
    setRefreshIssue(null);
    try {
      const next = await readAuthorizedDashboard(requestedOrganizationId);
      // Older in-flight reads cannot overwrite a newer authorized employer snapshot.
      if (readVersion !== dashboardReadVersion.current) {
        throw new DashboardReadError("scope", "A newer workspace read superseded this request.");
      }
      setData(next);
    } catch (cause) {
      if (readVersion === dashboardReadVersion.current) {
        setRefreshIssue(cause instanceof DashboardReadError
          ? cause : new DashboardReadError("network", "Could not refresh the workspace."));
      }
      throw cause;
    } finally {
      if (readVersion === dashboardReadVersion.current) setRefreshLoading(false);
    }
  }, [organizationId, setData, setRefreshIssue, setRefreshLoading]);

  return { refresh, refreshIssue, refreshLoading };
}
