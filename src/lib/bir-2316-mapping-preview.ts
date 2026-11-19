import { categorizeBir2316Lines, reconcileBir2316Categories, type Bir2316Line } from "./bir-2316-line-categories";
import { bir2316Centavos, type Bir2316ReviewSource } from "./bir-2316-reconciliation";
import type { WithholdingEntry } from "./bir-2316-withholding";
import type { CertificateSource } from "./bir-2316-certificate";

type ReleasedRecord = WithholdingEntry & { trace: unknown; periodStart: string; periodEnd: string; grossPay: string };
type ImportedRecord = { id: number; payDate: string; grossPay: string; basicSalary: string | null };
type SupplementaryRecord = {
  id: number; organizationId: number; employeeId: number; payrollRunId: number | null;
  earningType: string; amount: string; taxable: boolean; effectiveDate: string; status: string;
};
type EvidenceLine = { entryId: number; payDate: string; lineNumber: number; code: string; label: string; amount: string; treatment: string | null; detail: string | null };
type Period = { entryId: number; payDate: string; periodStart: string; periodEnd: string; grossPay: string; mwe: boolean | null; classification: string | null;
  region: string | null; wageOrder: string | null; dailyWage: string | null; minimumWage: string | null };

export type Bir2316MappingPreview = {
  periods: Period[];
  allowances: EvidenceLine[];
  leaveConversions: EvidenceLine[];
  imported: ImportedRecord[];
  proposed: Array<{ item: string; amount: string; description?: string }>;
  totalsMatch: boolean | null;
  issues: string[];
};

export type CertificateReviewSource = CertificateSource & { mappingPreview?: Bir2316MappingPreview };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
function recordedField(values: string[], prefix: string) {
  const matches = values.filter(value => value.startsWith(prefix));
  return matches.length === 1 ? matches[0].slice(prefix.length).trim() || null : null;
}

