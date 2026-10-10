import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { receiptPilotAllowed, validReceiptId } from "@/lib/workforce-schedule-receipt";
import {
  readManagerScheduleReceiptView, ScheduleReceiptError,
} from "@/lib/workforce-schedule-receipt-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

/**
 * One worker from the caller's authorized People scope. No date override,
 * report-wide export, acknowledgment mutation, or arbitrary snapshot lookup.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 2 || new Set(keys).size !== 2 ||
      !keys.includes("organizationId") || !keys.includes("employeeId")) {
      return fail("One organization and employee selection are required.", 400);
    }
    const organizationId = Number(url.searchParams.get("organizationId"));
    const employeeId = Number(url.searchParams.get("employeeId"));
    if (!validReceiptId(organizationId) || !validReceiptId(employeeId)) {
      return fail("Invalid employee review scope.", 400);
    }
    if (!receiptPilotAllowed(organizationId, process.env.WFM_SCHEDULE_RECEIPTS_ENABLED,
      process.env.WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS)) {
      return fail("Schedule receipt review is not enabled.", 404);
    }
    const user = await getSessionUser();
    if (!user) return fail("Authentication required.", 401);
    const denied = await assertOrganizationRole(
      user.id, organizationId, PEOPLE_ADMIN_ROLES,
      "Only authorized People administrators may review schedule acknowledgments.",
    );
    if (denied) return denied;

    const access = await getAccess(user.id, organizationId);
    const [employee] = await db.select({ orgUnitId: employees.orgUnitId })
      .from(employees).where(and(
        eq(employees.organizationId, organizationId),
        eq(employees.id, employeeId),
      )).limit(1);
    if (!employee || !assertScope(access, employee.orgUnitId).ok) {
      return fail("Employee is outside your permitted People scope.", 403);
    }
    const result = await readManagerScheduleReceiptView({
      managerUserId: user.id, organizationId, employeeId,
    });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof ScheduleReceiptError) {
      return fail(error.message, error.status);
    }
    return fail("Schedule receipt status could not be verified. No missing acknowledgment is being inferred.", 503);
  }
}
