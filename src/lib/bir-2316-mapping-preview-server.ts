import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { db } from "@/db";
import { historicalPayrollEntries, payrollEntries, payrollRuns, supplementaryEarnings } from "@/db/schema";
import { buildBir2316MappingPreview } from "./bir-2316-mapping-preview";
import { bir2316Centavos } from "./bir-2316-reconciliation";
import { releasedBir2316Withholding, type WithholdingEntry } from "./bir-2316-withholding";
import { computeSemiMonthlyWithholdingTax } from "./payroll-rules";
import { BIR_WITHHOLDING_RULE_PACKS, resolveEffectiveRulePack } from "./ph-statutory-rule-packs";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ZeroEvidenceEntry = WithholdingEntry & { trace: unknown; grossPay: string; deductions: string; netPay: string };
const amount = (value: unknown, signed = false) =>
  typeof value === "string" || typeof value === "number" ? bir2316Centavos(value, signed) : null;

/** The pinned engine omits zero lines. Require its cutoff evidence and a complete, balanced register. */
export function proveOmittedZeroWithholding(entry: ZeroEvidenceEntry): boolean {
  if (entry.status !== "Released" || !Array.isArray(entry.lineItems) || entry.lineItems.length === 0 ||
      !entry.trace || typeof entry.trace !== "object") return false;
  const trace = entry.trace as { ruleVersion?: unknown; inputs?: unknown };
  if (trace.ruleVersion !== "PH-2026.09" || !Array.isArray(trace.inputs)) return false;
  const field = (name: string) => {
    const matches = (trace.inputs as unknown[]).filter((value): value is string =>
      typeof value === "string" && value.startsWith(name + "="));
    return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
  };
  if (amount(field("uncollectedWithholding")) !== 0 || amount(field("mandatoryUncollected")) !== 0 ||
      amount(field("yearEndTaxAdjustment"), true) !== 0) return false;
  const taxable = amount(field("taxableCompensation"));
  const gross = amount(entry.grossPay), deductions = amount(entry.deductions), net = amount(entry.netPay);
  if (taxable === null || gross === null || gross === 0 || taxable > gross || deductions === null || net === null) return false;
  try {
    const rule = resolveEffectiveRulePack(BIR_WITHHOLDING_RULE_PACKS, entry.payDate, "BIR withholding");
    if (field("withholdingTable") !== rule.version || computeSemiMonthlyWithholdingTax(taxable / 100, false, entry.payDate) !== 0) return false;
  } catch { return false; }
  let earnings = 0, lineDeductions = 0;
  for (const line of entry.lineItems) {
    if (!line || typeof line !== "object" || typeof line.code !== "string" ||
        /^(?:WHT|YE-TAX|UNPAID_MANDATORY)/i.test(line.code)) return false;
    const value = amount(line.amount, true);
    if (value === null) return false;
    if (value >= 0) earnings += value;
    else lineDeductions -= value;
    if (!Number.isSafeInteger(earnings) || !Number.isSafeInteger(lineDeductions)) return false;
  }
  return earnings === gross && lineDeductions === deductions && gross - deductions === net;
}

/** Read within the existing annual certificate snapshot, after employer and employee attribution. */
export async function readBir2316MappingPreview(
  tx: Transaction,
  scope: Parameters<typeof buildBir2316MappingPreview>[0],
  annual: Parameters<typeof buildBir2316MappingPreview>[3],
  checkOmittedWithholding = false,
) {
  const { organizationId, employeeId, taxYear } = scope;
  const from = `${taxYear}-01-01`;
  const through = `${taxYear}-12-31`;
  const entries = await tx.select({
    id: payrollEntries.id, runId: payrollRuns.id, organizationId: payrollRuns.organizationId,
    employeeId: payrollEntries.employeeId, legalEntityId: payrollRuns.legalEntityId, payDate: payrollRuns.payDate,
    periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd, grossPay: payrollEntries.grossPay,
    deductions: payrollEntries.deductions, netPay: payrollEntries.netPay,
    status: payrollRuns.status, lineItems: payrollEntries.lineItems, trace: payrollEntries.trace,
  }).from(payrollEntries).innerJoin(payrollRuns, eq(payrollRuns.id, payrollEntries.payrollRunId)).where(and(
    eq(payrollRuns.organizationId, organizationId), eq(payrollEntries.employeeId, employeeId),
    checkOmittedWithholding ? undefined : eq(payrollRuns.status, "Released"),
    gte(payrollRuns.payDate, from), lte(payrollRuns.payDate, through),
  ));
  const imported = await tx.select({
    id: historicalPayrollEntries.id, payDate: historicalPayrollEntries.payDate,
    grossPay: historicalPayrollEntries.grossPay, basicSalary: historicalPayrollEntries.basicSalary,
  }).from(historicalPayrollEntries).where(and(
    eq(historicalPayrollEntries.organizationId, organizationId), eq(historicalPayrollEntries.employeeId, employeeId),
    gte(historicalPayrollEntries.payDate, from), lte(historicalPayrollEntries.payDate, through),
  ));
  const releasedRunIds = [...new Set(entries.filter(entry => entry.status === "Released" && entry.legalEntityId === scope.legalEntityId)
    .map(entry => entry.runId))];
  const allowances = releasedRunIds.length === 0 ? [] : await tx.select({
    id: supplementaryEarnings.id, organizationId: supplementaryEarnings.organizationId, employeeId: supplementaryEarnings.employeeId,
    payrollRunId: supplementaryEarnings.payrollRunId, earningType: supplementaryEarnings.earningType, amount: supplementaryEarnings.amount,
    taxable: supplementaryEarnings.taxable, effectiveDate: supplementaryEarnings.effectiveDate, status: supplementaryEarnings.status,
  }).from(supplementaryEarnings).where(and(
    eq(supplementaryEarnings.organizationId, organizationId), eq(supplementaryEarnings.employeeId, employeeId),
    eq(supplementaryEarnings.earningType, "allowance"), eq(supplementaryEarnings.taxable, true),
    eq(supplementaryEarnings.status, "settled"), inArray(supplementaryEarnings.payrollRunId, releasedRunIds),
  ));
  const preview = buildBir2316MappingPreview(scope, entries, imported, annual, allowances);
  // Normalize only for the existing withholding validator. Persisted ledger lines are untouched.
  const zero = checkOmittedWithholding
    ? releasedBir2316Withholding({ ...scope, before: "0.00", expectedAdjustment: "0.00", historicalCount: imported.length },
      entries.map(entry => proveOmittedZeroWithholding(entry)
        ? { ...entry, lineItems: [...entry.lineItems as unknown[], { code: "WHT", amount: "0.00" }] } : entry))
    : undefined;
  return { preview, zeroWithholding: zero?.actualPresentWithheld === "0.00" && zero.issues.length === 0 ? zero : undefined };
}
