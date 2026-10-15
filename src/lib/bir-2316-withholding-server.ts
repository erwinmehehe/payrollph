import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employees, historicalPayrollEntries, payrollEntries, payrollRuns, separationRecords, yearEndAdjustments } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
import { releasedBir2316Withholding, finalPayBir2316Withholding, unknownBir2316Withholding, type WithholdingScope } from "./bir-2316-withholding";
import { bir2316Centavos } from "./bir-2316-reconciliation";
import { sameFinalPaySource } from "./final-pay-source-fingerprint";
export const bir2316WithholdingEnabled = () => criticalReleaseFlagEnabled("bir2316Reconciliation") && criticalReleaseFlagEnabled("bir2316WithholdingEvidence");
type Scope = { organizationId: number; employeeId: number; taxYear: number; legalEntityId: number | null; throughDate?: string };
type Reader = Pick<typeof db, "select">;
async function ledger(reader: Reader, scope: Scope) {
  const through = scope.throughDate ?? `${scope.taxYear}-12-31`;
  const entries = await reader.select({ id: payrollEntries.id, runId: payrollRuns.id,
    organizationId: payrollRuns.organizationId, employeeId: payrollEntries.employeeId,
    legalEntityId: payrollRuns.legalEntityId, payDate: payrollRuns.payDate, status: payrollRuns.status,
    periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd,
    grossPay: payrollEntries.grossPay, lineItems: payrollEntries.lineItems, trace: payrollEntries.trace,
  }).from(payrollEntries).innerJoin(payrollRuns, eq(payrollRuns.id, payrollEntries.payrollRunId))
    .innerJoin(employees, and(eq(employees.id, payrollEntries.employeeId), eq(employees.organizationId, scope.organizationId)))
    .where(and(eq(payrollRuns.organizationId, scope.organizationId), eq(payrollEntries.employeeId, scope.employeeId),
      gte(payrollRuns.payDate, `${scope.taxYear}-01-01`), lte(payrollRuns.payDate, through)));
  const historical = await reader.select({ id: historicalPayrollEntries.id }).from(historicalPayrollEntries).where(and(
    eq(historicalPayrollEntries.organizationId, scope.organizationId), eq(historicalPayrollEntries.employeeId, scope.employeeId),
    gte(historicalPayrollEntries.payDate, `${scope.taxYear}-01-01`), lte(historicalPayrollEntries.payDate, through)));
  return { entries, historicalCount: historical.length };
}
export async function loadYearEnd2316Withholding(scope: Scope & { adjustmentId: number; before: string; expectedAdjustment: string }) {
  if (!bir2316WithholdingEnabled()) return undefined;
  return db.transaction(async tx => {
    const [source] = await tx.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.id, scope.adjustmentId),
      eq(yearEndAdjustments.organizationId, scope.organizationId), eq(yearEndAdjustments.employeeId, scope.employeeId), eq(yearEndAdjustments.taxYear, scope.taxYear))).limit(1);
    if (!source || bir2316Centavos(source.taxWithheld) !== bir2316Centavos(scope.before) ||
        bir2316Centavos(source.adjustment, true) !== bir2316Centavos(scope.expectedAdjustment, true)) return unknownBir2316Withholding("WITHHOLDING_SOURCE_CHANGED");
    const data = await ledger(tx, scope);
    return releasedBir2316Withholding({ ...scope, historicalCount: data.historicalCount,
      boundRunId: source.payrollRunId }, data.entries);
  }, { isolationLevel: "repeatable read", accessMode: "read only" }).catch(() => unknownBir2316Withholding("WITHHOLDING_LOOKUP_UNAVAILABLE"));
}
export async function loadFinalPay2316Withholding(organizationId: number, employeeId: number, separationId: number) {
  if (!bir2316WithholdingEnabled()) return undefined;
  return db.transaction(async tx => {
    const [source] = await tx.select().from(separationRecords).where(and(eq(separationRecords.id, separationId),
      eq(separationRecords.organizationId, organizationId), eq(separationRecords.employeeId, employeeId))).limit(1);
    if (!source) return unknownBir2316Withholding("FINAL_PAY_SOURCE_MISSING");
    const snapshot = source.computationSnapshot as Record<string, unknown>;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return unknownBir2316Withholding("FINAL_PAY_FROZEN_SCOPE_MISSING");
    const fingerprint = snapshot.sourceFingerprint as Record<string, unknown> | undefined;
    const annual = snapshot.annualization as { taxWithheld?: unknown; adjustment?: unknown } | undefined;
    if (!fingerprint || !(fingerprint.employeeLegalEntityId === null || (Number.isInteger(fingerprint.employeeLegalEntityId) && Number(fingerprint.employeeLegalEntityId) > 0)) || !annual)
      return unknownBir2316Withholding("FINAL_PAY_FROZEN_SCOPE_MISSING");
    const scope: WithholdingScope = { organizationId, employeeId, taxYear: Number(source.lastDay.slice(0, 4)),
      legalEntityId: fingerprint.employeeLegalEntityId as number | null, throughDate: source.lastDay,
      before: annual.taxWithheld, expectedAdjustment: "0.00", historicalCount: 0, allowEmptyOpening: true };
    const data = await ledger(tx, scope);
    const releasedEntries = data.entries.filter(entry => entry.status === "Released");
    // The final-pay approval freezes the full source row, not just withholding codes.
    // A changed period, gross amount or trace can invalidate its approved calculation
    // even when the WHT lines and the identifiers remain byte-identical.
    if (!Array.isArray(fingerprint.released) || fingerprint.released.length !== releasedEntries.length ||
        releasedEntries.some(entry => !(fingerprint.released as unknown[]).some(raw => {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
          const frozen = raw as Record<string, unknown>;
          const frozenGross = bir2316Centavos(frozen.grossPay as string | number);
          const ledgerGross = bir2316Centavos(entry.grossPay);
          return frozen.entryId === entry.id && frozen.runId === entry.runId &&
            frozen.payDate === entry.payDate && frozen.periodStart === entry.periodStart &&
            frozen.periodEnd === entry.periodEnd && frozenGross !== null &&
            ledgerGross !== null && frozenGross === ledgerGross &&
            sameFinalPaySource({ lineItems: frozen.lineItems, trace: frozen.trace },
              { lineItems: entry.lineItems, trace: entry.trace });
        })))
      return unknownBir2316Withholding("FINAL_PAY_FROZEN_LEDGER_CHANGED");
    const baseline = releasedBir2316Withholding({ ...scope, historicalCount: data.historicalCount }, data.entries);
    return finalPayBir2316Withholding({ ...source, taxYear: scope.taxYear, baseline, before: annual.taxWithheld,
      expectedAdjustment: annual.adjustment, appliedTaxCollection: snapshot.appliedTaxCollection,
      unpaidTaxWithholding: snapshot.unpaidTaxWithholding });
  }, { isolationLevel: "repeatable read", accessMode: "read only" }).catch(() => unknownBir2316Withholding("WITHHOLDING_LOOKUP_UNAVAILABLE"));
}
