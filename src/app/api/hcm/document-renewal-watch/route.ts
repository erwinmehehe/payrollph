import { and, asc, eq, gt, ilike, inArray, isNotNull, lte, gte, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, hcmDocumentRequirements, hcmEmployeeDocumentCompliance } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  classifyDocumentRenewal, documentWatchEnabled, DOCUMENT_WATCH_EXPIRIES,
  DOCUMENT_WATCH_STATES,
  type DocumentWatchExpiry, type DocumentWatchStateFilter,
} from "@/lib/hcm-document-renewal-watch";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
function respond(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers });
}
function positiveId(raw: string | null, allowZero = false): number | null {
  if (!raw || !/^(0|[1-9][0-9]*)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0) ? value : null;
}
function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, "\\$&");
}
function phBusinessDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return [part("year"), part("month"), part("day")].join("-");
}

/**
 * Default-off read-only case search. All search/state/expiry constraints are
 * applied IN SQL, before keyset pagination; no page-only search illusion.
 * The joins, including the employee name lookup, are scoped to this tenant.
 */
export async function GET(request: Request) {
  if (!documentWatchEnabled()) return respond({ error: "Not found." }, 404);

  const user = await getSessionUser();
  if (!user) return respond({ error: "Authentication required." }, 401);

  const params = new URL(request.url).searchParams;
  const organizationId = positiveId(params.get("organizationId"));
  const cursor = params.has("cursor") ? positiveId(params.get("cursor"), true) : 0;
  const limit = params.has("limit") ? positiveId(params.get("limit")) : 30;
  const q = (params.get("q") ?? "").trim();
  const state = params.get("state") ?? "all";
  const expiry = params.get("expiry") ?? "all";

  if (organizationId === null || cursor === null || limit === null || limit > 50 ||
      q.length > 80 ||
      !DOCUMENT_WATCH_STATES.includes(state as DocumentWatchStateFilter) ||
      !DOCUMENT_WATCH_EXPIRIES.includes(expiry as DocumentWatchExpiry)) {
    return respond({ error: "Invalid employer, cursor or document filter." }, 400);
  }

  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Only People administrators can review employee document renewals.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  // PEOPLE_ADMIN_ROLES also contains bookkeepers: this HR case feed does not.
  if (!access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) {
    return respond({ error: "Company-wide HR access is required." }, 403);
  }

  const today = phBusinessDate(new Date());
  const compliance = hcmEmployeeDocumentCompliance;
  const requirement = hcmDocumentRequirements;
  const employee = employees;
  const currentDate = sql`CAST(${today} AS date)`;

  // Maintain the same precedence as classifyDocumentRenewal in the pure model.
  // Do not turn a due date into an expiry date or treat a waiver as overdue.
  const currentState = sql<string>`CASE
    WHEN ${compliance.status} = 'waived' THEN 'waived'
    WHEN ${compliance.expiresAt} < ${currentDate} THEN 'expired'
    WHEN ${requirement.expiryRequired} = true
      AND ${compliance.expiresAt} IS NOT NULL
      AND ${compliance.expiresAt} <=
        (${currentDate} + GREATEST(0, LEAST(365, ${requirement.renewalLeadDays})))
      THEN 'expiring'
    WHEN ${compliance.status} = 'expired' THEN 'expired'
    WHEN ${compliance.status} = 'expiring' THEN 'expiring'
    WHEN ${compliance.status} = 'missing' AND ${compliance.dueAt} < ${currentDate} THEN 'overdue'
    WHEN ${compliance.status} = 'missing' THEN 'missing'
    WHEN ${compliance.status} = 'submitted' THEN 'submitted'
    ELSE 'current'
  END`;

  const search = q ? `%${escapeLike(q)}%` : null;
  const searchPredicate = search ? or(
    ilike(employee.employeeNo, search),
    ilike(employee.firstName, search),
    ilike(employee.lastName, search),
    ilike(sql`concat_ws(' ', ${employee.firstName}, ${employee.lastName})`, search),
    ilike(requirement.name, search),
    ilike(requirement.code, search),
  ) : undefined;

  const statePredicate = state === "all" ? undefined : sql`${currentState} = ${state}`;
  const expiryDays = expiry.startsWith("next") ? Number(expiry.slice(4)) : null;
  const expiryPredicate = expiry === "past"
    ? lt(compliance.expiresAt, today)
    : expiryDays !== null && [30, 60, 90].includes(expiryDays)
      ? and(
        gte(compliance.expiresAt, today),
        lte(compliance.expiresAt, sql`${currentDate} + ${expiryDays}`),
      )
      : undefined;

  try {
    const rows = await db.select({
      id: compliance.id,
      employeeId: compliance.employeeId,
      employeeNo: employee.employeeNo,
      firstName: employee.firstName,
      lastName: employee.lastName,
      orgUnitId: employee.orgUnitId,
      requirementId: requirement.id,
      requirementName: requirement.name,
      requirementCode: requirement.code,
      status: compliance.status,
      dueAt: compliance.dueAt,
      expiresAt: compliance.expiresAt,
      mandatory: requirement.mandatory,
      expiryRequired: requirement.expiryRequired,
      renewalLeadDays: requirement.renewalLeadDays,
      documentId: compliance.documentId,
    }).from(compliance)
      .innerJoin(employee, and(
        eq(employee.id, compliance.employeeId),
        eq(employee.organizationId, organizationId),
      ))
      .innerJoin(requirement, and(
        eq(requirement.id, compliance.requirementId),
        eq(requirement.organizationId, organizationId),
        eq(requirement.active, true),
      ))
      .where(and(
        eq(compliance.organizationId, organizationId),
        gt(compliance.id, cursor),
        or(
          inArray(compliance.status, ["missing", "submitted", "expiring", "expired", "waived"]),
          isNotNull(compliance.expiresAt),
        ),
        searchPredicate,
        statePredicate,
        expiryPredicate,
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
      hasAttachment: row.documentId !== null,
    }));

    return respond({
      organizationId,
      asOf: today,
      filters: { q, state, expiry },
      items,
      page: {
        size: limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
      note: "Read-only evidence preview. Counts are for this page only; no document is verified, renewed or changed.",
    });
  } catch {
    return respond({ error: "Document renewal source unavailable." }, 503);
  }
}
