import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, legalEntities } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, ORG_ADMIN_ROLES } from "@/lib/access";
import { resolveMultiEntityContext, assertEntityResource } from "@/lib/multi-entity-server";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { encryptBankAccount, maskBankAccount } from "@/lib/bank-account-crypto";

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
function stringValue(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new Error("Enter a valid registration value.");
  return trimmed;
}
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
  const [old] = await db.select().from(legalEntities).where(and(
    eq(legalEntities.id, legalEntityId),
    eq(legalEntities.organizationId, organizationId))).limit(1);
  if (!old) return fail("Legal employer not found.", 404);
  try {
    const legalName = stringValue(body.legalName, 200) ?? old.legalName;
    const registeredAddress = body.registeredAddress === undefined
      ? old.registeredAddress
      : String(body.registeredAddress ?? "").trim().slice(0, 500);
    const birTin = stringValue(body.birTin, 16) ?? old.birTin;
    if (birTin && !/^\d{9}$/.test(birTin)) return fail("Employer TIN needs nine digits.", 422);
    const branch = stringValue(body.birBranchCode, 4) ?? old.birBranchCode;
    if (branch && !/^\d{1,4}$/.test(branch)) return fail("BIR branch code must be numeric.", 422);
    const payMode = String(body.payrollCalendarMode ?? old.payrollCalendarMode);
    if (!["flexible","ph_semi_monthly"].includes(payMode)) return fail("Unknown pay schedule.", 422);
    const bankAccount = stringValue(body.disbursementAccount, 120);
    const bankCode = body.disbursementBankCode === undefined
      ? old.disbursementBankCode : stringValue(body.disbursementBankCode, 16);
    if (bankAccount && !bankCode) return fail("Bank code is required with an account.", 422);
    const updated = await db.transaction(async tx => {
      const [record] = await tx.update(legalEntities).set({
      legalName, registeredAddress,
      birTin, birBranchCode: branch,
      sssEmployerNo: stringValue(body.sssEmployerNo, 24) ?? old.sssEmployerNo,
      philHealthEmployerNo: stringValue(body.philHealthEmployerNo, 24) ?? old.philHealthEmployerNo,
      pagIbigEmployerNo: stringValue(body.pagIbigEmployerNo, 24) ?? old.pagIbigEmployerNo,
      payrollCalendarMode: payMode,
      disbursementBankCode: bankCode,
      disbursementAccountName: stringValue(body.disbursementAccountName, 160) ?? old.disbursementAccountName,
      disbursementAccount: bankAccount ? encryptBankAccount(bankAccount) : old.disbursementAccount,
      updatedAt: new Date(),
      }).where(and(eq(legalEntities.id, legalEntityId),
        eq(legalEntities.organizationId, organizationId))).returning();
      if (!record) throw new Error("Employer changed during update.");
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name, action: "Legal employer settings updated",
        resource: String(legalEntityId), metadata: {
          legalEntityId, changedFields: Object.keys(body).filter(key =>
            key !== "organizationId" && key !== "legalEntityId"),
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
