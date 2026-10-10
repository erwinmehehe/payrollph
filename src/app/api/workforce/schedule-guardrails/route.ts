import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, workforceScheduleGuardrailPolicies } from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_ADMIN_ROLES,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
  type ScheduleGuardrailPolicy,
} from "@/lib/workforce-schedule-guardrails";

export const dynamic = "force-dynamic";

function normalizePolicy(row: typeof workforceScheduleGuardrailPolicies.$inferSelect | undefined): ScheduleGuardrailPolicy {
  if (!row) return DEFAULT_SCHEDULE_GUARDRAIL_POLICY;
  return {
    minimumRestMinutes: row.minimumRestMinutes,
    maxConsecutiveWorkingDays: row.maxConsecutiveWorkingDays,
    rollingSevenDayMinutes: row.rollingSevenDayMinutes,
    enforcementMode: row.enforcementMode === "block" ? "block" : "advisory",
    active: row.active,
  };
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
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can review WFM schedule guardrails.",
  );
  if (denied) return denied;

  const [row] = await db.select().from(workforceScheduleGuardrailPolicies)
    .where(eq(workforceScheduleGuardrailPolicies.organizationId, organizationId))
    .limit(1);

  return Response.json({
    policy: normalizePolicy(row),
    configured: Boolean(row),
    note: "Fatigue thresholds are company policy controls. They are not presented as universal statutory entitlements.",
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
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage WFM schedule guardrails.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Organization-wide WFM guardrail policy requires company-wide People access.",
    }, { status: 403 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `wfm-guardrail-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action !== "update_policy") {
    return Response.json({ error: "Unsupported action. Use update_policy." }, { status: 400 });
  }

  const minimumRestMinutes = Number(body.minimumRestMinutes ?? 0);
  const maxConsecutiveWorkingDays = Number(body.maxConsecutiveWorkingDays ?? 0);
  const rollingSevenDayMinutes = Number(body.rollingSevenDayMinutes ?? 0);
  const enforcementMode = String(body.enforcementMode ?? "advisory");
  const active = body.active == null ? true : Boolean(body.active);

  if (
    !Number.isInteger(minimumRestMinutes)
    || minimumRestMinutes < 0
    || minimumRestMinutes > 1440
    || !Number.isInteger(maxConsecutiveWorkingDays)
    || maxConsecutiveWorkingDays < 0
    || maxConsecutiveWorkingDays > 31
    || !Number.isInteger(rollingSevenDayMinutes)
    || rollingSevenDayMinutes < 0
    || rollingSevenDayMinutes > 10080
    || !["advisory", "block"].includes(enforcementMode)
  ) {
    return Response.json({
      error: "Use valid thresholds: rest 0-1440 minutes, consecutive days 0-31, rolling 7-day minutes 0-10080, enforcement advisory or block. Zero disables a threshold.",
    }, { status: 400 });
  }

  const values = {
    minimumRestMinutes,
    maxConsecutiveWorkingDays,
    rollingSevenDayMinutes,
    enforcementMode,
    active,
    updatedBy: user.name,
    updatedAt: new Date(),
  };
  let saved: typeof workforceScheduleGuardrailPolicies.$inferSelect;
  try {
    saved = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(6107, ${organizationId})`);
      const [existing] = await tx.select().from(workforceScheduleGuardrailPolicies)
        .where(eq(workforceScheduleGuardrailPolicies.organizationId, organizationId))
        .limit(1);
      const [row] = existing
        ? await tx.update(workforceScheduleGuardrailPolicies)
            .set(values)
            .where(eq(workforceScheduleGuardrailPolicies.id, existing.id))
            .returning()
        : await tx.insert(workforceScheduleGuardrailPolicies)
            .values({ organizationId, ...values })
            .returning();
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name,
        action: "WFM schedule guardrail policy updated",
        resource: "Workforce scheduling",
        metadata: {
          policyId: row.id, minimumRestMinutes, maxConsecutiveWorkingDays,
          rollingSevenDayMinutes, enforcementMode, active,
        },
      });
      return row;
    }, { isolationLevel: "serializable" });
  } catch {
    return Response.json({
      code: "WFM_GUARDRAIL_POLICY_CHANGED",
      error: "Scheduling policy could not be committed. Refresh and retry.",
    }, { status: 409 });
  }

  return Response.json({
    policy: normalizePolicy(saved),
    configured: true,
  });
}
