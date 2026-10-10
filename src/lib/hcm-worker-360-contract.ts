import type { Worker360EventPreview, Worker360Selection } from "@/lib/hcm-worker-360-projection";

/** Small authorized API envelope; no wages, account, government IDs or notes. */
export type Worker360Summary = {
  tenantId: number;
  employeeId: number;
  asOfDate: string;
  observedAt: string;
  worker: {
    source: "employees";
    id: number;
    employeeNo: string;
    name: string;
    /** Mutable employee fields: the current snapshot, NOT an as-of assertion. */
    currentTitle: string;
    currentStatus: string;
    startedOn: string;
  };
  primaryAssignment: {
    source: "position_assignments";
    selection: Worker360Selection;
  };
  employmentEvents: {
    source: "worker_employment_events";
    preview: Worker360EventPreview;
  };
};