export function buildBir2316MappingPreview(
  scope: Pick<WithholdingEntry, "organizationId" | "employeeId" | "legalEntityId"> & { taxYear: number },
  records: readonly ReleasedRecord[],
  imported: readonly ImportedRecord[],
  annual: Pick<Bir2316ReviewSource, "grossCompensation" | "nonTaxable" | "taxableIncome"> & { mwe: boolean; unpaidThirteenth: unknown },
  supplementary: readonly SupplementaryRecord[] = [],
): Bir2316MappingPreview {
  const preview: Bir2316MappingPreview = {
    periods: [], allowances: [], leaveConversions: [], imported: [], proposed: [], totalsMatch: null, issues: [],
  };
  const released = records.filter(entry => entry.status === "Released");
  if (released.some(entry => entry.organizationId !== scope.organizationId || entry.employeeId !== scope.employeeId ||
      entry.legalEntityId !== scope.legalEntityId || !entry.payDate.startsWith(scope.taxYear + "-"))) {
    preview.issues.push("Released payroll includes records without matching legal-employer attribution. Review the employer binding before proposing categories.");
    return preview;
  }
  preview.imported = [...imported].sort((a, b) => a.payDate.localeCompare(b.payDate) || a.id - b.id);
  if (imported.length) preview.issues.push("Imported payroll has summary amounts only. Verify the legal employer and obtain the underlying category split before combining these periods.");
  if (released.length === 0) preview.issues.push("No released payroll lines are available for this employee and tax year.");

  const lines: Bir2316Line[] = [];
  const supplementaryById = new Map(supplementary.map(record => [record.id, record]));
  const seenCodes = new Set<string>();
  const repeatedCodes = new Set<string>();
  const matchedCodes = new Set<string>();
  let malformed = false;
  for (const entry of released.sort((a, b) => a.payDate.localeCompare(b.payDate) || a.id - b.id)) {
    const steps = strings(record(entry.trace).inputs);
    const mwe = recordedField(steps, "mwe=");
    preview.periods.push({
      entryId: entry.id, payDate: entry.payDate, periodStart: entry.periodStart, periodEnd: entry.periodEnd, grossPay: entry.grossPay,
      mwe: mwe === "true" ? true : mwe === "false" ? false : null,
      classification: recordedField(steps, "mweClassificationSource="), region: recordedField(steps, "mweClassificationRegion=") ?? recordedField(steps, "region="),
      wageOrder: recordedField(steps, "mweWageOrderReference="), dailyWage: recordedField(steps, "mweEmployeeDailyWage="),
      minimumWage: recordedField(steps, "mweStatutoryMinimumWage="),
    });
    if (!Array.isArray(entry.lineItems) || entry.lineItems.length === 0) { malformed = true; continue; }
    for (const [index, raw] of entry.lineItems.entries()) {
      const line = record(raw);
      const amount = bir2316Centavos(line.amount as string | number, true);
      if (typeof line.code !== "string" || !line.code.trim() || amount === null) { malformed = true; continue; }
      const notes = strings(line.notes);
      const code = line.code.toUpperCase();
      const label = typeof line.label === "string" ? line.label : code;
      const treatment = recordedField(notes, "Tax treatment: ");
      const type = recordedField(notes, "Type: ");
      if (seenCodes.has(code)) repeatedCodes.add(code);
      seenCodes.add(code);
      if (type === "allowance" && treatment === "taxable" && amount > 0 && /^EARN-[1-9]\d*$/.test(line.code)) {
        const source = supplementaryById.get(Number(code.slice(5)));
        if (source?.organizationId === scope.organizationId && source.employeeId === scope.employeeId &&
            source.payrollRunId === entry.runId && source.status === "settled" && source.earningType === "allowance" &&
            source.taxable === true && source.effectiveDate >= entry.periodStart && source.effectiveDate <= entry.periodEnd &&
            bir2316Centavos(source.amount) === amount) matchedCodes.add(code);
      }
      const pool = code.startsWith("DM-") && line.periodOtherBenefitsPool != null
        ? bir2316Centavos(line.periodOtherBenefitsPool as string | number) : undefined;
      if (pool === null) { malformed = true; continue; }
      lines.push({ code, label, amount: (amount / 100).toFixed(2), notes,
        benefitPool90k: line.benefitPool90k === true,
        benefitPoolKind: typeof line.benefitPoolKind === "string" ? line.benefitPoolKind : undefined,
        periodOtherBenefitsPool: pool === undefined ? undefined : pool / 100,
      });
      if (amount === 0) continue;
      const evidence = { entryId: entry.id, payDate: entry.payDate, lineNumber: index + 1, code, label, amount: (amount / 100).toFixed(2), treatment };
      if (type === "allowance" || type === "taxable_allowance" || type === "recurring_allowance") preview.allowances.push({ ...evidence, detail: type });
      if (code.startsWith("LEAVE_CONV-")) {
        preview.leaveConversions.push({ ...evidence, detail: notes.find(note => /^\d+(?:\.\d+)? days @ daily rate /.test(note)) ?? null });
      }
    }
  }
  if (preview.allowances.length) preview.issues.push("For allowances, verify the exemption basis or named taxable category against supporting payroll records.");
  if (preview.leaveConversions.length) preview.issues.push("For leave conversions, verify the leave type, annual days monetized and any taxable excess.");
  if (malformed) preview.issues.push("One or more released entries are missing usable payroll lines.");
  const classifications = new Set(preview.periods.map(period => period.mwe));
  if (classifications.has(null)) preview.issues.push("Minimum-wage status is missing or ambiguous in one or more payroll periods.");
  const mixed = classifications.has(true) && classifications.has(false);
  if (mixed) preview.issues.push("Released payroll shows mixed minimum-wage status. Review the period-level split before mapping annual categories.");
  const statusDiffers = classifications.size === 1 && !classifications.has(null) && !classifications.has(annual.mwe);
  if (statusDiffers) preview.issues.push("The recorded payroll status differs from the saved annualization.");
  if (released.length === 0 || malformed || mixed || statusDiffers || classifications.has(null) || imported.length > 0) return preview;

  const accrued = bir2316Centavos(annual.unpaidThirteenth as string | number);
  if (accrued !== null && accrued > 0) preview.issues.push("The saved annualization includes unpaid 13th-month accrual. Confirm the issuance-period payment records.");
  for (const code of repeatedCodes) matchedCodes.delete(code);
  const categories = categorizeBir2316Lines(lines, { mwe: annual.mwe, settledTaxableAllowanceCodes: matchedCodes });
  for (const line of categories.unmapped) preview.issues.push(line.code + " · " + line.reason);
  if (categories.issues.length > 0 && categories.unmapped.length === 0) preview.issues.push(...categories.issues);
  const grossCompensation = bir2316Centavos(annual.grossCompensation);
  const nonTaxable = bir2316Centavos(annual.nonTaxable);
  const taxableIncome = bir2316Centavos(annual.taxableIncome);
  if (categories.detailItems && grossCompensation !== null && nonTaxable !== null && taxableIncome !== null) {
    const issues = reconcileBir2316Categories(categories, {
      grossCompensation: grossCompensation / 100, nonTaxable: nonTaxable / 100, taxableIncome: taxableIncome / 100, mwe: annual.mwe,
    });
    preview.totalsMatch = issues.length === 0 && !annual.mwe ? true : issues.length > 0 ? false : null;
    preview.issues.push(...issues.map(issue => issue.replace(/^[A-Z_]+: /, "")));
    if (annual.mwe) preview.issues.push("For minimum-wage earners, separately reconcile the exempt and taxable split before accepting any category.");
  }
  preview.proposed = Object.entries(categories.items)
    .filter(([, amount]) => amount !== "0.00")
    .map(([item, amount]) => ({ item, amount, description: categories.descriptions[item as keyof typeof categories.descriptions] }));
  return preview;
}
