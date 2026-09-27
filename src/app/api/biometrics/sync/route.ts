import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { biometricDevices, employees, timePunches } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertAnyPermission } from "@/lib/access";
import { authenticateApiKey, requireScope } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const denied = await assertAnyPermission(user.id, organizationId, ["hr:read", "integrations:read"]);
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
 * Biometric Ingestion Endpoint
 * Compatible with ZKTeco ADMS, Hikvision face terminals, and generic biometric push loggers.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  if (!requireScope(auth.scopes, "attendance:write")) return Response.json({ error: "API key is missing the attendance:write scope." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const organizationId = auth.organizationId;
  const deviceSerial = String(body.deviceSerial ?? "").trim();
  const logs = Array.isArray(body.logs) ? body.logs : [];
  if (!deviceSerial) return Response.json({ error: "deviceSerial is required." }, { status: 400 });
  if (logs.length === 0) return Response.json({ error: "No punch logs provided." }, { status: 400 });
  const [device] = await db.select().from(biometricDevices).where(and(eq(biometricDevices.serialNumber, deviceSerial), eq(biometricDevices.organizationId, organizationId))).limit(1);
  if (!device) return Response.json({ error: "Biometric device is not registered in this workspace." }, { status: 404 });

  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  const staffByNo = new Map(staff.map((e) => [e.employeeNo.toUpperCase(), e]));

  let ingested = 0;
  let unmatched = 0;

  for (const log of logs) {
    const empNo = String(log.employeeNo ?? log.badgeNumber ?? "").trim().toUpperCase();
    const timestampStr = String(log.timestamp ?? "");
    const punchType = String(log.punchType ?? "0"); // "0" = IN, "1" = OUT

    if (!empNo || !timestampStr) continue;

    const employee = staffByNo.get(empNo);
    if (!employee) {
      unmatched += 1;
      continue;
    }

    const punchDate = new Date(timestampStr);
    if (isNaN(punchDate.getTime())) continue;

    const workDate = punchDate.toISOString().slice(0, 10);

    const [existing] = await db.select().from(timePunches).where(
      and(
        eq(timePunches.organizationId, organizationId),
        eq(timePunches.employeeId, employee.id),
        eq(timePunches.workDate, workDate),
      ),
    ).limit(1);

    if (punchType === "0" || punchType.toLowerCase() === "in") {
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
          notes: `ADMS Biometric IN (${device?.deviceModel ?? "Terminal"})`,
        });
      } else if (!existing.timeIn) {
        await db.update(timePunches).set({
          timeIn: punchDate,
          status: existing.timeOut ? "Complete" : "Incomplete",
          source: "biometric_adms",
          deviceSerial,
        }).where(eq(timePunches.id, existing.id));
      }
    } else {
      // OUT punch
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
          notes: `ADMS Biometric OUT (${device?.deviceModel ?? "Terminal"})`,
        });
      } else {
        await db.update(timePunches).set({
          timeOut: punchDate,
          status: existing.timeIn ? "Complete" : "Incomplete",
          notes: (existing.notes ? existing.notes + " · " : "") + "ADMS OUT",
        }).where(eq(timePunches.id, existing.id));
      }
    }

    ingested += 1;
  }

  if (device) {
    await db.update(biometricDevices).set({
      lastSyncAt: new Date(),
      status: "online",
    }).where(eq(biometricDevices.id, device.id));
  }

  await recordAuditEvent({
    organizationId,
    actor: `Biometric Device [${deviceSerial}] via API key ${auth.keyId}`,
    action: "Biometric attendance logs synced",
    resource: device?.branchName ?? "Biometric Terminal",
    metadata: { totalLogs: logs.length, ingested, unmatched, deviceSerial },
  });

  return Response.json({
    ok: true,
    deviceSerial,
    ingested,
    unmatched,
    syncedAt: new Date().toISOString(),
  });
}
