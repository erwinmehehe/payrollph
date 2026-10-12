/** Safe for browser use: no DB or payroll-engine imports. */
export type FirstPayrollPreviewRow = {
  employeeId: number;
  employeeName: string;
  employeeNo: string;
  gross: string | null;
  sss: string | null;
  philHealth: string | null;
  pagIbig: string | null;
  withholding: string | null;
  net: string | null;
  status: "ready" | "blocked";
  blockers: string[];
};

export type FirstPayrollPreview = {
  organizationId: number;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  ruleVersion: string;
  previewReady: boolean;
  readOnly: true;
  totals: { gross: string; sss: string; philHealth: string; pagIbig: string; withholding: string; net: string } | null;
  blockers: string[];
  rows: FirstPayrollPreviewRow[];
  limitations: string[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
