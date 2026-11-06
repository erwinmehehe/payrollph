import { asc, eq, and } from "drizzle-orm";
import { resolveMultiEntityContext } from "@/lib/multi-entity-server";
import { db } from "@/db";
import { auditEvents, employees, organizations, payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { maskBankAccount } from "@/lib/bank-account-crypto";
import { maskGovernmentId } from "@/lib/government-id-crypto";
import { requireSensitiveActionMfa } from "@/lib/security-request";
import { escapeCsvCell } from "@/lib/csv";
import { companyExportSources, parseCompanyExportKind, parseCompanyExportOrganizationId } from "@/lib/company-export-kind";

export const dynamic = "force-dynamic";

const csvCell = escapeCsvCell;
const PRIVATE_EXPORT_HEADERS = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } as const;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  // Never default to tenant 1 or accept ambiguous duplicate selectors.
  const organizationSelectors = searchParams.getAll("organizationId");
  const organizationId = organizationSelectors.length === 1
    ? parseCompanyExportOrganizationId(organizationSelectors[0]) : null;
  if (organizationId === null) {
    return Response.json({ error: "An explicit, valid organizationId is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const kind = parseCompanyExportKind(searchParams.get("kind"));
  if (kind === null) return Response.json({ error: "Unsupported company export kind." }, { status: 400 });
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
  // Deny out-of-scope exports before employer metadata or report-data reads.
  if (kind !== "employees" && !access.companyWide) {
    return Response.json({ error: "Company-wide payroll and audit exports are not available to unit-scoped roles." }, { status: 403 });
  }
  if (kind === "employees" && !access.companyWide &&
      (!Number.isSafeInteger(access.orgUnitId) || (access.orgUnitId ?? 0) < 1)) {
    return Response.json({ error: "An active organization-unit assignment is required." }, { status: 403 });
  }
  const resolved = await resolveMultiEntityContext({ userId: user.id, organizationId, request });
  if (!resolved.ok) return resolved.response;
  const scope = resolved.context;
  if (scope.enabled && (kind === "audit" || kind === "all") && !scope.group)
    return Response.json({ error: "Tenant-wide exports require a group role." }, { status: 403 });
  if (scope.enabled && (kind === "audit" || kind === "all") && scope.legalEntityId !== null)
    return Response.json({ error: "Select All entities for tenant-wide audit or JSON export." }, { status: 409 });
  if (kind === "all" || kind === "audit") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
  }
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!organization) return Response.json({ error: "Organization not found" }, { status: 404 });

  // Fetch only the requested datasets; apply unit restrictions in PostgreSQL
  // rather than reading all company records and filtering afterward.
  const requested = companyExportSources(kind);
  const [employeeRows, payrollRows, auditRows] = await Promise.all([
    requested.employees
      ? db.select().from(employees).where(and(
        eq(employees.organizationId, organizationId),
        scope.enabled && scope.legalEntityId !== null
          ? eq(employees.legalEntityId, scope.legalEntityId) : undefined,
        !access.companyWide ? eq(employees.orgUnitId, access.orgUnitId!) : undefined,
      )).orderBy(asc(employees.id)) : Promise.resolve([]),
    requested.payrollRuns
      ? db.select().from(payrollRuns).where(and(
        eq(payrollRuns.organizationId, organizationId),
        scope.enabled && scope.legalEntityId !== null
          ? eq(payrollRuns.legalEntityId, scope.legalEntityId) : undefined,
      )).orderBy(asc(payrollRuns.id)) : Promise.resolve([]),
    requested.auditEvents
      ? db.select().from(auditEvents)
        .where(eq(auditEvents.organizationId, organizationId))
        .orderBy(asc(auditEvents.id)) : Promise.resolve([]),
  ]);

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
      headers: { ...PRIVATE_EXPORT_HEADERS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=audit-trail-${organizationId}.csv` },
    });
  }

  if (kind === "employees") {
    const header = ["Employee no.", "Name", "Title", "Status", "Type", "Basic rate"];
    const lines = employeeRows.map((row) => [row.employeeNo, `${row.firstName} ${row.lastName}`, row.title, row.status, row.employmentType, row.basicRate]);
    const text = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
    return new Response(text, { headers: { ...PRIVATE_EXPORT_HEADERS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=employees.csv" } });
  }

  if (kind === "payroll") {
    const header = ["Period", "Scope", "Status", "Pay date", "Employees", "Gross pay", "Net pay", "Rule version"];
    const lines = payrollRows.map((row) => [row.periodLabel, row.scopeLabel, row.status, row.payDate, row.employeeCount, row.grossPay, row.netPay, row.ruleVersion]);
    const text = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
    return new Response(text, { headers: { ...PRIVATE_EXPORT_HEADERS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=payroll-register.csv" } });
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
      ...PRIVATE_EXPORT_HEADERS,
    },
  });
}
