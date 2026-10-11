import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  legalEntities,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  ORG_ADMIN_ROLES,
  PAYROLL_OPERATOR_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  encryptBankAccount,
  maskBankAccount,
} from "@/lib/bank-account-crypto";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { ensurePrimaryLegalEntity } from "@/lib/legal-entity";
import {
  enforceSameOriginMutation,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const CALENDAR_MODES = new Set(["flexible", "ph_semi_monthly"]);
const DEDUCTION_TIMINGS = new Set(["split", "first_cutoff", "second_cutoff"]);

function code(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.-]/g, "")
    .slice(0, 40);
}

function nullable(value: unknown, length: number) {
  const text = String(value ?? "").trim().slice(0, length);
  return text || null;
}

function tin(value: unknown) {
  const text = String(value ?? "").replace(/\D/g, "");
  if (!text) return null;
  if (text.length !== 9) throw new Error("BIR employer TIN must contain exactly 9 digits.");
  return text;
}

function branchCode(value: unknown) {
  const raw = String(value ?? "").replace(/\D/g, "");
  if (!raw) return null;
  if (raw.length > 4) throw new Error("BIR branch code must contain at most 4 digits.");
  return raw.padStart(4, "0");
}

async function requireAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only organization administrators can manage legal employers.",
  );
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Legal-employer administration requires company-wide access.",
    }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const selectorMode = url.searchParams.get("mode") === "selector";
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  await ensurePrimaryLegalEntity(organizationId);

  if (selectorMode) {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PAYROLL_OPERATOR_ROLES,
      "Only payroll operators can select a legal employer for payroll.",
    );
    if (denied) return denied;
    const entities = await db.select({
      id: legalEntities.id,
      code: legalEntities.code,
      displayName: legalEntities.displayName,
      primaryEntity: legalEntities.primaryEntity,
      active: legalEntities.active,
    }).from(legalEntities)
      .where(and(
        eq(legalEntities.organizationId, organizationId),
        eq(legalEntities.active, true),
      ))
      .orderBy(asc(legalEntities.id));
    return Response.json({ legalEntities: entities });
  }

  const denied = await requireAdmin(user.id, organizationId);
  if (denied) return denied;

  const [entities, employeeRows, runRows] = await Promise.all([
    db.select().from(legalEntities)
      .where(eq(legalEntities.organizationId, organizationId))
      .orderBy(asc(legalEntities.id)),
    db.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      status: employees.status,
      legalEntityId: employees.legalEntityId,
    }).from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.id)),
    db.select({
      id: payrollRuns.id,
      legalEntityId: payrollRuns.legalEntityId,
      status: payrollRuns.status,
    }).from(payrollRuns)
      .where(eq(payrollRuns.organizationId, organizationId)),
  ]);

  const releasedByEntity = new Map<number, number>();
  for (const run of runRows) {
    if (run.status !== "Released" || !run.legalEntityId) continue;
    releasedByEntity.set(run.legalEntityId, (releasedByEntity.get(run.legalEntityId) ?? 0) + 1);
  }

  return Response.json({
    legalEntities: entities.map((entity) => ({
      ...entity,
      disbursementAccount: maskBankAccount(entity.disbursementAccount),
      employeeCount: employeeRows.filter((employee) => employee.legalEntityId === entity.id).length,
      releasedPayrollRuns: releasedByEntity.get(entity.id) ?? 0,
    })),
    employees: employeeRows,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Legal employer management");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await requireAdmin(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  try {
    const entityCode = code(body.code);
    const legalName = String(body.legalName ?? "").trim().slice(0, 200);
    const displayName = String(body.displayName ?? legalName).trim().slice(0, 160);
    const payrollCalendarMode = String(body.payrollCalendarMode ?? "flexible");
    const statutoryDeductionTiming = String(body.statutoryDeductionTiming ?? "split");
    if (!entityCode || legalName.length < 2 || displayName.length < 2) {
      return Response.json({ error: "Code, legal name, and display name are required." }, { status: 422 });
    }
    if (!CALENDAR_MODES.has(payrollCalendarMode)) {
      return Response.json({ error: "Invalid payroll calendar mode." }, { status: 422 });
    }
    if (!DEDUCTION_TIMINGS.has(statutoryDeductionTiming)) {
      return Response.json({ error: "Invalid statutory deduction timing." }, { status: 422 });
    }

    const disbursementBankCode = nullable(body.disbursementBankCode, 16)?.toUpperCase() ?? null;
    const disbursementAccountRaw = String(body.disbursementAccount ?? "").trim();
    if (Boolean(disbursementBankCode) !== Boolean(disbursementAccountRaw)) {
      return Response.json({
        error: "Disbursement bank code and account must be provided together.",
      }, { status: 422 });
    }

    const [created] = await db.insert(legalEntities).values({
      organizationId,
      code: entityCode,
      legalName,
      displayName,
      birTin: tin(body.birTin),
      birBranchCode: branchCode(body.birBranchCode),
      sssEmployerNo: nullable(body.sssEmployerNo, 24),
      philHealthEmployerNo: nullable(body.philHealthEmployerNo, 24),
      pagIbigEmployerNo: nullable(body.pagIbigEmployerNo, 24),
      payrollCalendarMode,
      statutoryDeductionTiming,
      disbursementBankCode,
      disbursementAccountName: nullable(body.disbursementAccountName, 160),
      disbursementAccount: encryptBankAccount(disbursementAccountRaw),
      primaryEntity: false,
      active: true,
      createdByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Legal employer created",
      resource: created.displayName,
      metadata: {
        legalEntityId: created.id,
        code: created.code,
        payrollCalendarMode,
        statutoryDeductionTiming,
        governmentRegistrationsConfigured: {
          bir: Boolean(created.birTin),
          sss: Boolean(created.sssEmployerNo),
          philHealth: Boolean(created.philHealthEmployerNo),
          pagIbig: Boolean(created.pagIbigEmployerNo),
        },
        disbursementConfigured: Boolean(disbursementBankCode && disbursementAccountRaw),
      },
    });

    return Response.json({
      legalEntity: {
        ...created,
        disbursementAccount: maskBankAccount(created.disbursementAccount),
      },
    }, { status: 201 });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Legal employer could not be created.",
    }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Legal employer management");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await requireAdmin(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  if (action === "assign_employee") {
    const employeeId = Number(body.employeeId);
    const legalEntityId = Number(body.legalEntityId);
    if (!Number.isInteger(employeeId) || !Number.isInteger(legalEntityId)) {
      return Response.json({ error: "employeeId and legalEntityId are required." }, { status: 400 });
    }

    const [[employee], [entity]] = await Promise.all([
      db.select().from(employees).where(and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, organizationId),
      )).limit(1),
      db.select().from(legalEntities).where(and(
        eq(legalEntities.id, legalEntityId),
        eq(legalEntities.organizationId, organizationId),
      )).limit(1),
    ]);
    if (!employee || !entity || !entity.active) {
      return Response.json({ error: "Employee and active legal employer must belong to this organization." }, { status: 404 });
    }
    if (employee.legalEntityId === legalEntityId) {
      return Response.json({ ok: true, employee });
    }

    const releasedHistory = await db.select({ runId: payrollRuns.id })
      .from(payrollEntries)
      .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
      .where(and(
        eq(payrollEntries.employeeId, employeeId),
        eq(payrollRuns.organizationId, organizationId),
        eq(payrollRuns.status, "Released"),
      ))
      .limit(1);
    if (releasedHistory.length > 0) {
      return Response.json({
        error: "This employee already has released payroll history. Legal-employer transfers require an effective-dated transfer workflow so tax and remittance history cannot be mixed.",
        code: "LEGAL_ENTITY_TRANSFER_REQUIRES_WORKFLOW",
      }, { status: 409 });
    }

    const [updated] = await db.update(employees)
      .set({ legalEntityId })
      .where(eq(employees.id, employeeId))
      .returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee legal employer assigned",
      resource: `${employee.employeeNo} · ${entity.code}`,
      metadata: {
        employeeId,
        fromLegalEntityId: employee.legalEntityId,
        toLegalEntityId: legalEntityId,
      },
    });
    return Response.json({ ok: true, employee: updated });
  }

  const legalEntityId = Number(body.legalEntityId);
  if (!Number.isInteger(legalEntityId)) {
    return Response.json({ error: "legalEntityId is required." }, { status: 400 });
  }
  const [existing] = await db.select().from(legalEntities).where(and(
    eq(legalEntities.id, legalEntityId),
    eq(legalEntities.organizationId, organizationId),
  )).limit(1);
  if (!existing) return Response.json({ error: "Legal employer not found." }, { status: 404 });

  if (action === "update_entity") {
    try {
      const payrollCalendarMode = String(body.payrollCalendarMode ?? existing.payrollCalendarMode);
      const statutoryDeductionTiming = String(body.statutoryDeductionTiming ?? existing.statutoryDeductionTiming);
      if (!CALENDAR_MODES.has(payrollCalendarMode)) {
        return Response.json({ error: "Invalid payroll calendar mode." }, { status: 422 });
      }
      if (!DEDUCTION_TIMINGS.has(statutoryDeductionTiming)) {
        return Response.json({ error: "Invalid statutory deduction timing." }, { status: 422 });
      }

      const legalName = body.legalName === undefined
        ? existing.legalName
        : String(body.legalName ?? "").trim().slice(0, 200);
      const displayName = body.displayName === undefined
        ? existing.displayName
        : String(body.displayName ?? "").trim().slice(0, 160);
      if (legalName.length < 2 || displayName.length < 2) {
        return Response.json({ error: "Legal name and display name are required." }, { status: 422 });
      }

      const nextBankCode = body.disbursementBankCode === undefined
        ? existing.disbursementBankCode
        : nullable(body.disbursementBankCode, 16)?.toUpperCase() ?? null;
      const accountInputProvided = body.disbursementAccount !== undefined;
      const accountInput = accountInputProvided ? String(body.disbursementAccount ?? "").trim() : "";
      const clearAccount = body.clearDisbursementAccount === true;
      const nextAccount = clearAccount
        ? null
        : accountInput
          ? encryptBankAccount(accountInput)
          : encryptBankAccount(existing.disbursementAccount);
      if (Boolean(nextBankCode) !== Boolean(nextAccount)) {
        return Response.json({
          error: "Disbursement bank code and account must be configured together.",
        }, { status: 422 });
      }

      const [updated] = await db.update(legalEntities).set({
        legalName,
        displayName,
        birTin: body.birTin === undefined ? existing.birTin : tin(body.birTin),
        birBranchCode: body.birBranchCode === undefined ? existing.birBranchCode : branchCode(body.birBranchCode),
        sssEmployerNo: body.sssEmployerNo === undefined ? existing.sssEmployerNo : nullable(body.sssEmployerNo, 24),
        philHealthEmployerNo: body.philHealthEmployerNo === undefined ? existing.philHealthEmployerNo : nullable(body.philHealthEmployerNo, 24),
        pagIbigEmployerNo: body.pagIbigEmployerNo === undefined ? existing.pagIbigEmployerNo : nullable(body.pagIbigEmployerNo, 24),
        payrollCalendarMode,
        statutoryDeductionTiming,
        disbursementBankCode: nextBankCode,
        disbursementAccountName: body.disbursementAccountName === undefined
          ? existing.disbursementAccountName
          : nullable(body.disbursementAccountName, 160),
        disbursementAccount: nextAccount,
        updatedAt: new Date(),
      }).where(eq(legalEntities.id, legalEntityId)).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Legal employer profile updated",
        resource: updated.displayName,
        metadata: {
          legalEntityId,
          payrollCalendarMode,
          statutoryDeductionTiming,
          governmentRegistrationsConfigured: {
            bir: Boolean(updated.birTin),
            sss: Boolean(updated.sssEmployerNo),
            philHealth: Boolean(updated.philHealthEmployerNo),
            pagIbig: Boolean(updated.pagIbigEmployerNo),
          },
          disbursementConfigured: Boolean(updated.disbursementBankCode && updated.disbursementAccount),
        },
      });

      return Response.json({
        ok: true,
        legalEntity: {
          ...updated,
          disbursementAccount: maskBankAccount(updated.disbursementAccount),
        },
      });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Legal employer could not be updated.",
      }, { status: 409 });
    }
  }

  if (action === "set_primary") {
    if (!existing.active) {
      return Response.json({ error: "An inactive legal employer cannot be primary." }, { status: 422 });
    }
    await db.transaction(async (tx) => {
      await tx.update(legalEntities)
        .set({ primaryEntity: false, updatedAt: new Date() })
        .where(eq(legalEntities.organizationId, organizationId));
      await tx.update(legalEntities)
        .set({ primaryEntity: true, updatedAt: new Date() })
        .where(eq(legalEntities.id, legalEntityId));
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Primary legal employer changed",
      resource: existing.displayName,
      metadata: { legalEntityId },
    });
    return Response.json({ ok: true });
  }

  if (action === "set_active") {
    const active = Boolean(body.active);
    if (!active && existing.primaryEntity) {
      return Response.json({ error: "The primary legal employer cannot be deactivated." }, { status: 422 });
    }
    if (!active) {
      const [assigned] = await db.select({ id: employees.id }).from(employees)
        .where(and(
          eq(employees.organizationId, organizationId),
          eq(employees.legalEntityId, legalEntityId),
        )).limit(1);
      if (assigned) {
        return Response.json({ error: "Reassign employees before deactivating this legal employer." }, { status: 409 });
      }
    }
    const [updated] = await db.update(legalEntities)
      .set({ active, updatedAt: new Date() })
      .where(eq(legalEntities.id, legalEntityId))
      .returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: active ? "Legal employer activated" : "Legal employer deactivated",
      resource: existing.displayName,
      metadata: { legalEntityId },
    });
    return Response.json({ ok: true, legalEntity: updated });
  }

  return Response.json({ error: "Unsupported legal-employer action." }, { status: 400 });
}
