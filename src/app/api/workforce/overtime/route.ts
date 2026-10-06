import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, overtimeRequests } from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";
import { runAutomationEventSafely } from "@/lib/automation";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_KINDS = new Set(["pre_approved", "emergency_post_approval"]);
const OT_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager", "payroll"] as const;
const OT_DECIDER_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager"] as const;

async function scopedEmployee(userId: number, organizationId: number, employeeId: number) {
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) {
    return { employee: null, denied: Response.json({ error: "Employee not found." }, { status: 404 }) };
  }

  const access = await getAccess(userId, organizationId);
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) {
    return {
      employee: null,
      denied: Response.json({ error: scope.error }, { status: scope.status }),
    };
  }

  return { employee, denied: null };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    OT_ROLES,
    "You do not have permission to review overtime requests.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const employeeRows = await db.select().from(employees)
    .where(eq(employees.organizationId, organizationId))
    .orderBy(asc(employees.id));
  const visibleEmployeeIds = new Set(
    (access.companyWide
      ? employeeRows
      : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId))
      .map((employee) => employee.id),
  );

  const requests = await db.select().from(overtimeRequests)
    .where(eq(overtimeRequests.organizationId, organizationId))
    .orderBy(asc(overtimeRequests.workDate), asc(overtimeRequests.id));

  return Response.json({
    requests: requests.filter((row) => visibleEmployeeIds.has(row.employeeId)),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "").trim();

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    action === "decide_request" ? OT_DECIDER_ROLES : OT_ROLES,
    action === "decide_request"
      ? "Only authorized workforce managers can decide overtime requests."
      : "You do not have permission to manage overtime requests.",
  );
  if (denied) return denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `workforce-overtime-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create_request") {
    const employeeId = Number(body.employeeId);
    const workDate = String(body.workDate ?? "").trim();
    const requestedMinutes = Number(body.requestedMinutes);
    const reason = String(body.reason ?? "").trim().slice(0, 240);
    const requestKind = String(body.requestKind ?? "pre_approved").trim();

    if (
      !Number.isInteger(employeeId)
      || !ISO_DATE.test(workDate)
      || !Number.isInteger(requestedMinutes)
      || requestedMinutes < 1
      || requestedMinutes > 1_440
      || !reason
      || !REQUEST_KINDS.has(requestKind)
    ) {
      return Response.json({
        error: "employeeId, workDate, requestedMinutes (1-1440), reason, and a valid requestKind are required.",
      }, { status: 400 });
    }

    const employeeCheck = await scopedEmployee(user.id, organizationId, employeeId);
    if (employeeCheck.denied) return employeeCheck.denied;

    const [created] = await db.insert(overtimeRequests).values({
      organizationId,
      employeeId,
      workDate,
      requestedMinutes,
      reason,
      requestKind,
      status: "pending",
      requestedBy: user.name,
      requestedByUserId: user.id,
    }).returning();

    const staleTimesheets = await markTimesheetsStaleForEmployeeDate({
      organizationId,
      employeeId,
      workDate,
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Overtime request created",
      resource: `${employeeCheck.employee!.employeeNo} · ${workDate}`,
      metadata: {
        overtimeRequestId: created.id,
        employeeId,
        workDate,
        requestedMinutes,
        requestKind,
        staleTimesheetIds: staleTimesheets.map((row) => row.id),
      },
    });

    const automation = await runAutomationEventSafely({
      organizationId,
      employeeId,
      trigger: "overtime.requested",
      eventKey: `overtime-requested:${created.id}`,
      context: {
        overtimeRequestId: created.id,
        overtimeMinutes: requestedMinutes,
        eventAmount: requestedMinutes,
        workDate,
        requestKind,
      },
    });

    return Response.json({
      request: created,
      staleTimesheetIds: staleTimesheets.map((row) => row.id),
      automation,
    }, { status: 201 });
  }

  if (action === "decide_request") {
    const requestId = Number(body.requestId);
    const decision = String(body.decision ?? "").trim();
    const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 240) || null;
    if (!Number.isInteger(requestId) || !["approved", "rejected"].includes(decision)) {
      return Response.json({
        error: "requestId and decision (approved or rejected) are required.",
      }, { status: 400 });
    }

    const [existing] = await db.select().from(overtimeRequests).where(and(
      eq(overtimeRequests.id, requestId),
      eq(overtimeRequests.organizationId, organizationId),
    )).limit(1);
    if (!existing) {
      return Response.json({ error: "Overtime request not found." }, { status: 404 });
    }
    if (existing.status !== "pending") {
      return Response.json({ error: "Only pending overtime requests can be decided." }, { status: 409 });
    }

    const employeeCheck = await scopedEmployee(user.id, organizationId, existing.employeeId);
    if (employeeCheck.denied) return employeeCheck.denied;

    if (existing.requestedByUserId == null) {
      return Response.json({
        error: "This overtime request predates stable requester identity tracking and cannot be safely approved. Cancel and recreate it.",
      }, { status: 409 });
    }

    if (existing.requestedByUserId === user.id) {
      return Response.json({
        error: "Overtime requests cannot be self-approved. A different authorized manager must decide this request.",
      }, { status: 409 });
    }

    const [updated] = await db.update(overtimeRequests)
      .set({
        status: decision,
        decidedBy: user.name,
        decidedByUserId: user.id,
        decidedAt: new Date(),
        decisionNote,
        updatedAt: new Date(),
      })
      .where(eq(overtimeRequests.id, requestId))
      .returning();

    const staleTimesheets = await markTimesheetsStaleForEmployeeDate({
      organizationId,
      employeeId: existing.employeeId,
      workDate: String(existing.workDate),
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: decision === "approved" ? "Overtime request approved" : "Overtime request rejected",
      resource: `${employeeCheck.employee!.employeeNo} · ${existing.workDate}`,
      metadata: {
        overtimeRequestId: requestId,
        employeeId: existing.employeeId,
        workDate: existing.workDate,
        requestedMinutes: existing.requestedMinutes,
        requestKind: existing.requestKind,
        decision,
        staleTimesheetIds: staleTimesheets.map((row) => row.id),
      },
    });

    const automation = decision === "approved"
      ? await runAutomationEventSafely({
          organizationId,
          employeeId: existing.employeeId,
          trigger: "overtime.approved",
          eventKey: `overtime-approved:${updated.id}`,
          context: {
            overtimeRequestId: updated.id,
            overtimeMinutes: existing.requestedMinutes,
            eventAmount: existing.requestedMinutes,
            workDate: existing.workDate,
            requestKind: existing.requestKind,
            approvedBy: user.name,
          },
        })
      : [];

    return Response.json({
      request: updated,
      staleTimesheetIds: staleTimesheets.map((row) => row.id),
      automation,
    });
  }

  return Response.json({ error: "Unsupported overtime action." }, { status: 400 });
}
