/**
 * Exact export-kind whitelist. An unknown selector must NEVER fall through to
 * the full JSON payload, which contains sensitive payroll and audit records.
 * This boundary applies even when multi-entity is disabled.
 */
export const COMPANY_EXPORT_KINDS = ["employees", "payroll", "audit", "all"] as const;
export type CompanyExportKind = typeof COMPANY_EXPORT_KINDS[number];

export function parseCompanyExportKind(value: string | null): CompanyExportKind | null {
  if (value === null) return "all";
  return COMPANY_EXPORT_KINDS.find(kind => kind === value) ?? null;
}
