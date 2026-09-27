import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, timePunches } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function manilaToday() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const manila = new Date(utc + 3600000 * 8); // UTC+8
  return manila.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const employeeId = Number(url.searchParams.get("employeeId") ?? (user.role === "employee" ? user.employeeId : 0));

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

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
  const organizationId = Number(body.organizationId ?? 1);
  let employeeId = Number(body.employeeId);
  const actionType = String(body.actionType ?? "clock_in"); // "clock_in" | "clock_out"
  const location = String(body.location ?? "Web Bundy Clock (Browser)");
  const ip = clientIp(request);

  if (user.role === "employee" && user.employeeId) {
    employeeId = user.employeeId;
  }

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee || employee.organizationId !== organizationId) {
    return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }

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
    if (existingPunch && existingPunch.timeIn) {
      return Response.json({
        error: `Already clocked in today at ${new Date(existingPunch.timeIn).toLocaleTimeString("en-PH")}.`,
        punch: existingPunch,
      }, { status: 409 });
    }

    if (existingPunch) {
      const [updated] = await db.update(timePunches).set({
        timeIn: now,
        source: "web_bundy",
        ipAddress: ip,
        location,
        status: existingPunch.timeOut ? "Complete" : "Incomplete",
      }).where(eq(timePunches.id, existingPunch.id)).returning();

      return Response.json({ ok: true, action: "clock_in", punch: updated });
    }

    const [created] = await db.insert(timePunches).values({
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
      metadata: { workDate: todayStr, timeIn: now.toISOString(), ip },
    });

    return Response.json({ ok: true, action: "clock_in", punch: created }, { status: 201 });
  }

  // clock_out
  if (!existingPunch || !existingPunch.timeIn) {
    // Punch in first or record clock out with exception flag
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

    return Response.json({ ok: true, action: "clock_out", punch: created, warning: "Clock out recorded without prior clock-in." }, { status: 201 });
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
    metadata: { workDate: todayStr, timeOut: now.toISOString(), ip },
  });

  return Response.json({ ok: true, action: "clock_out", punch: updated });
}
