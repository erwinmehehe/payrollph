import { bir2316Centavos } from "./bir-2316-reconciliation";
export type Bir2316Withholding = { actualPresentWithheld: string | null; appliedAdjustment: string | null; issues: string[]; entryIds: number[] };
export type WithholdingEntry = { id: number; runId: number; organizationId: number; employeeId: number; legalEntityId: number | null; payDate: string; status: string; lineItems: unknown };
export type WithholdingScope = { organizationId: number; employeeId: number; legalEntityId: number | null; taxYear: number; throughDate?: string; before: unknown; expectedAdjustment: unknown; adjustmentId?: number; boundRunId?: number | null; historicalCount: number; allowEmptyOpening?: boolean };
const cents = (v: unknown, signed = false) => bir2316Centavos(v as string, signed);
const formatted = (v: number) => (v / 100).toFixed(2);
export const unknownBir2316Withholding = (reason: string): Bir2316Withholding => ({ actualPresentWithheld: null, appliedAdjustment: null, issues: [reason], entryIds: [] });
/** Reads exact payroll codes/signs; does not infer tax from labels or tax due. */
export function releasedBir2316Withholding(scope: WithholdingScope, entries: WithholdingEntry[]): Bir2316Withholding {
  const unknown = unknownBir2316Withholding;
  if (scope.historicalCount !== 0) return unknown("IMPORTED_WITHHOLDING_UNVERIFIED");
  const before = cents(scope.before), expected = cents(scope.expectedAdjustment, true);
  if (before === null || expected === null || !Number.isInteger(scope.taxYear)) return unknown("WITHHOLDING_SOURCE_INVALID");
  let actual = 0, applied = 0, matched = 0;
  const ids = new Set<number>();
  for (const entry of entries) {
    if (entry.organizationId !== scope.organizationId || entry.employeeId !== scope.employeeId ||
        entry.legalEntityId !== scope.legalEntityId || entry.payDate.slice(0, 4) !== String(scope.taxYear) ||
        (scope.throughDate && entry.payDate > scope.throughDate)) return unknown("WITHHOLDING_SCOPE_MISMATCH");
    if (entry.status !== "Released") continue;
    if (ids.has(entry.id) || !Number.isInteger(entry.id) || !Array.isArray(entry.lineItems)) return unknown("WITHHOLDING_ENTRY_INVALID");
    ids.add(entry.id);
    let regular = 0;
    for (const raw of entry.lineItems) {
      if (!raw || typeof raw !== "object") return unknown("WITHHOLDING_LINE_INVALID");
      const line = raw as { code?: unknown; amount?: unknown; label?: unknown };
      const code = String(line.code ?? "");
      if (code === "WHT" || /^YE-TAX-\d+$/.test(code) || code === "YE-TAX") {
        const value = cents(line.amount, true);
        if (value === null || (code === "WHT" && value > 0) || (code === "YE-TAX" && value !== 0)) return unknown("WITHHOLDING_LINE_INVALID");
        if (code === "WHT") regular++;
        actual -= value;
        if (scope.adjustmentId && code === "YE-TAX-" + scope.adjustmentId) {
          if (entry.runId !== scope.boundRunId) return unknown("WITHHOLDING_BINDING_MISMATCH");
          matched++; applied -= value;
        }
      } else if (/^(?:WHT|YE-TAX|TAX|WITHHOLD)/i.test(code) || /withholding tax|income tax|tax refund|tax collection/i.test(String(line.label ?? ""))) return unknown("WITHHOLDING_CODE_UNVERIFIED");
      if (!Number.isSafeInteger(actual) || !Number.isSafeInteger(applied)) return unknown("WITHHOLDING_TOTAL_INVALID");
    }
    if (regular !== 1) return unknown("WITHHOLDING_WHT_MISSING_OR_DUPLICATE");
  }
  if ((ids.size === 0 && !(scope.allowEmptyOpening && before === 0 && expected === 0)) || actual < 0) return unknown("WITHHOLDING_LEDGER_MISSING");
  if (scope.boundRunId && matched !== 1) return { actualPresentWithheld: formatted(actual), appliedAdjustment: null, issues: ["WITHHOLDING_SETTLEMENT_LINE_MISSING"], entryIds: [...ids] };
  if (!scope.boundRunId && expected !== 0) return { actualPresentWithheld: formatted(actual), appliedAdjustment: null, issues: ["WITHHOLDING_SETTLEMENT_UNBOUND"], entryIds: [...ids] };
  if (actual - applied !== before) return unknown("WITHHOLDING_OPENING_VARIANCE");
  return { actualPresentWithheld: formatted(actual), appliedAdjustment: formatted(applied), issues: applied === expected ? [] : ["UNSETTLED_ADJUSTMENT"], entryIds: [...ids] };
}
/** Frozen final-pay allocation is a posted release record, not bank/BIR proof. */
export function finalPayBir2316Withholding(input: {
  baseline: Bir2316Withholding; before: unknown; expectedAdjustment: unknown;
  status: string; releasedAt: unknown; releaseReference: unknown;
  preparedByUserId: number | null; approvedByUserId: number | null; releasedByUserId: number | null;
  appliedTaxCollection: unknown; unpaidTaxWithholding: unknown; taxAdjustment: unknown;
  grossFinalPay: unknown; netFinalPay: unknown; finalStatutoryDeductions: unknown; loanDeductions: unknown;
}): Bir2316Withholding {
  const unknown = unknownBir2316Withholding;
  const actors = [input.preparedByUserId, input.approvedByUserId, input.releasedByUserId];
  const releaseTime = input.releasedAt instanceof Date ? input.releasedAt.getTime() : Date.parse(String(input.releasedAt ?? ""));
  if (input.status !== "released" || !Number.isFinite(releaseTime) || String(input.releaseReference ?? "").trim().length < 8 ||
      actors.some(id => !Number.isInteger(id) || Number(id) <= 0) || new Set(actors).size !== 3) return unknown("FINAL_PAY_RELEASE_UNVERIFIED");
  const before = cents(input.before), expected = cents(input.expectedAdjustment, true);
  const collected = cents(input.appliedTaxCollection), unpaid = cents(input.unpaidTaxWithholding);
  const adjustment = cents(input.taxAdjustment, true), gross = cents(input.grossFinalPay), net = cents(input.netFinalPay);
  const statutory = cents(input.finalStatutoryDeductions), loans = cents(input.loanDeductions);
  if ([before, expected, collected, unpaid, adjustment, gross, net, statutory, loans].some(v => v === null)) return unknown("FINAL_PAY_ALLOCATION_UNVERIFIED");
  if (input.baseline.issues.length || cents(input.baseline.actualPresentWithheld) !== before) return unknown("FINAL_PAY_OPENING_LEDGER_UNVERIFIED");
  if (adjustment !== -expected! || collected! + unpaid! !== Math.max(0, expected!) ||
      collected! > gross! + Math.max(0, -expected!) ||
      net !== gross! + Math.max(0, -expected!) - collected! - statutory! - loans!) return unknown("FINAL_PAY_ALLOCATION_VARIANCE");
  const applied = expected! < 0 ? expected! : collected!;
  if (!Number.isSafeInteger(before! + applied) || before! + applied < 0) return unknown("FINAL_PAY_ALLOCATION_VARIANCE");
  return { actualPresentWithheld: formatted(before! + applied), appliedAdjustment: formatted(applied), issues: unpaid! > 0 ? ["UNSETTLED_ADJUSTMENT"] : [], entryIds: input.baseline.entryIds };
}
