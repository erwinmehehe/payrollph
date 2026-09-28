import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, yearEndAdjustments } from "@/db/schema";
import { renderForm2316 } from "@/lib/annualization";
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

  const rows = await db
    .select({ adjustment: yearEndAdjustments, employee: employees })
    .from(yearEndAdjustments)
    .innerJoin(employees, eq(yearEndAdjustments.employeeId, employees.id))
    .where(and(
      eq(yearEndAdjustments.organizationId, organizationId),
      eq(yearEndAdjustments.taxYear, taxYear),
    ))
    .orderBy(desc(yearEndAdjustments.adjustment));

  if (format === "2316") {
    const match = rows.find((row) => row.employee.id === employeeId) ?? rows[0];
    if (!match) return Response.json({ error: "No annualization on record. Run it first." }, { status: 404 });
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    const body = renderForm2316({
      taxYear,
      employerName: organization?.legalName ?? organization?.name ?? "Employer",
      employeeName: `${match.employee.firstName} ${match.employee.lastName}`,
      employeeNo: match.employee.employeeNo,
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
    const csv = toCsv({
      columns: ["Employee No", "Last Name", "First Name", "MWE", "Gross Compensation", "Non-Taxable", "Taxable Income", "Tax Due", "Tax Withheld", "Adjustment", "Outcome"],
      rows: rows.map((row) => [
        row.employee.employeeNo,
        row.employee.lastName,
        row.employee.firstName,
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
    return new Response(`DRAFT ALPHALIST ${taxYear} - not validated against the BIR Alphalist module\n${csv}`, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=alphalist-draft-${taxYear}.csv`,
      },
    });
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
      warning: `No released payroll runs found with a ${taxYear} pay date, so there is nothing to annualize.`,
    });
  }
  return Response.json(summary);
}
