import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  costCenters,
  employeeLaborAllocations,
  employees,
  laborGlMappings,
  legalEntities,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  ORG_ADMIN_ROLES,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { LABOR_GL_ACCOUNT_KEYS, resolveLaborAllocation } from "@/lib/labor-costing";
import { scopeLaborCostingRead } from "@/lib/labor-costing-read-scope";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanCode(value: unknown, length = 64) {
  const text = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9_.-]/g, "");
  return text.slice(0, length);
}

function optionalCode(value: unknown) {
  const code = cleanCode(value, 64);
  return code || null;
}

function dayBefore(dateText: string) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function rangesOverlap(
  aFrom: string,
  aUntil: string | null,
  bFrom: string,
  bUntil: string | null,
) {
  const aEnd = aUntil ?? "9999-12-31";
  const bEnd = bUntil ?? "9999-12-31";
  return aFrom <= bEnd && bFrom <= aEnd;
}

async function scopedEmployee(userId: number, organizationId: number, employeeId: number) {
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) {
    return { employee: null, denied: Response.json({ error: "Employee not found." }, { status: 404 }) };
  }

  const access = await getAccess(userId, organizationId);
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) {
    return {
      employee: null,
      denied: Response.json({ error: scope.error }, { status: scope.status }),
    };
  }

  return { employee, denied: null };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "You do not have permission to review labor costing.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  // Reject contradictory or invalid access scopes before any labor-costing
  // database reads, including company-wide scopes with a non-null unit.
  const scopedUnitId = access.orgUnitId;
  const validCompanyWide = access.companyWide === true && scopedUnitId === null;
  const validUnitScope = access.companyWide === false
    && typeof scopedUnitId === "number"
    && Number.isSafeInteger(scopedUnitId) && scopedUnitId > 0;
  if (!validCompanyWide && !validUnitScope) {
    return Response.json({ error: "A verified organizational unit is required." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }

  // Select only the necessary employee identity/scope columns. The SQL query
  // itself stays unit-bounded rather than reading every employee in the tenant.
  const employeeRows = await db.select({
    id: employees.id,
    organizationId: employees.organizationId,
    orgUnitId: employees.orgUnitId,
  }).from(employees)
    .where(and(
      eq(employees.organizationId, organizationId),
      access.companyWide ? undefined : eq(employees.orgUnitId, scopedUnitId!),
    ))
    .orderBy(asc(employees.id));

  const [centerRows, allocationRows, entityRows, glMappingRows] = await Promise.all([
    db.select().from(costCenters)
      .where(eq(costCenters.organizationId, organizationId))
      .orderBy(asc(costCenters.code)),
    db.select().from(employeeLaborAllocations)
      .where(eq(employeeLaborAllocations.organizationId, organizationId))
      .orderBy(asc(employeeLaborAllocations.employeeId), asc(employeeLaborAllocations.effectiveFrom), asc(employeeLaborAllocations.id)),
    access.companyWide
      ? db.select().from(legalEntities)
        .where(eq(legalEntities.organizationId, organizationId))
        .orderBy(asc(legalEntities.code))
      : Promise.resolve([]),
    access.companyWide
      ? db.select().from(laborGlMappings)
        .where(eq(laborGlMappings.organizationId, organizationId))
        .orderBy(asc(laborGlMappings.accountKey), asc(laborGlMappings.id))
      : Promise.resolve([]),
  ]);

  const scoped = scopeLaborCostingRead({
    organizationId, access, employeeRows, centerRows, allocationRows,
    entityRows, glMappingRows,
  });
  if (!scoped) {
    return Response.json({ error: "Labor costing scope is unavailable." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json({ ...scoped, glAccountKeys: LABOR_GL_ACCOUNT_KEYS },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "").trim();

  const adminAction = action === "create_cost_center" || action === "set_gl_mapping";
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    adminAction ? ORG_ADMIN_ROLES : PEOPLE_PAYROLL_ROLES,
    adminAction
      ? "Only organization administrators can change company-wide labor-costing configuration."
      : "You do not have permission to manage labor costing.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `labor-costing-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create_cost_center") {
    if (!access.companyWide) {
      return Response.json({
        error: "Organization-wide cost centers require company-wide access.",
      }, { status: 403 });
    }

    const code = cleanCode(body.code, 40);
    const name = String(body.name ?? "").trim().slice(0, 140);
    const description = String(body.description ?? "").trim().slice(0, 500) || null;
    if (!code || !name) {
      return Response.json({ error: "Cost center code and name are required." }, { status: 400 });
    }

    try {
      const [created] = await db.insert(costCenters).values({
        organizationId,
        code,
        name,
        description,
      }).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Cost center created",
        resource: `${code} · ${name}`,
        metadata: { costCenterId: created.id },
      });

      return Response.json({ costCenter: created }, { status: 201 });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Cost center could not be created.",
      }, { status: 409 });
    }
  }

  if (action === "set_gl_mapping") {
    if (!access.companyWide) {
      return Response.json({
        error: "GL mappings require company-wide access.",
      }, { status: 403 });
    }

    const accountKey = String(body.accountKey ?? "").trim();
    const legalEntityId =
      body.legalEntityId === null || body.legalEntityId === undefined || body.legalEntityId === ""
        ? null
        : Number(body.legalEntityId);
    const costCenterId =
      body.costCenterId === null || body.costCenterId === undefined || body.costCenterId === ""
        ? null
        : Number(body.costCenterId);
    const accountCode = optionalCode(body.accountCode);
    const accountName = String(body.accountName ?? "").trim().slice(0, 160);
    const active = body.active !== false;

    if (!LABOR_GL_ACCOUNT_KEYS.includes(accountKey as (typeof LABOR_GL_ACCOUNT_KEYS)[number])) {
      return Response.json({ error: "Unsupported GL account key." }, { status: 400 });
    }
    if ((legalEntityId !== null && !Number.isInteger(legalEntityId))
      || (costCenterId !== null && !Number.isInteger(costCenterId))
      || !accountName) {
      return Response.json({
        error: "A valid optional legalEntityId, optional costCenterId, and accountName are required.",
      }, { status: 400 });
    }

    if (legalEntityId !== null) {
      const [entity] = await db.select().from(legalEntities).where(and(
        eq(legalEntities.id, legalEntityId),
        eq(legalEntities.organizationId, organizationId),
      )).limit(1);
      if (!entity) {
        return Response.json({ error: "The legal entity does not belong to this organization." }, { status: 422 });
      }
    }
    if (costCenterId !== null) {
      const [center] = await db.select().from(costCenters).where(and(
        eq(costCenters.id, costCenterId),
        eq(costCenters.organizationId, organizationId),
      )).limit(1);
      if (!center) {
        return Response.json({ error: "The cost center does not belong to this organization." }, { status: 422 });
      }
    }

    const mappings = await db.select().from(laborGlMappings)
      .where(eq(laborGlMappings.organizationId, organizationId));
    const existing = mappings.find((row) =>
      row.accountKey === accountKey
      && row.legalEntityId === legalEntityId
      && row.costCenterId === costCenterId
    );

    const [saved] = existing
      ? await db.update(laborGlMappings).set({
          accountCode,
          accountName,
          active,
          createdBy: user.name,
          updatedAt: new Date(),
        }).where(eq(laborGlMappings.id, existing.id)).returning()
      : await db.insert(laborGlMappings).values({
          organizationId,
          legalEntityId,
          costCenterId,
          accountKey,
          accountCode,
          accountName,
          active,
          createdBy: user.name,
        }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Labor GL mapping set",
      resource: accountKey,
      metadata: {
        mappingId: saved.id,
        legalEntityId,
        costCenterId,
        accountCode,
        accountName,
        active,
      },
    });

    return Response.json({ glMapping: saved }, { status: existing ? 200 : 201 });
  }

  if (action === "set_employee_allocations") {
    const employeeId = Number(body.employeeId);
    const effectiveFrom = String(body.effectiveFrom ?? "").trim();
    const effectiveUntil = String(body.effectiveUntil ?? "").trim() || null;
    const reason = String(body.reason ?? "Labor costing allocation").trim().slice(0, 240);
    const allocationBasis = body.allocationBasis === "hours" ? "hours" : "percentage";
    const allocationInput: Record<string, unknown>[] = Array.isArray(body.allocations)
      ? body.allocations.filter((row: unknown): row is Record<string, unknown> => typeof row === "object" && row !== null)
      : [];

    if (
      !Number.isInteger(employeeId)
      || !ISO_DATE.test(effectiveFrom)
      || (effectiveUntil && !ISO_DATE.test(effectiveUntil))
      || (effectiveUntil && effectiveUntil < effectiveFrom)
      || allocationInput.length < 1
      || allocationInput.length > 20
    ) {
      return Response.json({
        error: "employeeId, effectiveFrom, a valid optional effectiveUntil, and 1–20 allocation rows are required.",
      }, { status: 400 });
    }

    const employeeCheck = await scopedEmployee(user.id, organizationId, employeeId);
    if (employeeCheck.denied) return employeeCheck.denied;

    const normalized = allocationInput.map((row, index) => ({
      id: index + 1,
      employeeId,
      costCenterId: Number(row.costCenterId),
      effectiveFrom,
      effectiveUntil,
      allocationPercent: Number(row.allocationPercent),
      allocationBasis,
      allocationHours: allocationBasis === "hours" ? Number(row.allocationHours) : null,
      projectCode: optionalCode(row.projectCode),
      clientCode: optionalCode(row.clientCode),
      jobCode: optionalCode(row.jobCode),
      // Unknown JSON is validated by resolveLaborAllocation before any write.
      verticalDimensions: row.verticalDimensions,
    }));

    if (normalized.some((row) => !Number.isInteger(row.costCenterId))) {
      return Response.json({ error: "Every allocation requires a valid costCenterId." }, { status: 400 });
    }

    let resolved: ReturnType<typeof resolveLaborAllocation>;
    try {
      resolved = resolveLaborAllocation({ employeeId, asOf: effectiveFrom, rows: normalized });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Labor allocation is invalid.",
      }, { status: 422 });
    }

    const requestedCenterIds = [...new Set(normalized.map((row) => row.costCenterId))];
    const organizationCenters = await db.select().from(costCenters)
      .where(eq(costCenters.organizationId, organizationId));
    const validCenters = new Map(
      organizationCenters
        .filter((center) => center.active && requestedCenterIds.includes(center.id))
        .map((center) => [center.id, center]),
    );
    if (requestedCenterIds.some((id) => !validCenters.has(id))) {
      return Response.json({
        error: "Every labor allocation cost center must be active and belong to this organization.",
      }, { status: 422 });
    }

    const existingRows = await db.select().from(employeeLaborAllocations).where(and(
      eq(employeeLaborAllocations.organizationId, organizationId),
      eq(employeeLaborAllocations.employeeId, employeeId),
    )).orderBy(asc(employeeLaborAllocations.effectiveFrom), asc(employeeLaborAllocations.id));

    const futureOrSameStartConflict = existingRows.find((row) =>
      String(row.effectiveFrom) >= effectiveFrom
      && rangesOverlap(
        String(row.effectiveFrom),
        row.effectiveUntil ? String(row.effectiveUntil) : null,
        effectiveFrom,
        effectiveUntil,
      ),
    );
    if (futureOrSameStartConflict) {
      return Response.json({
        error: "An existing labor allocation starts inside this effective window. Adjust that future allocation before adding another set.",
      }, { status: 409 });
    }

    const rowsToClose = existingRows.filter((row) =>
      String(row.effectiveFrom) < effectiveFrom
      && rangesOverlap(
        String(row.effectiveFrom),
        row.effectiveUntil ? String(row.effectiveUntil) : null,
        effectiveFrom,
        effectiveUntil,
      ),
    );

    const resolvedByInputId = new Map(resolved.allocations.map((row) => [row.id, row]));
    const created = await db.transaction(async (tx) => {
      const closeDate = dayBefore(effectiveFrom);
      for (const row of rowsToClose) {
        await tx.update(employeeLaborAllocations)
          .set({ effectiveUntil: closeDate, updatedAt: new Date() })
          .where(eq(employeeLaborAllocations.id, row.id));
      }

      const inserted = [];
      for (const allocation of normalized) {
        const resolvedAllocation = resolvedByInputId.get(allocation.id);
        if (!resolvedAllocation) throw new Error("Resolved labor allocation row is missing.");
        const [row] = await tx.insert(employeeLaborAllocations).values({
          organizationId,
          employeeId,
          costCenterId: allocation.costCenterId,
          effectiveFrom,
          effectiveUntil,
          allocationPercent: resolvedAllocation.percent.toFixed(3),
          allocationBasis,
          allocationHours: resolvedAllocation.hours === null ? null : resolvedAllocation.hours.toFixed(3),
          projectCode: allocation.projectCode,
          clientCode: allocation.clientCode,
          jobCode: allocation.jobCode,
          verticalDimensions: resolvedAllocation.verticalDimensions ?? null,
          reason,
          createdBy: user.name,
        }).returning();
        inserted.push(row);
      }
      return inserted;
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee labor allocation set",
      resource: `${employeeCheck.employee!.employeeNo} · ${effectiveFrom}`,
      metadata: {
        employeeId,
        effectiveFrom,
        effectiveUntil,
        closedAllocationIds: rowsToClose.map((row) => row.id),
        allocations: created.map((row) => ({
          id: row.id,
          costCenterId: row.costCenterId,
          allocationPercent: row.allocationPercent,
          allocationBasis: row.allocationBasis,
          allocationHours: row.allocationHours,
          clientCode: row.clientCode,
          projectCode: row.projectCode,
          jobCode: row.jobCode,
          verticalDimensions: row.verticalDimensions,
        })),
      },
    });

    return Response.json({ allocations: created }, { status: 201 });
  }

  return Response.json({ error: "Unsupported labor-costing action." }, { status: 400 });
}
