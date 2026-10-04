import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, payrollRuns, yearEndAdjustments } from "@/db/schema";
import { renderForm2316 } from "@/lib/annualization";
import { decryptGovernmentId } from "@/lib/government-id-crypto";
import { getSessionUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { runYearEndAnnualization } from "@/lib/year-end";
import { enqueuePayrollRun } from "@/lib/payroll-engine";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedOrg = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can view year-end tax annualization.",
  );
  if (deniedOrg) return deniedOrg;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Year-end tax reporting requires company-wide payroll access." }, { status: 403 });
  }
  const taxYear = Number(searchParams.get("taxYear") ?? new Date().getFullYear());
  const format = searchParams.get("format") ?? "json";
  const employeeId = Number(searchParams.get("employeeId") ?? 0);
  if (format === "2316" || format === "alphalist") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
  }

  const rows = await db
    .select({ adjustment: yearEndAdjustments, employee: employees })
    .from(yearEndAdjustments)
    .innerJoin(employees, eq(yearEndAdjustments.employeeId, employees.id))
    .where(and(
      eq(yearEndAdjustments.organizationId, organizationId),
      eq(yearEndAdjustments.taxYear, taxYear),
    ))
    .orderBy(desc(yearEndAdjustments.adjustment));

  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const digits = (value: string | null | undefined, encrypted = false) =>
    (encrypted ? decryptGovernmentId(value) ?? "" : value ?? "").replace(/\D/g, "");
  const employerTin = digits(organization?.birTin);
  const employerBranch = digits(organization?.birBranchCode).padStart(4, "0");
  const missingBirIdentity = rows.filter((row) =>
    digits(row.employee.tin, true).length !== 9 ||
    digits(row.employee.tinBranchCode, true).length !== 4
  );

  if (format === "2316") {
    const match = rows.find((row) => row.employee.id === employeeId) ?? rows[0];
    if (!match) return Response.json({ error: "No annualization on record. Run it first." }, { status: 404 });
    if (employerTin.length !== 9 || employerBranch.length !== 4) {
      return Response.json({ error: "Employer BIR TIN and 4-digit branch code are required before generating Form 2316." }, { status: 422 });
    }
    if (digits(match.employee.tin, true).length !== 9 || digits(match.employee.tinBranchCode, true).length !== 4) {
      return Response.json({ error: "Employee BIR TIN and 4-digit branch code are required before generating Form 2316." }, { status: 422 });
    }

    const body = renderForm2316({
      taxYear,
      employerName: organization?.legalName ?? organization?.name ?? "Employer",
      employerTin: `${employerTin}-${employerBranch}`,
      employeeName: [match.employee.firstName, match.employee.middleName, match.employee.lastName].filter(Boolean).join(" "),
      employeeNo: match.employee.employeeNo,
      employeeTin: `${digits(match.employee.tin, true)}-${digits(match.employee.tinBranchCode, true)}`,
      result: match.adjustment.breakdown as never,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Year-end BIR 2316 reconciliation source generated",
      resource: `${match.employee.employeeNo} · ${taxYear}`,
      metadata: {
        employeeId: match.employee.id,
        taxYear,
        plaintextCertificatePersisted: false,
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename=bir-2316-reconciliation-source-${match.employee.employeeNo}-${taxYear}.txt`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (format === "alphalist") {
    if (employerTin.length !== 9 || employerBranch.length !== 4) {
      return Response.json({ error: "Employer BIR TIN and 4-digit branch code are required before generating an Alphalist source extract." }, { status: 422 });
    }
    if (missingBirIdentity.length > 0) {
      return Response.json({
        error: "Every employee in the annualization needs a 9-digit BIR TIN and 4-digit branch code.",
        employees: missingBirIdentity.map((row) => row.employee.employeeNo),
      }, { status: 422 });
    }

    const csv = toCsv({
      columns: [
        "Employer TIN",
        "Employer Branch",
        "Employee TIN",
        "Employee Branch",
        "Last Name",
        "First Name",
        "Middle Name",
        "Nationality",
        "MWE",
        "Gross Compensation",
        "Non-Taxable",
        "Taxable Income",
        "Tax Due",
        "Tax Withheld",
        "Adjustment",
        "Outcome",
      ],
      rows: rows.map((row) => [
        employerTin,
        employerBranch,
        digits(row.employee.tin, true),
        digits(row.employee.tinBranchCode, true),
        row.employee.lastName,
        row.employee.firstName,
        row.employee.middleName ?? "",
        row.employee.nationality ?? "Filipino",
        row.adjustment.mwe ? "Y" : "N",
        row.adjustment.grossCompensation,
        row.adjustment.nonTaxable,
        row.adjustment.taxableIncome,
        row.adjustment.taxDue,
        row.adjustment.taxWithheld,
        row.adjustment.adjustment,
        row.adjustment.outcome,
      ]),
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Year-end Alphalist source extract generated",
      resource: `Tax year ${taxYear}`,
      metadata: {
        taxYear,
        employeeCount: rows.length,
        containsFullTin: true,
        plaintextFilePersisted: false,
      },
    });
    return new Response(
      `DRAFT ALPHALIST SOURCE EXTRACT ${taxYear} - not an ADES .DAT file and not portal validated\n${csv}`,
      {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename=alphalist-source-draft-${taxYear}.csv`,
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  return Response.json({
    taxYear,
    count: rows.length,
    totalRefund: Number(rows.filter((r) => r.adjustment.outcome === "refund").reduce((s, r) => s + Math.abs(Number(r.adjustment.adjustment)), 0).toFixed(2)),
    totalCollect: Number(rows.filter((r) => r.adjustment.outcome === "collect").reduce((s, r) => s + Number(r.adjustment.adjustment), 0).toFixed(2)),
    rows: rows.map((row) => ({
      employeeId: row.employee.id,
      employeeNo: row.employee.employeeNo,
      name: `${row.employee.firstName} ${row.employee.lastName}`,
      mwe: row.adjustment.mwe,
      grossCompensation: row.adjustment.grossCompensation,
      taxableIncome: row.adjustment.taxableIncome,
      taxDue: row.adjustment.taxDue,
      taxWithheld: row.adjustment.taxWithheld,
      adjustment: row.adjustment.adjustment,
      outcome: row.adjustment.outcome,
      status: row.adjustment.status,
      payrollRunId: row.adjustment.payrollRunId,
      approvedAt: row.adjustment.approvedAt,
      settledAt: row.adjustment.settledAt,
    })),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const taxYear = Number(body.taxYear);
  const applyToPayrollRunId =
    body.applyToPayrollRunId == null ? null : Number(body.applyToPayrollRunId);

  if (
    !Number.isInteger(organizationId)
    || !Number.isInteger(taxYear)
    || (applyToPayrollRunId != null && !Number.isInteger(applyToPayrollRunId))
  ) {
    return Response.json({
      error: "organizationId and taxYear are required; applyToPayrollRunId must be an integer when supplied.",
    }, { status: 400 });
  }

  const deniedWrite = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can run year-end tax annualization.",
  );
  if (deniedWrite) return deniedWrite;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Year-end tax annualization requires company-wide payroll access." }, { status: 403 });
  }

  let targetRun: typeof payrollRuns.$inferSelect | null = null;
  if (applyToPayrollRunId != null) {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    [targetRun] = await db.select().from(payrollRuns).where(and(
      eq(payrollRuns.id, applyToPayrollRunId),
      eq(payrollRuns.organizationId, organizationId),
    )).limit(1);
    if (!targetRun) {
      return Response.json({ error: "The selected payroll run was not found in this organization." }, { status: 404 });
    }
    if (targetRun.status !== "Needs review") {
      return Response.json({
        error: "Year-end tax can be bound only after the final payroll has been freshly calculated and is in Needs review status.",
      }, { status: 409 });
    }
    if (Number(String(targetRun.payDate).slice(0, 4)) !== taxYear) {
      return Response.json({ error: "The selected payroll run must have a pay date in the requested tax year." }, { status: 422 });
    }
    if (!String(targetRun.periodEnd).endsWith("-12-31")) {
      return Response.json({
        error: "Year-end tax settlement must be bound to the payroll cutoff ending December 31.",
      }, { status: 422 });
    }
  }

  const summary = await runYearEndAnnualization(
    organizationId,
    taxYear,
    user.name,
    targetRun
      ? {
          includePayrollRunId: targetRun.id,
          bindToPayrollRunId: targetRun.id,
          approvedBy: user.name,
        }
      : {},
  );

  if (targetRun) {
    // Requeue from the approved annualization snapshot so the register,
    // payslips and release settlement all include the exact refund/collection.
    await enqueuePayrollRun(targetRun.id);
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Year-end tax adjustments bound to payroll",
      resource: targetRun.periodLabel,
      metadata: {
        taxYear,
        payrollRunId: targetRun.id,
        refunds: summary.refunds,
        collections: summary.collections,
        totalRefund: summary.totalRefund,
        totalCollect: summary.totalCollect,
        requiresRecalculation: true,
      },
    });
  }
  if (summary.employees === 0) {
    return Response.json({
      ...summary,
      generated2316Drafts: 0,
      available2316Drafts: 0,
      warning: `No payroll runs eligible for ${taxYear} annualization were found.`,
    });
  }

  return Response.json({
    ...summary,
    generated2316Drafts: 0,
    available2316Drafts: summary.employees,
    certificateStorage: "not-persisted",
    certificateAccess: "Generate the 2316 reconciliation source on demand with format=2316&employeeId=... after recent MFA, then populate the current official BIR Form 2316 separately.",
    payrollSettlement: targetRun
      ? {
          payrollRunId: targetRun.id,
          status: "Queued",
          note: "The final cutoff was requeued so approved year-end refunds/collections become payroll line items before review and release.",
        }
      : null,
  });
}
