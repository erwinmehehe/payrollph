export type PayrollEmployerOption = {
  id: number;
  code: string;
  displayName: string;
  primaryEntity: boolean;
  active?: boolean;
};

export function payrollEmployerSetupDestination(input: {
  role: string | null;
  companyWide: boolean;
  demo: boolean;
  multiEntity: boolean;
  pages: readonly string[];
}): "Entities" | "Enterprise" | null {
  if (input.demo || !input.companyWide || !["owner", "admin", "bookkeeper"].includes(input.role ?? "")) return null;
  const page = input.multiEntity ? "Entities" : "Enterprise";
  return input.pages.includes(page) ? page : null;
}

/** Selector reads never create an employer and never turn a failed read into empty setup. */
export async function readPayrollEmployerOptions(
  organizationId: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PayrollEmployerOption[]> {
  const response = await fetcher(`/api/legal-entities?organizationId=${organizationId}&mode=selector`, {
    cache: "no-store", signal,
  });
  if (!response.ok) throw new Error("Could not load legal employers. Retry before creating payroll.");
  const body = await response.json();
  if (!body || !Array.isArray(body.legalEntities)) throw new Error("Could not verify the legal-employer list.");
  const seen = new Set<number>();
  for (const row of body.legalEntities) {
    if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id) ||
        typeof row.code !== "string" || !row.code.trim() ||
        typeof row.displayName !== "string" || !row.displayName.trim() ||
        typeof row.primaryEntity !== "boolean" ||
        (row.active !== undefined && typeof row.active !== "boolean")) {
      throw new Error("Could not verify the legal-employer list.");
    }
    seen.add(row.id);
  }
  return body.legalEntities.filter((row: PayrollEmployerOption) => row.active !== false);
}
