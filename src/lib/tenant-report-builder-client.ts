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


// A 2xx response is not proof of usable source data. Reject incomplete
// capability and preview envelopes instead of enabling stale exports.
export function verifyReportBuilderCapabilities(
  payload: unknown, organizationId: number,
): ReportBuilderCapabilities {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Report field permissions could not be verified.");
  }
  const fields = (payload as Record<string, unknown>).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("Report field permissions could not be verified.");
  }
  const source = fields as Record<string, unknown>;
  const verified = {} as Record<ReportBuilderDataset, string[]>;
  for (const dataset of ["people", "time", "payroll"] as const) {
    const allowed = source[dataset];
    if (!Array.isArray(allowed) || allowed.length > 12
      || !allowed.every(field => typeof field === "string" && field.length > 0)
      || new Set(allowed).size !== allowed.length) {
      throw new Error("Report field permissions are incomplete.");
    }
    verified[dataset] = allowed as string[];
  }
  return { organizationId, fields: verified };
}

export function verifyReportBuilderPreview(
  payload: unknown, dataset: ReportBuilderDataset, selectedFields: readonly string[],
): { columns: string[]; rows: string[][] } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Report preview is malformed.");
  }
  const result = payload as Record<string, unknown>;
  if (result.source !== dataset || !Array.isArray(result.columns)
    || result.columns.length !== selectedFields.length
    || !result.columns.every((column, index) => column === selectedFields[index])
    || !Array.isArray(result.rows) || result.rows.length > 5_000
    || !result.rows.every(row => Array.isArray(row)
      && row.length === selectedFields.length
      && row.every(cell => typeof cell === "string"))) {
    throw new Error("Report preview source, columns or rows could not be verified.");
  }
  return { columns: result.columns as string[], rows: result.rows as string[][] };
}

export function verifyReportBuilderCsvResponse(response: Response): void {
  const contentType = response.headers.get("content-type")?.trim().toLowerCase() ?? "";
  if (!/^text\/csv(?:\s*;|$)/.test(contentType)) {
    throw new Error("Report export did not return a verified CSV document.");
  }
}
