import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceCapturePolicies } from "@/db/schema";
import {
  assertMembership,
  assertOrganizationRole,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const DEFAULT_POLICY = {
  webBundyEnabled: true,
  mobileClockEnabled: true,
  kioskClockEnabled: false,
  offlineSyncEnabled: false,
  requireLocation: false,
  maxOfflineAgeMinutes: 1440,
};

async function loadPolicy(organizationId: number) {
  const [row] = await db.select().from(attendanceCapturePolicies)
    .where(eq(attendanceCapturePolicies.organizationId, organizationId))
    .limit(1);
  return row ?? { id: null, organizationId, ...DEFAULT_POLICY };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  if (user.role === "employee") {
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      WORKFORCE_MANAGER_ROLES,
      "Workforce access is required to view attendance capture controls.",
    );
    if (denied) return denied;
  }

  return Response.json({ policy: await loadPolicy(organizationId) });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Only workforce managers can change attendance capture controls.",
  );
  if (denied) return denied;

  const maxOfflineAgeMinutes = Number(body.maxOfflineAgeMinutes);
  if (!Number.isInteger(maxOfflineAgeMinutes) || maxOfflineAgeMinutes < 15 || maxOfflineAgeMinutes > 10080) {
    return Response.json({ error: "Offline punch age must be between 15 minutes and 7 days." }, { status: 400 });
  }

  const values = {
    webBundyEnabled: body.webBundyEnabled !== false,
    mobileClockEnabled: body.mobileClockEnabled !== false,
    kioskClockEnabled: body.kioskClockEnabled === true,
    offlineSyncEnabled: body.offlineSyncEnabled === true,
    requireLocation: body.requireLocation === true,
    maxOfflineAgeMinutes,
    updatedBy: user.name,
    updatedByUserId: user.id,
    updatedAt: new Date(),
  };

  const [existing] = await db.select({ id: attendanceCapturePolicies.id })
    .from(attendanceCapturePolicies)
    .where(eq(attendanceCapturePolicies.organizationId, organizationId))
    .limit(1);

  const [policy] = existing
    ? await db.update(attendanceCapturePolicies).set(values)
        .where(and(
          eq(attendanceCapturePolicies.id, existing.id),
          eq(attendanceCapturePolicies.organizationId, organizationId),
        )).returning()
    : await db.insert(attendanceCapturePolicies).values({
        organizationId,
        ...values,
      }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "WFM attendance capture policy updated",
    resource: "Attendance capture",
    metadata: {
      webBundyEnabled: policy.webBundyEnabled,
      mobileClockEnabled: policy.mobileClockEnabled,
      kioskClockEnabled: policy.kioskClockEnabled,
      offlineSyncEnabled: policy.offlineSyncEnabled,
      requireLocation: policy.requireLocation,
      maxOfflineAgeMinutes: policy.maxOfflineAgeMinutes,
    },
  });

  return Response.json({ policy });
}
