import type { MonitorItem } from "@/lib/hcm-bp-monitor-projection";

/** Authorized, tenant-scoped, read-only HCM monitor page. */
export type HcmMonitorPage = {
  tenantId: number;
  observedAt: string;
  pageSize: number;
  items: MonitorItem[];
  hasMore: boolean;
  nextCursor: number | null;
};
