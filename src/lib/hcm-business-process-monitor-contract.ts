import type {
  BpMonitorInstance, BpMonitorStep, HcmBpMonitorFilter,
} from "@/lib/hcm-business-process-monitor-projection";

export type BpMonitorListResponse = {
  tenantId: number;
  source: "hcm_business_process_instances";
  statusFilter: HcmBpMonitorFilter;
  observedAt: string;
  items: BpMonitorInstance[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type BpMonitorDetailResponse = {
  tenantId: number;
  source: "hcm_business_process_instance_steps";
  observedAt: string;
  instance: BpMonitorInstance;
  steps: BpMonitorStep[];
  stepsPartial: boolean;
  hasMoreSteps: boolean;
};
