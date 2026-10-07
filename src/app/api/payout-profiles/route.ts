import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankFileValidations,
  bankTemplates,
  legalEntities,
  payoutProfiles,
} from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  ORG_ADMIN_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { maskBankAccount } from "@/lib/bank-account-crypto";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const PAYOUT_METHODS = new Set(["bank_file", "paymongo", "manual"]);

function optionalText(value: unknown, max: number) {
  const text = String(value ?? "").trim().slice(0, max);
  return text || null;
}

function optionalPositiveMoney(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${label} must be greater than zero.`);
  return amount.toFixed(2);
}

function optionalPositiveInteger(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error(`${label} must be a positive whole number.`);
  return amount;
}

async function requireCompanyAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only organization administrators can manage company payout profiles.",
  );
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Company payout profile administration requires company-wide access.",
    }, { status: 403 });
  }
  return null;
}

function evidenceKey(name: string, version: string) {
  return `${name}::${version}`;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await requireCompanyAdmin(user.id, organizationId);
  if (denied) return denied;

  const [entities, profiles, adapters, accepted] = await Promise.all([
    db.select().from(legalEntities)
      .where(eq(legalEntities.organizationId, organizationId))
      .orderBy(asc(legalEntities.id)),
    db.select().from(payoutProfiles)
      .where(eq(payoutProfiles.organizationId, organizationId))
      .orderBy(asc(payoutProfiles.legalEntityId)),
    db.select().from(bankTemplates)
      .where(eq(bankTemplates.active, true))
      .orderBy(asc(bankTemplates.name), asc(bankTemplates.version)),
    db.select({
      templateName: bankFileValidations.templateName,
      templateVersion: bankFileValidations.templateVersion,
      recordedAt: bankFileValidations.recordedAt,
    }).from(bankFileValidations)
      .where(and(
        eq(bankFileValidations.organizationId, organizationId),
        eq(bankFileValidations.status, "accepted"),
      )),
  ]);

  const acceptedKeys = new Set(accepted.map((row) => evidenceKey(row.templateName, row.templateVersion)));
  const profileByEntity = new Map(profiles.map((profile) => [profile.legalEntityId, profile]));

  return Response.json({
    profiles: entities.map((entity) => ({
      legalEntity: {
        id: entity.id,
        code: entity.code,
        displayName: entity.displayName,
        disbursementBankCode: entity.disbursementBankCode,
        disbursementAccountName: entity.disbursementAccountName,
        disbursementAccount: maskBankAccount(entity.disbursementAccount),
        active: entity.active,
      },
      profile: profileByEntity.get(entity.id) ?? null,
    })),
    adapters: adapters.map((adapter) => {
      const portalValidated = acceptedKeys.has(evidenceKey(adapter.name, adapter.version));
      return {
        id: adapter.id,
        name: adapter.name,
        version: adapter.version,
        format: adapter.format,
        bankCode: adapter.bankCode,
        productName: adapter.productName,
        adapterStage: adapter.adapterStage,
        effectiveStage: portalValidated ? "portal_validated" : adapter.adapterStage,
        specSource: adapter.specSource,
        specReference: adapter.specReference,
        portalValidated,
      };
    }),
  });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Company payout profile management");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const legalEntityId = Number(body.legalEntityId);
  if (!Number.isInteger(organizationId) || organizationId <= 0 || !Number.isInteger(legalEntityId) || legalEntityId <= 0) {
    return Response.json({ error: "organizationId and legalEntityId are required." }, { status: 400 });
  }

  const denied = await requireCompanyAdmin(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "company-payout-profile",
    resourceId: legalEntityId,
    limit: 12,
    windowMs: 10 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [entity] = await db.select().from(legalEntities).where(and(
    eq(legalEntities.id, legalEntityId),
    eq(legalEntities.organizationId, organizationId),
  )).limit(1);
  if (!entity) return Response.json({ error: "Legal employer not found in this workspace." }, { status: 404 });

  const defaultMethod = String(body.defaultMethod ?? "bank_file");
  if (!PAYOUT_METHODS.has(defaultMethod)) {
    return Response.json({ error: "defaultMethod must be bank_file, paymongo, or manual." }, { status: 400 });
  }

  const bankTemplateId = body.bankTemplateId === null || body.bankTemplateId === undefined || body.bankTemplateId === ""
    ? null
    : Number(body.bankTemplateId);
  if (bankTemplateId !== null && (!Number.isInteger(bankTemplateId) || bankTemplateId <= 0)) {
    return Response.json({ error: "bankTemplateId must be a valid bank adapter." }, { status: 400 });
  }

  let adapter: typeof bankTemplates.$inferSelect | null = null;
  if (bankTemplateId !== null) {
    const [row] = await db.select().from(bankTemplates).where(and(
      eq(bankTemplates.id, bankTemplateId),
      eq(bankTemplates.active, true),
    )).limit(1);
    if (!row) return Response.json({ error: "Selected bank adapter is not active." }, { status: 404 });
    adapter = row;
  }

  const active = body.active === true;
  if (active && defaultMethod === "bank_file" && !adapter) {
    return Response.json({
      error: "An active bank-file payout profile must select a bank adapter.",
    }, { status: 422 });
  }
  if (active && defaultMethod === "bank_file" && (!entity.disbursementBankCode || !entity.disbursementAccount)) {
    return Response.json({
      error: "Configure the legal employer's encrypted disbursement bank and account before activating bank-file payout.",
    }, { status: 422 });
  }

  try {
    const values = {
      organizationId,
      legalEntityId,
      bankTemplateId,
      defaultMethod,
      bankProduct: optionalText(body.bankProduct, 120),
      sourceAccountType: optionalText(body.sourceAccountType, 32),
      companyCode: optionalText(body.companyCode, 80),
      presentingOffice: optionalText(body.presentingOffice, 80),
      branchCode: optionalText(body.branchCode, 32),
      remarks: optionalText(body.remarks, 240),
      maxAmountPerFile: optionalPositiveMoney(body.maxAmountPerFile, "Maximum amount per file"),
      maxRowsPerFile: optionalPositiveInteger(body.maxRowsPerFile, "Maximum rows per file"),
      transactionLimit: optionalPositiveMoney(body.transactionLimit, "Transaction limit"),
      dailyLimit: optionalPositiveMoney(body.dailyLimit, "Daily limit"),
      active,
      updatedByUserId: user.id,
      updatedAt: new Date(),
    };

    const [saved] = await db.insert(payoutProfiles).values({
      ...values,
      createdByUserId: user.id,
    }).onConflictDoUpdate({
      target: payoutProfiles.legalEntityId,
      set: values,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Company payout profile updated",
      resource: entity.displayName,
      metadata: {
        legalEntityId,
        payoutProfileId: saved.id,
        defaultMethod,
        active,
        bankTemplateId,
        bankTemplateName: adapter?.name ?? null,
        bankTemplateVersion: adapter?.version ?? null,
        bankProduct: saved.bankProduct,
        sourceAccountType: saved.sourceAccountType,
        companyCodeConfigured: Boolean(saved.companyCode),
        presentingOfficeConfigured: Boolean(saved.presentingOffice),
        branchCodeConfigured: Boolean(saved.branchCode),
        maxAmountPerFile: saved.maxAmountPerFile,
        maxRowsPerFile: saved.maxRowsPerFile,
        transactionLimit: saved.transactionLimit,
        dailyLimit: saved.dailyLimit,
      },
    });

    return Response.json({ profile: saved });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Company payout profile could not be saved.",
    }, { status: 422 });
  }
}
