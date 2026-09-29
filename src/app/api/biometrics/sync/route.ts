import { timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { biometricDevices, employees, timePunches } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

import { denyPublicDemoSideEffect } from "@/lib/public-demo-guard";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view biometric devices.",
  );
  if (denied) return denied;

  const devices = await db.select().from(biometricDevices)
    .where(eq(biometricDevices.organizationId, organizationId))
    .orderBy(desc(biometricDevices.id));

  return Response.json({
    devices,
    protocolsSupported: ["ADMS (Push SDK)", "Port Forwarding (TCP/IP)", "REST Webhook (Cloud)"],
  });
}

/**
 * Biometric ingestion accepts either:
 * 1. a signed-in People administrator, for manual/test syncs, or
 * 2. Authorization: Bearer <BIOMETRIC_INGEST_SECRET> for a trusted device gateway.
 *
 * A deployment without a configured device secret never exposes anonymous
 * attendance ingestion.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const deviceSerial = String(body.deviceSerial ?? "").trim();
  const logs = Array.isArray(body.logs) ? body.logs : [];

  if (!Number.isInteger(organizationId) || !deviceSerial) {
    return Response.json({ error: "organizationId and deviceSerial are required." }, { status: 400 });
  }
  if (logs.length === 0 || logs.length > 2_000) {
    return Response.json({ error: "Provide between 1 and 2,000 punch logs per request." }, { status: 400 });
  }

  const user = await getSessionUser();
  const deviceSecretAccepted = acceptsDeviceSecret(request);
  if (!deviceSecretAccepted) {
    if (!user) {
      return Response.json({
        error: process.env.BIOMETRIC_INGEST_SECRET
          ? "A valid biometric ingest credential is required."
          : "Biometric device ingestion is disabled until BIOMETRIC_INGEST_SECRET is configured.",
      }, { status: process.env.BIOMETRIC_INGEST_SECRET ? 401 : 503 });
    }

    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can sync biometric attendance.",
    );
    if (denied) return denied;
  }

  const demoDenied = await denyPublicDemoSideEffect(organizationId, "Biometric ingestion");
  if (demoDenied) return demoDenied;

  const [device] = await db
    .select()
    .from(biometricDevices)
    .where(and(
      eq(biometricDevices.organizationId, organizationId),
      eq(biometricDevices.serialNumber, deviceSerial),
    ))
    .limit(1);

  if (!device) {
    return Response.json({
      error: "Unknown biometric device for this workspace. Register the device before accepting punch logs.",
    }, { status: 404 });
  }

  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  const staffByNo = new Map(staff.map((employee) => [employee.employeeNo.toUpperCase(), employee]));

  let ingested = 0;
  let unmatched = 0;
  let invalid = 0;

  for (const raw of logs) {
    if (!raw || typeof raw !== "object") {
      invalid += 1;
      continue;
    }
    const log = raw as Record<string, unknown>;
    const empNo = String(log.employeeNo ?? log.badgeNumber ?? "").trim().toUpperCase();
    const timestampStr = String(log.timestamp ?? "");
    const punchType = String(log.punchType ?? "0");

    if (!empNo || !timestampStr) {
      invalid += 1;
      continue;
    }

    const employee = staffByNo.get(empNo);
    if (!employee) {
      unmatched += 1;
      continue;
    }

    const punchDate = new Date(timestampStr);
    if (Number.isNaN(punchDate.getTime())) {
      invalid += 1;
      continue;
    }

    const workDate = localDateFromInput(timestampStr, punchDate);
    const [existing] = await db.select().from(timePunches).where(
      and(
        eq(timePunches.organizationId, organizationId),
        eq(timePunches.employeeId, employee.id),
        eq(timePunches.workDate, workDate),
      ),
    ).limit(1);

    const isIn = punchType === "0" || punchType.toLowerCase() === "in";
    if (isIn) {
      if (!existing) {
        await db.insert(timePunches).values({
          organizationId,
          employeeId: employee.id,
          workDate,
          timeIn: punchDate,
          timeOut: null,
          shiftStart: "09:00",
          shiftEnd: "18:00",
          source: "biometric_adms",
          deviceSerial,
          status: "Incomplete",
          notes: `ADMS Biometric IN (${device.deviceModel})`,
        });
      } else if (!existing.timeIn || punchDate < new Date(existing.timeIn)) {
        await db.update(timePunches).set({
          timeIn: punchDate,
          status: existing.timeOut ? "Complete" : "Incomplete",
          source: "biometric_adms",
          deviceSerial,
        }).where(eq(timePunches.id, existing.id));
      }
    } else {
      if (!existing) {
        await db.insert(timePunches).values({
          organizationId,
          employeeId: employee.id,
          workDate,
          timeIn: null,
          timeOut: punchDate,
          shiftStart: "09:00",
          shiftEnd: "18:00",
          source: "biometric_adms",
          deviceSerial,
          status: "Incomplete",
          notes: `ADMS Biometric OUT (${device.deviceModel})`,
        });
      } else if (!existing.timeOut || punchDate > new Date(existing.timeOut)) {
        await db.update(timePunches).set({
          timeOut: punchDate,
          status: existing.timeIn ? "Complete" : "Incomplete",
          notes: (existing.notes ? existing.notes + " · " : "") + "ADMS OUT",
          source: "biometric_adms",
          deviceSerial,
        }).where(eq(timePunches.id, existing.id));
      }
    }

    ingested += 1;
  }

  await db.update(biometricDevices).set({
    lastSyncAt: new Date(),
    status: "online",
  }).where(eq(biometricDevices.id, device.id));

  await recordAuditEvent({
    organizationId,
    actor: user?.name ?? `Biometric Device [${deviceSerial}]`,
    action: "Biometric attendance logs synced",
    resource: device.branchName,
    metadata: {
      totalLogs: logs.length,
      ingested,
      unmatched,
      invalid,
      deviceSerial,
      authentication: user ? "session" : "device-secret",
    },
  });

  return Response.json({
    ok: true,
    deviceSerial,
    ingested,
    unmatched,
    invalid,
    syncedAt: new Date().toISOString(),
  });
}

function acceptsDeviceSecret(request: Request) {
  const configured = process.env.BIOMETRIC_INGEST_SECRET;
  if (!configured) return false;

  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  const supplied = header.slice(7).trim();

  const expectedBytes = Buffer.from(configured);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function localDateFromInput(raw: string, parsed: Date) {
  const localPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return localPrefix?.[1] ?? parsed.toISOString().slice(0, 10);
}
