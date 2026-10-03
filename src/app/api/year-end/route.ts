import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, yearEndAdjustments } from "@/db/schema";
import { renderForm2316 } from "@/lib/annualization";
import { decryptGovernmentId } from "@/lib/government-id-crypto";
import { getSessionUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { runYearEndAnnualization } from "@/lib/year-end";
import { assertOrganizationRole, PAYROLL_OPERATOR_ROLES } from "@/lib/access";

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
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename=bir-2316-draft-${match.employee.employeeNo}-${taxYear}.txt`,
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
    return new Response(
      `DRAFT ALPHALIST SOURCE EXTRACT ${taxYear} - not an ADES .DAT file and not portal validated\n${csv}`,
      {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename=alphalist-source-draft-${taxYear}.csv`,
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

  if (!Number.isInteger(organizationId) || !Number.isInteger(taxYear)) {
    return Response.json({ error: "organizationId and taxYear are required." }, { status: 400 });
  }

  const deniedWrite = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can run year-end tax annualization.",
  );
  if (deniedWrite) return deniedWrite;

  const summary = await runYearEndAnnualization(organizationId, taxYear, user.name);
  if (summary.employees === 0) {
    return Response.json({
      ...summary,
      generated2316Drafts: 0,
      available2316Drafts: 0,
      warning: `No released payroll runs found with a ${taxYear} pay date, so there is nothing to annualize.`,
    });
  }

  return Response.json({
    ...summary,
    generated2316Drafts: 0,
    available2316Drafts: summary.employees,
    certificateStorage: "not-persisted",
    certificateAccess: "Generate each draft on demand with format=2316&employeeId=... after recent MFA.",
  });
}
