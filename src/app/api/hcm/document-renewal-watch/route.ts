import { and, eq, gt, inArray, lte, or, asc } from "drizzle-orm";
import { db } from "@/db";
import { employees, hcmDocumentRequirements, hcmEmployeeDocumentCompliance } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { classifyDocumentRenewal, documentWatchEnabled } from "@/lib/hcm-document-renewal-watch";

export const dynamic = "force-dynamic";

/**
 * Default OFF. Read-only, no attachments, no bank/payroll data, no writes.
 * Cursor pagination is SQL-bounded; employee and requirement joins are both
 * tenant-constrained to prevent leaking cross-company document metadata.
 */
export async function GET(request: Request) {
  if (!documentWatchEnabled()) {
    return Response.json({ error: "Document Renewal Watch is not enabled." }, { status: 404 });
  }
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const organizationId = Number(params.get("organizationId"));
  const cursor = params.has("cursor") ? Number(params.get("cursor")) : 0;
  const limit = params.has("limit") ? Number(params.get("limit")) : 30;
  if (!Number.isSafeInteger(organizationId) || organizationId < 1 ||
      !Number.isSafeInteger(cursor) || cursor < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return Response.json({ error: "Invalid organization or pagination parameters." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Only People administrators can review document renewals.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Company-wide HR access is required." }, { status: 403 });
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const compliance = hcmEmployeeDocumentCompliance;
  const req = hcmDocumentRequirements;
  const worker = employees;
  const rows = await db.select({
    id: compliance.id,
    employeeId: compliance.employeeId,
    employeeNo: worker.employeeNo,
    firstName: worker.firstName,
    lastName: worker.lastName,
    orgUnitId: worker.orgUnitId,
    requirementId: req.id,
    requirementName: req.name,
    requirementCode: req.code,
    status: compliance.status,
    dueAt: compliance.dueAt,
    expiresAt: compliance.expiresAt,
    mandatory: req.mandatory,
    expiryRequired: req.expiryRequired,
    renewalLeadDays: req.renewalLeadDays,
    documentAttached: compliance.documentId,
  }).from(compliance)
    .innerJoin(worker, and(
      eq(worker.id, compliance.employeeId),
      eq(worker.organizationId, organizationId),
    ))
    .innerJoin(req, and(
      eq(req.id, compliance.requirementId),
      eq(req.organizationId, organizationId),
      eq(req.active, true),
    ))
    .where(and(
      eq(compliance.organizationId, organizationId),
      gt(compliance.id, cursor),
      // Include unresolved document tasks and upcoming verified expirations.
      or(
        inArray(compliance.status, ["missing", "submitted", "expiring", "expired"]),
        and(eq(req.expiryRequired, true), lte(compliance.expiresAt, "2099-12-31")),
      ),
    ))
    .orderBy(asc(compliance.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employeeNo: row.employeeNo,
    employeeName: [row.firstName, row.lastName].filter(Boolean).join(" "),
    orgUnitId: row.orgUnitId,
    requirementId: row.requirementId,
    requirementName: row.requirementName,
    requirementCode: row.requirementCode,
    state: classifyDocumentRenewal(row, today),
    recordedStatus: row.status,
    dueAt: row.dueAt,
    expiresAt: row.expiresAt,
    mandatory: row.mandatory,
    hasAttachment: row.documentAttached !== null,
  }));
  return Response.json({
    organizationId,
    asOf: today,
    items,
    page: { size: limit, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null, hasMore },
    note: "Advisory, live-record projection. No verification or renewal action is performed.",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
