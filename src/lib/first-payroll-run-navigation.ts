type Run = { id: number };
type Access = { role?: string; companyWide?: boolean } | null | undefined;

const viewers = ["owner", "admin", "bookkeeper", "payroll", "checker"];
const positiveId = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
};

/** Navigation only. The dashboard and every subsequent API retain their own authorization. */
export function firstPayrollRunHref(organizationId: number, runId: number): string {
  if (![organizationId, runId].every(id => Number.isSafeInteger(id) && id > 0)) {
    throw new Error("Invalid payroll navigation scope");
  }
  return `/app?organizationId=${organizationId}&workspacePage=Payroll&focusPayrollRunId=${runId}`;
}

/** Links to evidence workspaces only. Source IDs are displayed alongside these
 * links; no navigation link grants a record read or a payroll mutation. */
export function firstPayrollPreviewSourceHref(
  organizationId: number, page: import("./first-payroll-preview-read").FirstPayrollPreviewSource["page"],
): string {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("Invalid payroll source navigation scope");
  }
  return `/app?organizationId=${organizationId}&workspacePage=${encodeURIComponent(page)}`;
}

export function resolveFirstPayrollRunFocus(input: {
  enabled: boolean; demoMode: boolean; requestedPage: string | null;
  requestedOrganizationId: string | null; requestedRunId: string | null;
  organizationId: number; access: Access; authorizedRuns: readonly Run[];
}): number | null {
  if (!input.enabled || input.demoMode || input.requestedPage !== "Payroll" ||
      input.access?.companyWide !== true || !viewers.includes(input.access.role ?? "")) return null;
  if (positiveId(input.requestedOrganizationId) !== input.organizationId) return null;
  const id = positiveId(input.requestedRunId);
  return id !== null && input.authorizedRuns.some(run => run.id === id) ? id : null;
}
