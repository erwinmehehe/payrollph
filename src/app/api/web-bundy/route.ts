import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceCapturePolicies, employees, timePunches } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  let employeeId = Number(url.searchParams.get("employeeId") ?? 0);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const [capturePolicy] = await db.select().from(attendanceCapturePolicies)
    .where(eq(attendanceCapturePolicies.organizationId, organizationId))
    .limit(1);
  if (capturePolicy && !capturePolicy.webBundyEnabled) {
    return Response.json({ error: "Web Bundy capture is disabled for this organization." }, { status: 403 });
  }

  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
    employeeId = user.employeeId;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can view team attendance.",
    );
    if (denied) return denied;
  }

  const todayStr = manilaToday();
  const filter = employeeId > 0
    ? and(eq(timePunches.organizationId, organizationId), eq(timePunches.employeeId, employeeId), eq(timePunches.workDate, todayStr))
    : and(eq(timePunches.organizationId, organizationId), eq(timePunches.workDate, todayStr));

  const todayPunches = await db.select({
    punch: timePunches,
    employee: employees,
  })
    .from(timePunches)
    .innerJoin(employees, eq(timePunches.employeeId, employees.id))
    .where(filter)
    .orderBy(desc(timePunches.id));

  return Response.json({
    date: todayStr,
    punches: todayPunches.map(({ punch, employee }) => ({
      ...punch,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      avatarInitials: employee.avatarInitials,
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
  let employeeId = Number(body.employeeId);
  const actionType = String(body.actionType ?? "");
  const location = String(body.location ?? "Web Bundy Clock (Browser)").slice(0, 160);
  const ip = clientIp(request);

  const validActions = ["clock_in", "break_start", "break_end", "clock_out"];
  if (!Number.isInteger(organizationId) || !validActions.includes(actionType)) {
    return Response.json({
      error: "organizationId and actionType clock_in/break_start/break_end/clock_out are required.",
    }, { status: 400 });
  }

  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
    employeeId = user.employeeId;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can record attendance for another employee.",
    );
    if (denied) return denied;
  }

  if (!Number.isInteger(employeeId)) return Response.json({ error: "employeeId is required." }, { status: 400 });

  const [employee] = await db.select().from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });

  const todayStr = manilaToday();
  const now = new Date();

  const [existingPunch] = await db.select().from(timePunches).where(
    and(
      eq(timePunches.organizationId, organizationId),
      eq(timePunches.employeeId, employeeId),
      eq(timePunches.workDate, todayStr),
    ),
  ).limit(1);

  if (actionType === "break_start") {
    if (!existingPunch?.timeIn || existingPunch.timeOut) {
      return Response.json({ error: "Clock in before starting a break, and breaks cannot be added after clock-out." }, { status: 409 });
    }
    if (existingPunch.breakStart) {
      return Response.json({ error: "A break has already been started for this attendance record." }, { status: 409 });
    }
    const [updated] = await db.update(timePunches).set({
      breakStart: now,
      notes: (existingPunch.notes ? existingPunch.notes + " · " : "") + "Break started via Web Bundy",
    }).where(eq(timePunches.id, existingPunch.id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Web Bundy Break START",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { employeeId, workDate: todayStr, breakStart: now.toISOString(), ip },
    });
    return Response.json({ ok: true, action: "break_start", punch: updated });
  }

  if (actionType === "break_end") {
    if (!existingPunch?.timeIn || !existingPunch.breakStart || existingPunch.timeOut) {
      return Response.json({ error: "Start a break before ending it, and end the break before clock-out." }, { status: 409 });
    }
    if (existingPunch.breakEnd) {
      return Response.json({ error: "This break has already ended." }, { status: 409 });
    }
    const [updated] = await db.update(timePunches).set({
      breakEnd: now,
      notes: (existingPunch.notes ? existingPunch.notes + " · " : "") + "Break ended via Web Bundy",
    }).where(eq(timePunches.id, existingPunch.id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Web Bundy Break END",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { employeeId, workDate: todayStr, breakEnd: now.toISOString(), ip },
    });
    return Response.json({ ok: true, action: "break_end", punch: updated });
  }

  if (actionType === "clock_in") {
    if (existingPunch?.timeIn) {
      return Response.json({
        error: `Already clocked in today at ${new Date(existingPunch.timeIn).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila" })}.`,
        punch: existingPunch,
      }, { status: 409 });
    }

    const [punch] = existingPunch
      ? await db.update(timePunches).set({
          timeIn: now,
          source: "web_bundy",
          ipAddress: ip,
          location,
          status: existingPunch.timeOut ? "Complete" : "Incomplete",
        }).where(eq(timePunches.id, existingPunch.id)).returning()
      : await db.insert(timePunches).values({
          organizationId,
          employeeId,
          workDate: todayStr,
          timeIn: now,
          timeOut: null,
          shiftStart: "09:00",
          shiftEnd: "18:00",
          source: "web_bundy",
          ipAddress: ip,
          location,
          status: "Incomplete",
          notes: "Clocked in via Web Bundy",
        }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Web Bundy Clock IN",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { employeeId, workDate: todayStr, timeIn: now.toISOString(), ip },
    });

    return Response.json({ ok: true, action: "clock_in", punch }, { status: existingPunch ? 200 : 201 });
  }

  if (!existingPunch || !existingPunch.timeIn) {
    const [created] = await db.insert(timePunches).values({
      organizationId,
      employeeId,
      workDate: todayStr,
      timeIn: null,
      timeOut: now,
      shiftStart: "09:00",
      shiftEnd: "18:00",
      source: "web_bundy",
      ipAddress: ip,
      location,
      status: "Incomplete",
      notes: "Clocked out without Clock IN punch",
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Web Bundy Clock OUT without IN",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { employeeId, workDate: todayStr, timeOut: now.toISOString(), ip },
    });

    return Response.json({
      ok: true,
      action: "clock_out",
      punch: created,
      warning: "Clock out recorded without prior clock-in.",
    }, { status: 201 });
  }

  if (existingPunch.breakStart && !existingPunch.breakEnd) {
    return Response.json({
      error: "End the active break before clocking out so paid hours and night differential can be calculated correctly.",
    }, { status: 409 });
  }

  if (existingPunch.timeOut) {
    return Response.json({
      error: `Already clocked out today at ${new Date(existingPunch.timeOut).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila" })}.`,
      punch: existingPunch,
    }, { status: 409 });
  }

  const [updated] = await db.update(timePunches).set({
    timeOut: now,
    status: "Complete",
    notes: (existingPunch.notes ? existingPunch.notes + " · " : "") + "Clocked out via Web Bundy",
  }).where(eq(timePunches.id, existingPunch.id)).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Web Bundy Clock OUT",
    resource: `${employee.firstName} ${employee.lastName}`,
    metadata: { employeeId, workDate: todayStr, timeOut: now.toISOString(), ip },
  });

  return Response.json({ ok: true, action: "clock_out", punch: updated });
}
