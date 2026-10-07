import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities, orgUnits } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  BI_EXPORT_DEFINITIONS,
  biExportDefinition,
  runBiExport,
  serializeBiExport,
  validateBiExportFilters,
  type BiExportFilters,
  type BiExportFormat,
  type BiExportKey,
} from "@/lib/bi-exports";
import { listDynamicWorkerGroups, resolveDynamicWorkerGroupMembers } from "@/lib/dynamic-worker-groups";
import {
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const FORMATS = new Set<BiExportFormat>(["json", "csv", "ndjson"]);

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only company-wide People or payroll administrators can use BI exports.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "BI exports require company-wide access." }, { status: 403 });
  }

  const key = String(url.searchParams.get("key") ?? "");
  if (!key) {
    const [entities, units, dynamicGroups] = await Promise.all([
      db.select({
        id: legalEntities.id,
        code: legalEntities.code,
        name: legalEntities.displayName,
      }).from(legalEntities)
        .where(eq(legalEntities.organizationId, organizationId))
        .orderBy(legalEntities.code),
      db.select({
        id: orgUnits.id,
        code: orgUnits.code,
        name: orgUnits.name,
        legalEntityId: orgUnits.legalEntityId,
      }).from(orgUnits)
        .where(eq(orgUnits.organizationId, organizationId))
        .orderBy(orgUnits.code),
      listDynamicWorkerGroups(organizationId, true),
    ]);
    return Response.json({
      schemaVersion: BI_EXPORT_DEFINITIONS[0]?.schemaVersion ?? null,
      datasets: BI_EXPORT_DEFINITIONS,
      scopes: { legalEntities: entities, orgUnits: units, dynamicGroups: dynamicGroups.map((group) => ({ id: group.id, code: group.code, name: group.name, version: group.version })) },
      formats: ["csv", "ndjson", "json"],
      constraints: {
        maxRows: 50_000,
        maxDays: 366,
        sensitiveIdentifiersExcluded: [
          "bank account",
          "TIN",
          "SSS number",
          "PhilHealth number",
          "Pag-IBIG number",
        ],
      },
    });
  }

  const definition = biExportDefinition(key);
  if (!definition) return Response.json({ error: "Unknown BI export dataset." }, { status: 400 });

  const format = String(url.searchParams.get("format") ?? "csv") as BiExportFormat;
  if (!FORMATS.has(format)) {
    return Response.json({ error: "format must be csv, ndjson, or json." }, { status: 400 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "enterprise-bi-export",
    resourceId: organizationId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const filters: BiExportFilters = {
    startDate: String(url.searchParams.get("startDate") ?? ""),
    endDate: String(url.searchParams.get("endDate") ?? ""),
    legalEntityId: url.searchParams.get("legalEntityId") ? Number(url.searchParams.get("legalEntityId")) : null,
    orgUnitId: url.searchParams.get("orgUnitId") ? Number(url.searchParams.get("orgUnitId")) : null,
    dynamicGroupCode: String(url.searchParams.get("dynamicGroupCode") ?? "").trim() || null,
  };
  const filterError = validateBiExportFilters(filters);
  if (filterError) return Response.json({ error: filterError }, { status: 400 });

  if (filters.legalEntityId != null) {
    const [entity] = await db.select({ id: legalEntities.id }).from(legalEntities).where(and(
      eq(legalEntities.id, filters.legalEntityId),
      eq(legalEntities.organizationId, organizationId),
    )).limit(1);
    if (!entity) return Response.json({ error: "legalEntityId is not part of this workspace." }, { status: 400 });
  }

  if (filters.orgUnitId != null) {
    const [unit] = await db.select({
      id: orgUnits.id,
      legalEntityId: orgUnits.legalEntityId,
    }).from(orgUnits).where(and(
      eq(orgUnits.id, filters.orgUnitId),
      eq(orgUnits.organizationId, organizationId),
    )).limit(1);
    if (!unit) return Response.json({ error: "orgUnitId is not part of this workspace." }, { status: 400 });
    if (
      filters.legalEntityId != null
      && unit.legalEntityId != null
      && unit.legalEntityId !== filters.legalEntityId
    ) {
      return Response.json({ error: "The selected organization unit belongs to a different legal entity." }, { status: 400 });
    }
  }

  let dynamicSelection = null;
  if (filters.dynamicGroupCode) {
    if (key === "payroll_runs") {
      return Response.json({
        error: "Dynamic Group filtering is available only for employee-level payroll entries and workforce timesheets.",
      }, { status: 400 });
    }
    dynamicSelection = await resolveDynamicWorkerGroupMembers({
      organizationId,
      code: filters.dynamicGroupCode,
    });
    if (!dynamicSelection) {
      return Response.json({ error: "Dynamic Group not found or inactive." }, { status: 404 });
    }
    filters.dynamicGroupCode = dynamicSelection.group.code;
  }

  let exported;
  try {
    const result = await runBiExport({
      key: key as BiExportKey,
      organizationId,
      filters,
      employeeIds: dynamicSelection?.employeeIds ?? null,
    });
    exported = serializeBiExport({
      key: key as BiExportKey,
      format,
      filters,
      rows: result.rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BI export failed.";
    const status = message.includes("row limit") ? 413 : 400;
    return Response.json({ error: message }, { status });
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Enterprise BI export generated",
    resource: key,
    metadata: {
      format,
      schemaVersion: exported.schemaVersion,
      rowCount: exported.rowCount,
      sha256: exported.sha256,
      filters,
      dynamicGroupMemberCount: dynamicSelection?.employeeIds.length ?? null,
      excludedSensitiveIdentifiers: true,
    },
  });

  const contentType =
    format === "csv"
      ? "text/csv; charset=utf-8"
      : format === "ndjson"
        ? "application/x-ndjson; charset=utf-8"
        : "application/json; charset=utf-8";

  return new Response(exported.payload, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename=linaw-bi-${key}-${filters.startDate}-to-${filters.endDate}.${format === "ndjson" ? "ndjson" : format}`,
      "Cache-Control": "no-store",
      "X-Linaw-BI-Dataset": key,
      "X-Linaw-BI-Schema-Version": exported.schemaVersion,
      "X-Linaw-BI-Row-Count": String(exported.rowCount),
      "X-Linaw-BI-SHA256": exported.sha256,
      "X-Linaw-BI-Generated-At": exported.generatedAt,
    },
  });
}
