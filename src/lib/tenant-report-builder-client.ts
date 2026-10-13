export type ReportBuilderDataset = "people" | "time" | "payroll";
export type ReportBuilderCapabilities = {
  organizationId: number;
  fields: Record<ReportBuilderDataset, string[]>;
};

/** Capabilities never cross tenant boundaries, even while a new GET is pending. */
export function authorizedReportBuilderSelection(
  organizationId: number,
  dataset: ReportBuilderDataset,
  selected: readonly string[],
  groupBy: string,
  capabilities: ReportBuilderCapabilities | null,
) {
  const allowed = capabilities?.organizationId === organizationId
    ? capabilities.fields[dataset] ?? [] : [];
  const fields = selected.filter(field => allowed.includes(field));
  const grouping = groupBy && fields.includes(groupBy) ? groupBy : null;
  return { allowed, fields, groupBy: grouping };
}

/** Preview and audited CSV permission are bound to the complete active selection. */
export function tenantReportPreviewKey(input: {
  organizationId: number;
  dataset: ReportBuilderDataset;
  fields: readonly string[];
  groupBy: string | null;
  startDate: string;
  endDate: string;
}): string {
  return JSON.stringify([
    input.organizationId, input.dataset, [...input.fields], input.groupBy,
    input.startDate, input.endDate,
  ]);
}
