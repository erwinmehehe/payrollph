/**
 * Client-side presentation state for the already server-authorized report builder.
 * These helpers confer no data permissions: only GET /api/hcm-report-builder's
 * allowed-field list and POST's role/tenant checks can authorize a report.
 */
export type ReportPreviewSelection = Readonly<{
  dataset: "people" | "time" | "payroll";
  fields: readonly string[];
  groupBy: string | null;
  departmentFilter: string;
  startDate: string;
  endDate: string;
}>;

export type ReportFieldChoice = Readonly<{ dataset: string; key: string }>;

export function selectedAuthorizedReportFields(
  dataset: ReportPreviewSelection["dataset"],
  requested: readonly string[],
  allowed: readonly ReportFieldChoice[],
): string[] {
  const keys = new Set(allowed.filter((field) => field.dataset === dataset).map((field) => field.key));
  return [...new Set(requested)].filter((key) => keys.has(key));
}

/** Stable identity of the actual API query, never of a similarly labeled view. */
export function reportPreviewKey(input: ReportPreviewSelection): string {
  return JSON.stringify({
    dataset: input.dataset,
    fields: [...input.fields],
    groupBy: input.groupBy || null,
    department: input.departmentFilter.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
  });
}

/** A changed query must not expose an old preview as the current result. */
export function currentReportPreview<T>(
  candidate: Readonly<{ key: string; result: T }> | null,
  activeKey: string,
): T | null {
  return candidate?.key === activeKey ? candidate.result : null;
}
