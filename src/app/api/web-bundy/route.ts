import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, timePunches } from "@/db/schema";
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
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  let employeeId = Number(body.employeeId);
  const actionType = String(body.actionType ?? "");
  const location = String(body.location ?? "Web Bundy Clock (Browser)").slice(0, 160);
  const ip = clientIp(request);

  if (!Number.isInteger(organizationId) || !["clock_in", "clock_out"].includes(actionType)) {
    return Response.json({ error: "organizationId and actionType clock_in/clock_out are required." }, { status: 400 });
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


export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const punchId = Number(body.punchId);
  const suppliedTimeIn = String(body.timeIn ?? "").trim();
  const suppliedTimeOut = String(body.timeOut ?? "").trim();
  const reason = String(body.reason ?? "").trim().slice(0, 240);

  if (!Number.isInteger(organizationId) || !Number.isInteger(punchId)) {
    return Response.json({ error: "organizationId and punchId are required." }, { status: 400 });
  }
  if (!reason || reason.length < 4) {
    return Response.json({ error: "Add a short reason for the attendance correction." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can correct attendance records.",
  );
  if (denied) return denied;

  const [punch] = await db.select().from(timePunches).where(
    and(eq(timePunches.id, punchId), eq(timePunches.organizationId, organizationId)),
  ).limit(1);
  if (!punch) return Response.json({ error: "Attendance record not found." }, { status: 404 });

  if (punch.timeIn && punch.timeOut) {
    return Response.json({
      error: "This correction flow is only for incomplete punches. Complete records require a separate audited adjustment workflow.",
    }, { status: 409 });
  }

  const [employee] = await db.select().from(employees).where(
    and(eq(employees.id, punch.employeeId), eq(employees.organizationId, organizationId)),
  ).limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });

  const timeIn = punch.timeIn ?? parseManilaPunchTime(punch.workDate, suppliedTimeIn);
  let timeOut = punch.timeOut ?? parseManilaPunchTime(punch.workDate, suppliedTimeOut);

  if (!timeIn) return Response.json({ error: "Enter the missing clock-in time in HH:MM format." }, { status: 400 });
  if (!timeOut) return Response.json({ error: "Enter the missing clock-out time in HH:MM format." }, { status: 400 });

  // Overnight shifts are valid. If a manually supplied clock-out is earlier
  // than clock-in on the work date, interpret it as the following calendar day.
  if (timeOut.getTime() <= timeIn.getTime() && !punch.timeOut && suppliedTimeOut) {
    timeOut = new Date(timeOut.getTime() + 24 * 60 * 60 * 1000);
  }
  if (timeOut.getTime() <= timeIn.getTime()) {
    return Response.json({ error: "Clock-out must be later than clock-in." }, { status: 400 });
  }

  const previous = {
    timeIn: punch.timeIn?.toISOString() ?? null,
    timeOut: punch.timeOut?.toISOString() ?? null,
    status: punch.status,
  };

  const [updated] = await db.update(timePunches).set({
    timeIn,
    timeOut,
    status: "Complete",
    notes: [punch.notes, "Attendance correction by " + user.name + ": " + reason].filter(Boolean).join(" · "),
  }).where(and(
    eq(timePunches.id, punchId),
    eq(timePunches.organizationId, organizationId),
  )).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Attendance punch corrected",
    resource: employee.firstName + " " + employee.lastName,
    metadata: {
      employeeId: employee.id,
      punchId,
      workDate: punch.workDate,
      previous,
      corrected: {
        timeIn: timeIn.toISOString(),
        timeOut: timeOut.toISOString(),
        status: "Complete",
      },
      reason,
    },
  });

  return Response.json({
    ok: true,
    punch: updated,
    message: "Attendance corrected. Recalculate any payroll run that already used this work date.",
  });
}

function parseManilaPunchTime(workDate: string, value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const parsed = new Date(workDate + "T" + value + ":00+08:00");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
