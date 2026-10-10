import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { birWithholdingRemittanceBatches, employees, historicalPayrollEntries, legalEntities, organizations, payrollEntries, payrollRuns, yearEndAdjustments } from "@/db/schema";
import { renderForm2316 } from "@/lib/annualization";
import { decryptGovernmentId } from "@/lib/government-id-crypto";
import { getSessionUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { runYearEndAnnualization } from "@/lib/year-end";
import { enqueuePayrollRun } from "@/lib/payroll-engine";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { evaluateBirAnnualReadiness } from "@/lib/bir-annual-readiness";

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
  if (format === "2316" || format === "alphalist" || format === "preflight") {
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
  // Annualization is currently organization-wide. Do not silently turn a
  // mixed-employer register into a single employer's BIR 1604-C / 2316.
  const activeEmployers = format === "2316" || format === "alphalist" || format === "preflight"
    ? await db.select().from(legalEntities).where(and(
        eq(legalEntities.organizationId, organizationId),
        eq(legalEntities.active, true),
      ))
    : [];
  const legalEmployer = activeEmployers.length === 1 ? activeEmployers[0] : null;
  const employerTin = digits(legalEmployer?.birTin ?? organization?.birTin);
  const employerBranch = digits(legalEmployer?.birBranchCode ?? organization?.birBranchCode);
  const missingBirIdentity = rows.filter((row) =>
    digits(row.employee.tin, true).length !== 9 ||
    digits(row.employee.tinBranchCode, true).length !== 4
  );

  const requiresAnnualPreflight = format === "preflight" || format === "alphalist" || format === "2316";
  let readiness: ReturnType<typeof evaluateBirAnnualReadiness> | null = null;
  if (requiresAnnualPreflight) {
    const releasedRuns = await db.select().from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
      gte(payrollRuns.payDate, `${taxYear}-01-01`),
      lte(payrollRuns.payDate, `${taxYear}-12-31`),
    ));
    const releasedIds = releasedRuns.map((run) => run.id);
    const [releasedEntries, historicalRows, monthlyBatches] = await Promise.all([
      releasedIds.length
        ? db.select({ employeeId: payrollEntries.employeeId }).from(payrollEntries)
            .where(inArray(payrollEntries.payrollRunId, releasedIds))
        : Promise.resolve([]),
      db.select({ employeeId: historicalPayrollEntries.employeeId }).from(historicalPayrollEntries)
        .where(and(
          eq(historicalPayrollEntries.organizationId, organizationId),
          gte(historicalPayrollEntries.payDate, `${taxYear}-01-01`),
          lte(historicalPayrollEntries.payDate, `${taxYear}-12-31`),
        )),
      legalEmployer
        ? db.select({
            month: birWithholdingRemittanceBatches.applicableMonth,
            status: birWithholdingRemittanceBatches.status,
          }).from(birWithholdingRemittanceBatches).where(and(
            eq(birWithholdingRemittanceBatches.organizationId, organizationId),
            eq(birWithholdingRemittanceBatches.legalEntityId, legalEmployer.id),
            gte(birWithholdingRemittanceBatches.applicableMonth, `${taxYear}-01`),
            lte(birWithholdingRemittanceBatches.applicableMonth, `${taxYear}-12`),
          ))
        : Promise.resolve([]),
    ]);

    readiness = evaluateBirAnnualReadiness({
      taxYear,
      employerTin,
      employerBranchCode: employerBranch,
      legalEmployerCount: activeEmployers.length,
      mismatchedLegalEmployerRunIds: legalEmployer
        ? releasedRuns.filter((run) => run.legalEntityId != null && run.legalEntityId !== legalEmployer.id).map((run) => run.id)
        : [],
      rows: rows.map(({ adjustment, employee }) => ({
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        tin: digits(employee.tin, true),
        tinBranchCode: digits(employee.tinBranchCode, true),
        firstName: employee.firstName,
        lastName: employee.lastName,
        mwe: adjustment.mwe,
        grossCompensation: adjustment.grossCompensation,
        nonTaxable: adjustment.nonTaxable,
        taxableIncome: adjustment.taxableIncome,
        taxDue: adjustment.taxDue,
        taxWithheld: adjustment.taxWithheld,
        adjustment: adjustment.adjustment,
        outcome: adjustment.outcome,
        status: adjustment.status,
      })),
      payrollEmployeeIds: [...releasedEntries, ...historicalRows].map((row) => row.employeeId),
      releasedPayrollRunCount: releasedRuns.length,
      importedHistoryCount: historicalRows.length,
      payrollMonths: releasedRuns.map((run) => String(run.payDate).slice(0, 7)),
      bir1601cMonths: monthlyBatches.map((batch) => ({
        month: batch.month,
        reconciled: batch.status === "reconciled",
      })),
    });
    if (format === "preflight") {
      return Response.json(readiness, {
        headers: { "Cache-Control": "no-store, private" },
      });
    }
  }

  if (format === "2316") {
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return Response.json({ error: "employeeId is required to select the exact Form 2316 employee." }, { status: 400 });
    }
    const match = rows.find((row) => row.employee.id === employeeId);
    if (!match) return Response.json({ error: "No year-end annualization exists for the requested employee." }, { status: 404 });
    const employeeBlockers = (readiness?.blockers ?? []).filter((issue) =>
      !issue.employeeNo || issue.employeeNo === match.employee.employeeNo
    );
    if (employeeBlockers.length) {
      return Response.json({ error: "The Form 2316 source requires corrections before draft generation.", blockers: employeeBlockers }, { status: 409 });
    }
    if (employerTin.length !== 9 || employerBranch.length !== 4) {
      return Response.json({ error: "Employer BIR TIN and 4-digit branch code are required before generating Form 2316." }, { status: 422 });
    }
    if (digits(match.employee.tin, true).length !== 9 || digits(match.employee.tinBranchCode, true).length !== 4) {
      return Response.json({ error: "Employee BIR TIN and 4-digit branch code are required before generating Form 2316." }, { status: 422 });
    }

    const body = renderForm2316({
      taxYear,
      employerName: legalEmployer?.legalName ?? organization?.legalName ?? organization?.name ?? "Employer",
      employerTin: `${employerTin}-${employerBranch}`,
      employeeName: [match.employee.firstName, match.employee.middleName, match.employee.lastName].filter(Boolean).join(" "),
      employeeNo: match.employee.employeeNo,
      employeeTin: `${digits(match.employee.tin, true)}-${digits(match.employee.tinBranchCode, true)}`,
      result: match.adjustment.breakdown as never,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Year-end BIR 2316 draft generated",
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
        "Content-Disposition": `attachment; filename=bir-2316-draft-${match.employee.employeeNo}-${taxYear}.txt`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (format === "alphalist") {
    if (!readiness?.canExportSource) {
      return Response.json({
        error: "BIR 1604-C source export is blocked by annual filing preflight. Fix the blockers and rerun the preflight.",
        readiness,
      }, { status: 409 });
    }
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
        sourceOnly: true,
        birValidated: false,
        preflight: readiness.summary,
      },
    });
    // Keep the first CSV record as the header so spreadsheet tools can import
    // it cleanly. The filename and response headers disclose its DRAFT status.
    return new Response(csv,
      {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename=alphalist-source-draft-${taxYear}.csv`,
          "X-PayrollPH-Filing-Status": "DRAFT-SOURCE-NOT-BIR-DAT",
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
    certificateAccess: "Generate each draft on demand with format=2316&employeeId=... after recent MFA.",
    payrollSettlement: targetRun
      ? {
          payrollRunId: targetRun.id,
          status: "Queued",
          note: "The final cutoff was requeued so approved year-end refunds/collections become payroll line items before review and release.",
        }
      : null,
  });
}
