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

export function validFirstPayrollPreviewDates(start: string, end: string, pay: string) {
  const isReal = (value: string) => DATE.test(value)
    && !Number.isNaN(Date.parse(value + "T00:00:00Z"))
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  if (![start, end, pay].every(isReal) || start > end || pay < end) return false;
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86_400_000) + 1 <= 16;
}
