import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { biometricDevices, employees, timePunches } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { rateLimitDistributed } from "@/lib/rate-limit";
import { verifyBiometricDeviceCredential } from "@/lib/biometric-auth";

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
    bufferedOfflineSync: true,
    replayBehavior: "Earliest IN and latest OUT win; exact replays are ignored.",
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
  const authorization = request.headers.get("authorization");
  let user: Awaited<ReturnType<typeof getSessionUser>> = null;

  if (!authorization) {
    const originDenied = enforceSameOriginMutation(request);
    if (originDenied) return originDenied;

    user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
    return Response.json({ error: "Biometric sync payload is too large." }, { status: 413 });
  }

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const deviceSerial = String(body.deviceSerial ?? "").trim();
  const logs = Array.isArray(body.logs) ? body.logs : [];

  if (!Number.isInteger(organizationId) || !deviceSerial) {
    return Response.json({ error: "organizationId and deviceSerial are required." }, { status: 400 });
  }
  if (deviceSerial.length > 160) {
    return Response.json({ error: "deviceSerial is invalid." }, { status: 400 });
  }
  if (logs.length === 0 || logs.length > 2_000) {
    return Response.json({ error: "Provide between 1 and 2,000 punch logs per request." }, { status: 400 });
  }

  const deviceSecretAccepted = Boolean(authorization) &&
    acceptsDeviceSecret(request, organizationId, deviceSerial);

  if (authorization) {
    // A gateway credential is bound to one organization + device serial. A
    // compromised device token therefore cannot be replayed against another
    // tenant merely by changing request fields.
    if (!deviceSecretAccepted) {
      return Response.json({ error: "A valid biometric ingest credential is required." }, { status: 401 });
    }
  } else {
    const denied = await assertOrganizationRole(
      user!.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can sync biometric attendance.",
    );
    if (denied) return denied;
  }

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

  const ingestLimit = await rateLimitDistributed(
    deviceSecretAccepted
      ? `biometric-sync:device:${device.id}`
      : `biometric-sync:user:${user!.id}:${organizationId}`,
    { limit: deviceSecretAccepted ? 120 : 30, windowMs: 60_000 },
  );
  if (!ingestLimit.allowed) {
    return Response.json({ error: "Too many biometric sync requests. Try again shortly." }, { status: 429 });
  }

  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  const staffByNo = new Map(staff.map((employee) => [employee.employeeNo.toUpperCase(), employee]));

  let ingested = 0;
  let duplicates = 0;
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
    let applied = false;
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
        applied = true;
      } else if (!existing.timeIn || punchDate < new Date(existing.timeIn)) {
        await db.update(timePunches).set({
          timeIn: punchDate,
          status: existing.timeOut ? "Complete" : "Incomplete",
          source: "biometric_adms",
          deviceSerial,
        }).where(eq(timePunches.id, existing.id));
        applied = true;
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
        applied = true;
      } else if (!existing.timeOut || punchDate > new Date(existing.timeOut)) {
        await db.update(timePunches).set({
          timeOut: punchDate,
          status: existing.timeIn ? "Complete" : "Incomplete",
          notes: (existing.notes ? existing.notes + " · " : "") + "ADMS OUT",
          source: "biometric_adms",
          deviceSerial,
        }).where(eq(timePunches.id, existing.id));
        applied = true;
      }
    }

    if (applied) ingested += 1;
    else duplicates += 1;
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
      duplicates,
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
    duplicates,
    unmatched,
    invalid,
    syncedAt: new Date().toISOString(),
  });
}

function acceptsDeviceSecret(request: Request, organizationId: number, deviceSerial: string) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  const supplied = header.slice(7).trim();

  return verifyBiometricDeviceCredential(
    supplied,
    process.env.BIOMETRIC_INGEST_SECRET,
    organizationId,
    deviceSerial,
  );
}

function localDateFromInput(raw: string, parsed: Date) {
  const localPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return localPrefix?.[1] ?? parsed.toISOString().slice(0, 10);
}
