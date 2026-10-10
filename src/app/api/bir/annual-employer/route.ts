import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  birWithholdingRemittanceBatches,
  employees,
  historicalPayrollEntries,
  legalEntities,
  payrollEntries,
  payrollRuns,
  yearEndAdjustments,
} from "@/db/schema";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { reconcileBirEmployerYear } from "@/lib/bir-employer-reconciliation";
import { requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

/** Read-only. Never alters payroll, agency evidence, or annual tax settlements. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const taxYear = Number(url.searchParams.get("taxYear"));
  const legalEntityId = Number(url.searchParams.get("legalEntityId") ?? 0);
  const mode = url.searchParams.get("mode") ?? "reconcile";
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(taxYear) || taxYear < 2018 || taxYear > 2100) {
    return Response.json({ error: "A valid organizationId and taxYear are required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id, organizationId, PAYROLL_OPERATOR_ROLES,
    "Only company-wide payroll operators may review annual BIR records.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Annual BIR reporting requires company-wide payroll access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  if (mode === "employers") {
    const options = await db.select({
      id: legalEntities.id, code: legalEntities.code, legalName: legalEntities.legalName,
      primaryEntity: legalEntities.primaryEntity,
    }).from(legalEntities).where(and(
      eq(legalEntities.organizationId, organizationId),
      eq(legalEntities.active, true),
    ));
    return Response.json({ employers: options }, { headers: { "Cache-Control": "no-store, private" } });
  }
  if (mode !== "reconcile") {
    return Response.json({ error: "Unknown BIR reconciliation mode." }, { status: 400 });
  }
  if (!Number.isSafeInteger(legalEntityId) || legalEntityId <= 0) {
    return Response.json({ error: "Select the exact legal employer before reconciling BIR compensation." }, { status: 400 });
  }
  const [employer] = await db.select({
    id: legalEntities.id, code: legalEntities.code, legalName: legalEntities.legalName,
  }).from(legalEntities).where(and(
    eq(legalEntities.id, legalEntityId),
    eq(legalEntities.organizationId, organizationId),
    eq(legalEntities.active, true),
  )).limit(1);
  if (!employer) return Response.json({ error: "Legal employer not found in this organization." }, { status: 404 });

  const from = `${taxYear}-01-01`;
  const to = `${taxYear}-12-31`;
  const [runs, yearEnd, history, batches] = await Promise.all([
    db.select({
      id: payrollRuns.id,
      legalEntityId: payrollRuns.legalEntityId,
      payDate: payrollRuns.payDate,
      status: payrollRuns.status,
    }).from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      gte(payrollRuns.payDate, from), lte(payrollRuns.payDate, to),
    )),
    db.select({
      annual: yearEndAdjustments,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeLegalEntityId: employees.legalEntityId,
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
      gte(birWithholdingRemittanceBatches.applicableMonth, `${taxYear}-01`),
      lte(birWithholdingRemittanceBatches.applicableMonth, `${taxYear}-12`),
    )),
  ]);
  const releasedIds = runs.filter(run => run.status === "Released").map(run => run.id);
  const entries = releasedIds.length ? await db.select({
    payrollRunId: payrollEntries.payrollRunId,
    employeeId: payrollEntries.employeeId,
    grossPay: payrollEntries.grossPay,
    lineItems: payrollEntries.lineItems,
  }).from(payrollEntries).where(inArray(payrollEntries.payrollRunId, releasedIds)) : [];
  const report = reconcileBirEmployerYear({
    taxYear,
    legalEntityId: employer.id,
    runs, entries,
    annualized: yearEnd.map(row => ({
      employeeId: row.annual.employeeId,
      employeeNo: row.employeeNo,
      firstName: row.firstName,
      lastName: row.lastName,
      employeeLegalEntityId: row.employeeLegalEntityId,
      mwe: row.annual.mwe,
      grossCompensation: row.annual.grossCompensation,
      nonTaxable: row.annual.nonTaxable,
      taxableIncome: row.annual.taxableIncome,
      taxDue: row.annual.taxDue,
      taxWithheld: row.annual.taxWithheld,
      adjustment: row.annual.adjustment,
      status: row.annual.status,
    })),
    historicalEmployeeIds: history.map(row => row.employeeId),
    monthlyBatches: batches,
  });
  return Response.json({
    employer,
    reconciliation: report,
    note: "Source cross-check only. No BIR DAT or official Form 2316 is generated or submitted.",
  }, { headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
}
