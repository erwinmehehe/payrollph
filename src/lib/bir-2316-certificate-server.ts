import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, legalEntities, organizations, separationRecords, yearEndAdjustments } from "@/db/schema";
import { decryptGovernmentId } from "./government-id-crypto";
import { historical2316Employer } from "./bir-2316-employer";
import { loadFinalPay2316Withholding, loadYearEnd2316Withholding, bir2316WithholdingEnabled } from "./bir-2316-withholding-server";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
import type { CertificateScope, CertificateSource } from "./bir-2316-certificate";
import type { AnnualizationResult } from "./annualization";
export const certificateDraftEnabled = () => criticalReleaseFlagEnabled("bir2316Certificate") && bir2316WithholdingEnabled();
export class CertificateSourceError extends Error {}
export async function load2316CertificateSource(scope: CertificateScope): Promise<CertificateSource> {
  if (!certificateDraftEnabled()) throw new CertificateSourceError("CERTIFICATE_DISABLED");
  return db.transaction(async tx => {
    const [employee] = await tx.select().from(employees).where(and(eq(employees.id, scope.employeeId), eq(employees.organizationId, scope.organizationId))).limit(1);
    const [organization] = await tx.select().from(organizations).where(eq(organizations.id, scope.organizationId)).limit(1);
    if (!employee || !organization) throw new CertificateSourceError("SOURCE_NOT_FOUND");
    const entities = await tx.select().from(legalEntities).where(eq(legalEntities.organizationId, scope.organizationId));
    let summary: CertificateSource["summary"], employer: ReturnType<typeof historical2316Employer>, periodTo: string, mwe: boolean, withholding: CertificateSource["withholding"];
    if (scope.separationId) {
      const [separation] = await tx.select().from(separationRecords).where(and(eq(separationRecords.id, scope.separationId), eq(separationRecords.organizationId, scope.organizationId), eq(separationRecords.employeeId, scope.employeeId))).limit(1);
      if (!separation || separation.status !== "released" || !separation.lastDay.startsWith(String(scope.taxYear) + "-")) throw new CertificateSourceError("RELEASED_SEPARATION_REQUIRED");
      const snapshot = separation.computationSnapshot as Record<string, unknown>;
      const annual = snapshot?.annualization as AnnualizationResult | undefined;
      if (!annual) throw new CertificateSourceError("ANNUALIZATION_SNAPSHOT_REQUIRED");
      employer = historical2316Employer({ organizationId: scope.organizationId, snapshot, entities, legacy: organization });
      summary = { grossCompensation: annual.grossCompensation, nonTaxable: annual.nonTaxable, taxableIncome: annual.taxableIncome, taxDue: annual.taxDue, withheldBeforeYearEnd: annual.taxWithheld, yearEndAdjustment: annual.adjustment };
      periodTo = separation.lastDay; mwe = annual.mwe === true;
      withholding = await loadFinalPay2316Withholding(scope.organizationId, scope.employeeId, scope.separationId, tx);
    } else {
      if (criticalReleaseFlagEnabled("multiEntity")) throw new CertificateSourceError("ENTITY_YEAR_END_DEFERRED");
      if (entities.length > 1 || (entities.length === 1 && !entities[0].active)) throw new CertificateSourceError("SINGLE_LEGAL_EMPLOYER_REQUIRED");
      const matches = await tx.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId, scope.organizationId), eq(yearEndAdjustments.employeeId, scope.employeeId), eq(yearEndAdjustments.taxYear, scope.taxYear)));
      if (matches.length !== 1) throw new CertificateSourceError("UNIQUE_ANNUALIZATION_REQUIRED");
      const adjustment = matches[0], legalEntityId = entities[0]?.id ?? null;
      employer = historical2316Employer({ organizationId: scope.organizationId, snapshot: { sourceFingerprint: { employeeLegalEntityId: legalEntityId } }, entities, legacy: organization });
      summary = { grossCompensation: adjustment.grossCompensation, nonTaxable: adjustment.nonTaxable, taxableIncome: adjustment.taxableIncome, taxDue: adjustment.taxDue, withheldBeforeYearEnd: adjustment.taxWithheld, yearEndAdjustment: adjustment.adjustment };
      periodTo = `${scope.taxYear}-12-31`; mwe = adjustment.mwe;
      withholding = await loadYearEnd2316Withholding({ ...scope, legalEntityId, adjustmentId: adjustment.id, before: adjustment.taxWithheld, expectedAdjustment: adjustment.adjustment }, tx);
    }
    if (!employer.ok) throw new CertificateSourceError(employer.code);
    const digits = (value: string | null) => (decryptGovernmentId(value) ?? "").replace(/\D/g, "");
    return { scope, employerName: employer.name, employerTin: employer.tin,
      employeeName: [employee.lastName, employee.firstName, employee.middleName].filter(Boolean).join(", "),
      employeeTin: `${digits(employee.tin)}-${digits(employee.tinBranchCode)}`, birthDate: employee.birthDate,
      periodFrom: employee.startDate > `${scope.taxYear}-01-01` ? employee.startDate : `${scope.taxYear}-01-01`, periodTo, mwe, summary, withholding };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
