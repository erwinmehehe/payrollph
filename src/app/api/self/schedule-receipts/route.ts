import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership } from "@/lib/access";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { receiptPilotAllowed, parseScheduleReceipt } from "@/lib/workforce-schedule-receipt";
import { manilaWorkDate } from "@/lib/workforce-employee-upcoming-week";
import { readScheduleReceiptBody, ScheduleReceiptBodyError } from "@/lib/workforce-schedule-receipt-body";
import { acknowledgeScheduleReceipt, readScheduleReceiptView, ScheduleReceiptError } from "@/lib/workforce-schedule-receipt-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
function fail(error: string, status: number, code = "SCHEDULE_RECEIPT_UNAVAILABLE") { return Response.json({ error, code }, { status, headers }); }
async function selfScope() {
  if (process.env.WFM_SCHEDULE_RECEIPTS_ENABLED !== "true") return { denied: fail("Schedule receipts are not enabled.", 404) };
  const session = await getSessionUser();
  if (!session) return { denied: fail("Authentication required.", 401) };
  if (session.role !== "employee" || !session.employeeId) return { denied: fail("Employee self-service access is required.", 403) };
  const [employee] = await db.select({ id: employees.id, organizationId: employees.organizationId }).from(employees)
    .where(eq(employees.id, session.employeeId)).limit(1);
  if (!employee) return { denied: fail("Employee record unavailable.", 403) };
  const denied = await assertMembership(session.id, employee.organizationId);
  if (denied) return { denied };
  if (!receiptPilotAllowed(employee.organizationId, process.env.WFM_SCHEDULE_RECEIPTS_ENABLED,
    process.env.WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS)) return { denied: fail("Schedule receipts are not enabled.", 404) };
  return { session, who: { userId: session.id, employeeId: employee.id, organizationId: employee.organizationId }, denied: null };
}
function failure(error: unknown) {
  if (error instanceof ScheduleReceiptBodyError) return fail(error.message, error.status, error.code);
  return error instanceof ScheduleReceiptError ? fail(error.message, error.status, error.code)
    : fail("Schedule receipts could not be verified. No successful acknowledgment is being reported.", 503);
}
export async function GET(request: Request) {
  try {
    const scope = await selfScope();
    if (scope.denied) return scope.denied;
    if (new URL(request.url).search) return fail("The schedule is scoped to your signed-in account and current week.", 400);
    const view = await readScheduleReceiptView(scope.who!);
    return Response.json(view, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const originDenied = enforceSameOriginMutation(request);
    if (originDenied) return originDenied;
    const scope = await selfScope();
    if (scope.denied) return scope.denied;
    if (new URL(request.url).search) return fail("Client-supplied scope is not accepted.", 400);
    const demoDenied = publicDemoMutationDenied(scope.session!.email, "Employee schedule receipt acknowledgment");
    if (demoDenied) return demoDenied;
    const limited = await enforceSensitiveActionRateLimit(request, { userId: scope.session!.id,
      action: "self-schedule-receipt", resourceId: scope.who!.employeeId, limit: 20, windowMs: 15 * 60_000 });
    if (limited) return limited;
    // Enforce the real UTF-8 byte bound while streaming, not after buffering.
    // Existing auth, origin, demo, allowlist and rate-limit gates remain first.
    const body = await readScheduleReceiptBody(request);
    try { parseScheduleReceipt(body, manilaWorkDate()); }
    catch { return fail("Review a current schedule and explicitly acknowledge it. Client-supplied employee or employer identifiers are not accepted.", 400); }
    const receipt = await acknowledgeScheduleReceipt(scope.who!, body);
    return Response.json(receipt, { status: receipt.created ? 201 : 200, headers });
  } catch (error) { return failure(error); }
}
