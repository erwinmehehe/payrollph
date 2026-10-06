import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { hcmLifecyclePolicyEvents } from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_ADMIN_ROLES,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser, requireSensitiveActionMfa } from "@/lib/auth";
import {
  HcmLifecyclePolicyConflictError,
  lifecyclePolicySnapshot,
  loadHcmLifecyclePolicy,
  parseHcmLifecyclePolicyInput,
  saveHcmLifecyclePolicy,
} from "@/lib/hcm-lifecycle-policy";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function companyWidePolicyAccess(
  userId: number,
  organizationId: number,
  roles: readonly string[],
  message: string,
) {
  const denied = await assertOrganizationRole(userId, organizationId, roles, message);
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return {
      error: Response.json({
        error: "Lifecycle policy configuration requires company-wide People or payroll access.",
      }, { status: 403 }),
    };
  }
  return { access };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "A valid organizationId is required." }, { status: 400 });
  }

  const gate = await companyWidePolicyAccess(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to view employment lifecycle policy.",
  );
  if ("error" in gate) return gate.error;

  const [policy, events] = await Promise.all([
    loadHcmLifecyclePolicy(organizationId),
    db.select().from(hcmLifecyclePolicyEvents)
      .where(eq(hcmLifecyclePolicyEvents.organizationId, organizationId))
      .orderBy(desc(hcmLifecyclePolicyEvents.createdAt), desc(hcmLifecyclePolicyEvents.id))
      .limit(25),
  ]);

  return Response.json({
    policy,
    history: events,
    canManage: PEOPLE_ADMIN_ROLES.includes(gate.access.role as any),
  });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(organizationId) || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return Response.json({
      error: "Valid organizationId and expectedVersion are required.",
    }, { status: 400 });
  }

  const gate = await companyWidePolicyAccess(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only company-wide People administrators can update employment lifecycle policy.",
  );
  if ("error" in gate) return gate.error;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "hcm-lifecycle-policy-update",
    resourceId: organizationId,
    limit: 12,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  let config;
  try {
    config = parseHcmLifecyclePolicyInput(body);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Lifecycle policy is invalid.",
    }, { status: 400 });
  }

  try {
    const saved = await saveHcmLifecyclePolicy({
      organizationId,
      expectedVersion,
      config,
      actorUserId: user.id,
      actorName: user.name,
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM lifecycle policy updated",
      resource: "Employment lifecycle policy",
      metadata: {
        previousVersion: expectedVersion,
        version: saved.version,
        policy: lifecyclePolicySnapshot(config),
      },
    });

    return Response.json({ policy: await loadHcmLifecyclePolicy(organizationId) });
  } catch (error) {
    if (error instanceof HcmLifecyclePolicyConflictError) {
      return Response.json({ error: error.message, code: "POLICY_VERSION_CONFLICT" }, { status: 409 });
    }
    return Response.json({ error: "Lifecycle policy could not be saved." }, { status: 409 });
  }
}
