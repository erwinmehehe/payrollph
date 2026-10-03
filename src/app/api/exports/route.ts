import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, organizations, payrollRuns } from "@/db/schema";
import { ensureSeedData } from "@/db/seed";
import { recordAuditEvent } from "@/lib/audit";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { maskBankAccount } from "@/lib/bank-account-crypto";
import { maskGovernmentId } from "@/lib/government-id-crypto";
import { requireSensitiveActionMfa } from "@/lib/security-request";
import { escapeCsvCell } from "@/lib/csv";

export const dynamic = "force-dynamic";

const csvCell = escapeCsvCell;

export async function GET(request: Request) {
  await ensureSeedData();
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const kind = searchParams.get("kind") ?? "all";
  const allowedRoles =
    kind === "employees"
      ? ["owner", "admin", "bookkeeper", "hr"]
      : kind === "payroll"
        ? [...PAYROLL_OPERATOR_ROLES]
        : ["owner", "admin", "bookkeeper"];
  const deniedOrg = await assertOrganizationRole(
    user.id,
    organizationId,
    allowedRoles,
    "You do not have permission to export this company data.",
  );
  if (deniedOrg) return deniedOrg;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (kind === "all" || kind === "audit") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
  }
  if (kind !== "employees" && !access.companyWide) {
    return Response.json({ error: "Company-wide payroll and audit exports are not available to unit-scoped roles." }, { status: 403 });
  }
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!organization) return Response.json({ error: "Organization not found" }, { status: 404 });

  const [allEmployeeRows, payrollRows, auditRows] = await Promise.all([
    db.select().from(employees).where(eq(employees.organizationId, organizationId)).orderBy(asc(employees.id)),
    db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, organizationId)).orderBy(asc(payrollRuns.id)),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, organizationId)).orderBy(asc(auditEvents.id)),
  ]);

  const employeeRows = access.companyWide
    ? allEmployeeRows
    : allEmployeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Company data exported",
    resource: kind,
    metadata: { format: kind === "all" ? "JSON" : "CSV" },
  });

  if (kind === "audit") {
    const header = ["Timestamp", "Actor", "Action", "Resource", "Rule version", "Metadata"];
    const lines = auditRows.map((row) => [
      new Date(row.createdAt).toISOString(),
      row.actor,
      row.action,
      row.resource,
      String((row.metadata as Record<string, unknown> | null)?.ruleVersion ?? ""),
      JSON.stringify(row.metadata ?? {}),
    ]);
    const text = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
    return new Response(text, {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename=audit-trail-${organizationId}.csv` },
    });
  }

  if (kind === "employees") {
    const header = ["Employee no.", "Name", "Title", "Status", "Type", "Basic rate"];
    const lines = employeeRows.map((row) => [row.employeeNo, `${row.firstName} ${row.lastName}`, row.title, row.status, row.employmentType, row.basicRate]);
    const text = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
    return new Response(text, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=employees.csv" } });
  }

  if (kind === "payroll") {
    const header = ["Period", "Scope", "Status", "Pay date", "Employees", "Gross pay", "Net pay", "Rule version"];
    const lines = payrollRows.map((row) => [row.periodLabel, row.scopeLabel, row.status, row.payDate, row.employeeCount, row.grossPay, row.netPay, row.ruleVersion]);
    const text = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
    return new Response(text, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=payroll-register.csv" } });
  }

  const safeEmployeeRows = employeeRows.map((employee) => ({
    ...employee,
    bankAccount: maskBankAccount(employee.bankAccount),
    tin: maskGovernmentId(employee.tin),
    tinBranchCode: maskGovernmentId(employee.tinBranchCode),
    sssNo: maskGovernmentId(employee.sssNo),
    philHealthNo: maskGovernmentId(employee.philHealthNo),
    pagIbigNo: maskGovernmentId(employee.pagIbigNo),
  }));
  return new Response(JSON.stringify({
    exportedAt: new Date().toISOString(),
    organization,
    employees: safeEmployeeRows,
    payrollRuns: payrollRows,
    auditEvents: auditRows,
  }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": "attachment; filename=linaw-data-export.json",
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
