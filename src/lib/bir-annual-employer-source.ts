import { createHash } from "node:crypto";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  birWithholdingRemittanceBatches, employees, historicalPayrollEntries,
  legalEntities, payrollEntries, payrollRuns, yearEndAdjustments,
} from "@/db/schema";
import { reconcileBirEmployerYear } from "@/lib/bir-employer-reconciliation";
import { decryptGovernmentId } from "@/lib/government-id-crypto";

/**
 * The ONE employer/year snapshot used for preview and candidate generation.
 * Auth and company-wide/MFA checks are mandatory in every caller BEFORE this
 * service runs. Never return the decrypted employee IDs from a GET endpoint.
 */
export async function loadBirAnnualEmployerSource(
  organizationId: number, legalEntityId: number, taxYear: number,
) {
  const [employer] = await db.select({
    id: legalEntities.id, code: legalEntities.code, legalName: legalEntities.legalName,
    birTin: legalEntities.birTin, birBranchCode: legalEntities.birBranchCode,
  }).from(legalEntities).where(and(
    eq(legalEntities.id, legalEntityId), eq(legalEntities.organizationId, organizationId),
    eq(legalEntities.active, true),
  )).limit(1);
  if (!employer) return null;

  const from = taxYear + "-01-01";
  const to = taxYear + "-12-31";
  const [runs, yearEnd, history, batches] = await Promise.all([
    db.select({
      id: payrollRuns.id, legalEntityId: payrollRuns.legalEntityId,
      payDate: payrollRuns.payDate, status: payrollRuns.status,
    }).from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      gte(payrollRuns.payDate, from), lte(payrollRuns.payDate, to),
    )),
    db.select({
      annual: yearEndAdjustments,
      employeeId: employees.id, employeeNo: employees.employeeNo,
      firstName: employees.firstName, middleName: employees.middleName,
      lastName: employees.lastName, nationality: employees.nationality,
      employeeLegalEntityId: employees.legalEntityId,
      encryptedTin: employees.tin, encryptedBranch: employees.tinBranchCode,
      startDate: employees.startDate,
    }).from(yearEndAdjustments).innerJoin(employees, and(
      eq(yearEndAdjustments.employeeId, employees.id),
      eq(employees.organizationId, organizationId),
    )).where(and(
      eq(yearEndAdjustments.organizationId, organizationId),
      eq(yearEndAdjustments.taxYear, taxYear),
    )),
    db.select({ employeeId: historicalPayrollEntries.employeeId })
      .from(historicalPayrollEntries).where(and(
        eq(historicalPayrollEntries.organizationId, organizationId),
        gte(historicalPayrollEntries.payDate, from),
        lte(historicalPayrollEntries.payDate, to),
      )),
    db.select({
      applicableMonth: birWithholdingRemittanceBatches.applicableMonth,
      status: birWithholdingRemittanceBatches.status,
      expectedTaxWithheld: birWithholdingRemittanceBatches.expectedTaxWithheld,
    }).from(birWithholdingRemittanceBatches).where(and(
      eq(birWithholdingRemittanceBatches.organizationId, organizationId),
      eq(birWithholdingRemittanceBatches.legalEntityId, employer.id),
      gte(birWithholdingRemittanceBatches.applicableMonth, taxYear + "-01"),
      lte(birWithholdingRemittanceBatches.applicableMonth, taxYear + "-12"),
    )),
  ]);
  const releasedIds = runs.filter(run => run.status === "Released").map(run => run.id);
  const entries = releasedIds.length ? await db.select({
    payrollRunId: payrollEntries.payrollRunId, employeeId: payrollEntries.employeeId,
    grossPay: payrollEntries.grossPay, lineItems: payrollEntries.lineItems,
  }).from(payrollEntries).where(inArray(payrollEntries.payrollRunId, releasedIds)) : [];

  const reconciliation = reconcileBirEmployerYear({
    taxYear, legalEntityId: employer.id, runs, entries,
    annualized: yearEnd.map(row => ({
      employeeId: row.annual.employeeId, employeeNo: row.employeeNo,
      firstName: row.firstName, lastName: row.lastName,
      employeeLegalEntityId: row.employeeLegalEntityId,
      mwe: row.annual.mwe, grossCompensation: row.annual.grossCompensation,
      nonTaxable: row.annual.nonTaxable, taxableIncome: row.annual.taxableIncome,
      taxDue: row.annual.taxDue, taxWithheld: row.annual.taxWithheld,
      adjustment: row.annual.adjustment, status: row.annual.status,
    })),
    historicalEmployeeIds: history.map(row => row.employeeId),
    monthlyBatches: batches,
  });

  const normalizedDigits = (value: string | null | undefined) =>
    (value ?? "").replace(/\D/g, "");
  const employeeSources = yearEnd.map(row => ({
    employeeId: row.employeeId, employeeNo: row.employeeNo,
    firstName: row.firstName, middleName: row.middleName ?? "",
    lastName: row.lastName, nationality: row.nationality,
    tin: normalizedDigits(decryptGovernmentId(row.encryptedTin)),
    branch: normalizedDigits(decryptGovernmentId(row.encryptedBranch)),
    mwe: row.annual.mwe, taxableIncome: String(row.annual.taxableIncome),
    taxDue: String(row.annual.taxDue), startDate: row.startDate,
    legalEntityId: row.employeeLegalEntityId,
  }));

  // Bind the review to protected employee identities as well as payroll.
  // A name, TIN, branch or nationality change invalidates a prior preview.
  const sourceDigest = createHash("sha256").update(JSON.stringify({
    ledger: reconciliation.sourceDigest,
    employerTin: normalizedDigits(employer.birTin),
    employerBranch: normalizedDigits(employer.birBranchCode),
    employees: [...employeeSources].sort((a, b) => a.employeeId - b.employeeId),
  })).digest("hex");
  return {
    employer: { id: employer.id, code: employer.code, legalName: employer.legalName },
    employerTin: normalizedDigits(employer.birTin),
    employerBranch: normalizedDigits(employer.birBranchCode),
    reconciliation: { ...reconciliation, sourceDigest },
    employeeSources,
  };
}
