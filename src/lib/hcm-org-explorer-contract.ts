import type {
  OrgExplorerProjection, PositionHistoryPreview,
} from "@/lib/hcm-org-explorer-projection";

export type HcmOrgExplorerResponse = OrgExplorerProjection & {
  tenantId: number;
  observedAt: string;
  currentBusinessDate: string;
  /** These reflect the current source; they are not reconstructed historical data. */
  sources: ["org_units", "positions", "job_profiles"];
};

export type HcmPositionHistoryResponse = {
  tenantId: number;
  positionId: number;
  observedAt: string;
  position: {
    source: "positions";
    id: number;
    code: string;
    status: string;
    currentJobTitle: string | null;
  };
  history: {
    source: "position_assignments";
    preview: PositionHistoryPreview;
  };
};
