import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceCapturePolicies,
  attendanceOfflineEvents,
  biometricDevices,
  employees,
  timePunches,
} from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { verifyBiometricDeviceCredential } from "@/lib/biometric-auth";
import { rateLimitDistributed } from "@/lib/rate-limit";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["clock_in", "break_start", "break_end", "clock_out"]);
const DEFAULT_POLICY = {
  mobileClockEnabled: true,
  kioskClockEnabled: false,
  offlineSyncEnabled: false,
  requireLocation: false,
  maxOfflineAgeMinutes: 1440,
};

function manilaDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function loadPolicy(organizationId: number) {
  const [row] = await db.select().from(attendanceCapturePolicies)
    .where(eq(attendanceCapturePolicies.organizationId, organizationId))
    .limit(1);
  return row ?? DEFAULT_POLICY;
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const deviceSerial = String(body.deviceSerial ?? "").trim();
  const rawEvents = Array.isArray(body.events) ? body.events : [];

  if (!Number.isInteger(organizationId) || rawEvents.length < 1 || rawEvents.length > 250) {
    return Response.json({ error: "organizationId and 1 to 250 attendance events are required." }, { status: 400 });
  }

  const policy = await loadPolicy(organizationId);
  if (!policy.offlineSyncEnabled) {
    return Response.json({ error: "Offline attendance synchronization is disabled for this organization." }, { status: 403 });
  }

  let user: Awaited<ReturnType<typeof getSessionUser>> = null;
  let kioskDevice: typeof biometricDevices.$inferSelect | null = null;

  if (authorization) {
    if (!policy.kioskClockEnabled || !deviceSerial) {
      return Response.json({ error: "Kiosk attendance synchronization is disabled or missing a device serial." }, { status: 403 });
    }
    if (!authorization.toLowerCase().startsWith("bearer ")) {
      return Response.json({ error: "A valid kiosk device credential is required." }, { status: 401 });
    }
    const supplied = authorization.slice(7).trim();
    if (!verifyBiometricDeviceCredential(supplied, process.env.BIOMETRIC_INGEST_SECRET, organizationId, deviceSerial)) {
      return Response.json({ error: "A valid kiosk device credential is required." }, { status: 401 });
    }
    const [device] = await db.select().from(biometricDevices).where(and(
      eq(biometricDevices.organizationId, organizationId),
      eq(biometricDevices.serialNumber, deviceSerial),
    )).limit(1);
    if (!device || device.protocol.trim().toUpperCase() !== "KIOSK") {
      return Response.json({ error: "Register this device with protocol KIOSK before synchronizing attendance." }, { status: 403 });
    }
    kioskDevice = device;
  } else {
    const originDenied = enforceSameOriginMutation(request);
    if (originDenied) return originDenied;
    user = await getSessionUser();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (!policy.mobileClockEnabled) {
      return Response.json({ error: "Mobile attendance capture is disabled for this organization." }, { status: 403 });
    }
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
    if (!user.employeeId) {
      return Response.json({ error: "Offline mobile sync requires a linked employee profile." }, { status: 403 });
    }
  }

  const limit = await rateLimitDistributed(
    kioskDevice ? `attendance-sync:kiosk:${kioskDevice.id}` : `attendance-sync:user:${user!.id}:${organizationId}`,
    { limit: 30, windowMs: 60_000 },
  );
  if (!limit.allowed) {
    return Response.json({ error: "Too many attendance synchronization requests. Try again shortly." }, { status: 429 });
  }

  const staff = kioskDevice
    ? await db.select().from(employees).where(eq(employees.organizationId, organizationId))
    : [];
  const employeeByNo = new Map(staff.map((employee) => [employee.employeeNo.trim().toUpperCase(), employee]));

  const events = rawEvents.map((value) => value as Record<string, unknown>).sort((a, b) =>
    String(a.occurredAt ?? "").localeCompare(String(b.occurredAt ?? ""))
  );
  const now = Date.now();
  let applied = 0;
  let duplicate = 0;
  let rejected = 0;
  const stale = new Set<string>();

  for (const event of events) {
    const clientEventId = String(event.clientEventId ?? "").trim();
    const actionType = String(event.actionType ?? "").trim();
    const occurredAt = new Date(String(event.occurredAt ?? ""));
    const location = String(event.location ?? "").trim().slice(0, 500) || null;

    let employeeId = user?.employeeId ?? null;
    if (kioskDevice) {
      const employeeNo = String(event.employeeNo ?? "").trim().toUpperCase();
      employeeId = employeeByNo.get(employeeNo)?.id ?? null;
    }

    if (
      clientEventId.length < 8 || clientEventId.length > 96
      || !ACTIONS.has(actionType)
      || Number.isNaN(occurredAt.getTime())
      || !employeeId
    ) {
      rejected += 1;
      continue;
    }
    if (policy.requireLocation && !location) {
      rejected += 1;
      continue;
    }

    const ageMinutes = (now - occurredAt.getTime()) / 60_000;
    if (ageMinutes < -5 || ageMinutes > policy.maxOfflineAgeMinutes) {
      rejected += 1;
      continue;
    }

    const workDate = manilaDate(occurredAt);
    const source = kioskDevice ? "kiosk_offline" : "mobile_offline";

    const result = await db.transaction(async (tx) => {
      const inserted = await tx.insert(attendanceOfflineEvents).values({
        organizationId,
        employeeId: employeeId!,
        clientEventId,
        actionType,
        occurredAt,
        source,
        deviceSerial: kioskDevice?.serialNumber ?? null,
        location,
        status: "received",
      }).onConflictDoNothing({
        target: [attendanceOfflineEvents.organizationId, attendanceOfflineEvents.clientEventId],
      }).returning({ id: attendanceOfflineEvents.id });

      if (!inserted[0]) return { status: "duplicate" as const, punchId: null };

      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${employeeId}:${workDate}`}))`);
      const [existing] = await tx.select().from(timePunches).where(and(
        eq(timePunches.organizationId, organizationId),
        eq(timePunches.employeeId, employeeId!),
        eq(timePunches.workDate, workDate),
      )).limit(1);

      let punch: typeof timePunches.$inferSelect | null = null;
      let reason: string | null = null;

      if (actionType === "clock_in") {
        if (existing?.timeIn) {
          reason = "Clock IN already exists for this work date.";
        } else if (existing) {
          [punch] = await tx.update(timePunches).set({
            timeIn: occurredAt,
            source,
            deviceSerial: kioskDevice?.serialNumber ?? null,
            location,
            status: existing.timeOut ? "Complete" : "Incomplete",
          }).where(eq(timePunches.id, existing.id)).returning();
        } else {
          [punch] = await tx.insert(timePunches).values({
            organizationId,
            employeeId: employeeId!,
            workDate,
            timeIn: occurredAt,
            timeOut: null,
            shiftStart: "09:00",
            shiftEnd: "18:00",
            source,
            deviceSerial: kioskDevice?.serialNumber ?? null,
            location,
            status: "Incomplete",
            notes: "Offline Clock IN synchronized",
          }).returning();
        }
      } else if (actionType === "break_start") {
        if (!existing?.timeIn || existing.timeOut || existing.breakStart) {
          reason = "Break START does not follow a valid open attendance record.";
        } else {
          [punch] = await tx.update(timePunches).set({ breakStart: occurredAt })
            .where(eq(timePunches.id, existing.id)).returning();
        }
      } else if (actionType === "break_end") {
        if (!existing?.timeIn || !existing.breakStart || existing.breakEnd || existing.timeOut) {
          reason = "Break END does not follow a valid active break.";
        } else {
          [punch] = await tx.update(timePunches).set({ breakEnd: occurredAt })
            .where(eq(timePunches.id, existing.id)).returning();
        }
      } else if (!existing?.timeIn) {
        [punch] = await tx.insert(timePunches).values({
          organizationId,
          employeeId: employeeId!,
          workDate,
          timeIn: null,
          timeOut: occurredAt,
          shiftStart: "09:00",
          shiftEnd: "18:00",
          source,
          deviceSerial: kioskDevice?.serialNumber ?? null,
          location,
          status: "Incomplete",
          notes: "Offline Clock OUT synchronized without prior IN",
        }).returning();
      } else if (existing.timeOut) {
        reason = "Clock OUT already exists for this work date.";
      } else if (existing.breakStart && !existing.breakEnd) {
        reason = "End the active break before Clock OUT.";
      } else {
        [punch] = await tx.update(timePunches).set({
          timeOut: occurredAt,
          status: "Complete",
        }).where(eq(timePunches.id, existing.id)).returning();
      }

      if (reason) {
        await tx.update(attendanceOfflineEvents).set({
          status: "rejected",
          rejectionReason: reason,
        }).where(eq(attendanceOfflineEvents.id, inserted[0].id));
        return { status: "rejected" as const, punchId: null };
      }

      await tx.update(attendanceOfflineEvents).set({
        status: "applied",
        appliedPunchId: punch!.id,
      }).where(eq(attendanceOfflineEvents.id, inserted[0].id));
      return { status: "applied" as const, punchId: punch!.id };
    });

    if (result.status === "duplicate") duplicate += 1;
    if (result.status === "rejected") rejected += 1;
    if (result.status === "applied") {
      applied += 1;
      stale.add(`${employeeId}|${workDate}`);
    }
  }

  for (const value of stale) {
    const [employeeIdText, workDate] = value.split("|");
    await markTimesheetsStaleForEmployeeDate({
      organizationId,
      employeeId: Number(employeeIdText),
      workDate,
    });
  }

  await recordAuditEvent({
    organizationId,
    actor: kioskDevice ? `Kiosk [${kioskDevice.serialNumber}]` : user!.name,
    action: "WFM offline attendance synchronized",
    resource: kioskDevice?.branchName ?? "Mobile attendance",
    metadata: {
      source: kioskDevice ? "kiosk_offline" : "mobile_offline",
      received: events.length,
      applied,
      duplicate,
      rejected,
      deviceSerial: kioskDevice?.serialNumber ?? null,
    },
  });

  return Response.json({ ok: true, received: events.length, applied, duplicate, rejected });
}
