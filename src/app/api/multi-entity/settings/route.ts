import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, legalEntities } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, ORG_ADMIN_ROLES } from "@/lib/access";
import { resolveMultiEntityContext, assertEntityResource } from "@/lib/multi-entity-server";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { maskBankAccount } from "@/lib/bank-account-crypto";
import { validateLegalEmployerSettingsPatch } from "@/lib/multi-entity-policy";

export const dynamic = "force-dynamic";
function mask(value: string | null) {
  if (!value) return "";
  const last = value.slice(-4);
  return "••••" + last;
}
function present(row: typeof legalEntities.$inferSelect) {
  return {
    id: row.id, legalName: row.legalName, displayName: row.displayName,
    code: row.code, registeredAddress: row.registeredAddress ?? "",
    birTin: mask(row.birTin), birBranchCode: mask(row.birBranchCode),
    sssEmployerNo: mask(row.sssEmployerNo),
    philHealthEmployerNo: mask(row.philHealthEmployerNo),
    pagIbigEmployerNo: mask(row.pagIbigEmployerNo),
    payrollCalendarMode: row.payrollCalendarMode,
    statutoryDeductionTiming: row.statutoryDeductionTiming,
    disbursementBankCode: row.disbursementBankCode ?? "",
    disbursementAccountName: row.disbursementAccountName ?? "",
    disbursementAccount: maskBankAccount(row.disbursementAccount),
  };
}
const fail = (error: string, status = 400) => Response.json({ error }, { status });
export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("multiEntity")) return fail("Not available.", 404);
  const user = await getSessionUser();
  if (!user) return fail("Authentication required.", 401);
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return fail("Invalid tenant.");
  const ctx = await resolveMultiEntityContext({ userId: user.id, organizationId, request });
  if (!ctx.ok) return ctx.response;
  const where = and(eq(legalEntities.organizationId, organizationId),
    ctx.context.legalEntityId === null ? undefined : eq(legalEntities.id, ctx.context.legalEntityId));
  const rows = await db.select().from(legalEntities).where(where);
  return Response.json({
    entities: rows.map(present),
    canEdit: ["owner", "admin", "bookkeeper"].includes(ctx.context.role),
  }, { headers: { "Cache-Control": "no-store, private" } });
}
export async function PATCH(request: Request) {
  if (!criticalReleaseFlagEnabled("multiEntity")) return fail("Not available.", 404);
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return fail("Authentication required.", 401);
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const legalEntityId = Number(body.legalEntityId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(legalEntityId) || legalEntityId <= 0) return fail("Invalid tenant or legal employer.");
  const roleDenied = await assertOrganizationRole(user.id, organizationId, ORG_ADMIN_ROLES);
  if (roleDenied) return roleDenied;
  const ctx = await resolveMultiEntityContext({ userId: user.id, organizationId, request });
  if (!ctx.ok) return ctx.response;
  const scopeDenied = assertEntityResource(ctx.context, legalEntityId);
  if (scopeDenied) return scopeDenied;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const patch = validateLegalEmployerSettingsPatch(body);
  if (!patch.ok) {
    return Response.json({
      error: patch.code === "VERSIONED_REGISTRATION_REQUIRED"
        ? "Legal-employer registration and payout destination changes require an independently reviewed, versioned record. This settings API does not modify them."
        : "Only a valid pay-schedule change is accepted by this endpoint.",
      code: patch.code,
    }, { status: patch.code === "VERSIONED_REGISTRATION_REQUIRED" ? 409 : 422 });
  }
  const [old] = await db.select().from(legalEntities).where(and(
    eq(legalEntities.id, legalEntityId),
    eq(legalEntities.organizationId, organizationId))).limit(1);
  if (!old) return fail("Legal employer not found.", 404);
  if (old.payrollCalendarMode === patch.payrollCalendarMode) {
    return Response.json({ entity: present(old) });
  }
  try {
    const updated = await db.transaction(async tx => {
      // No direct writes to employer legal identity, registration numbers,
      // beneficiary bank account, or other unversioned authority fields.
      const [record] = await tx.update(legalEntities).set({
        payrollCalendarMode: patch.payrollCalendarMode,
        updatedAt: new Date(),
      }).where(and(eq(legalEntities.id, legalEntityId),
        eq(legalEntities.organizationId, organizationId),
        // An independent update must not silently overwrite a newer schedule.
        eq(legalEntities.payrollCalendarMode, old.payrollCalendarMode))).returning();
      if (!record) throw new Error("Employer changed during update.");
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name, action: "Legal employer pay schedule updated",
        resource: String(legalEntityId), metadata: {
          legalEntityId, changedFields: ["payrollCalendarMode"],
          fromPaySchedule: old.payrollCalendarMode,
          toPaySchedule: patch.payrollCalendarMode,
          actorUserId: user.id, sensitiveValuesRedacted: true,
        },
      });
      return record;
    });
    return Response.json({ entity: present(updated) });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Unable to update employer.", 422);
  }
}
