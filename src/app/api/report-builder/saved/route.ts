import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, savedReportDefinitions } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership } from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { workflowEntityHold } from "@/lib/workflow-entity-hold";

const keys = new Set(["headcount","cost","turnover","compliance","assurance","workforce","lifecycle","people"]);
const disabled = () => Response.json({ error: "Saved report builder disabled." }, { status: 404 });
async function requestJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const parsed: unknown = await request.json().catch(() => null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : null;
}
function validated(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const reportKey = typeof body.reportKey === "string" ? body.reportKey : "";
  const selectedFields = Array.isArray(body.selectedFields) ? body.selectedFields : [];
  const rowFilters = Array.isArray(body.rowFilters) ? body.rowFilters : [];
  if (!name || name.length > 100 || !keys.has(reportKey) ||
      selectedFields.length > 30 || !selectedFields.every(v => typeof v === "string" && v.length <= 90) ||
      rowFilters.length > 6 || !rowFilters.every(v => v && typeof v === "object" && !Array.isArray(v)
        && typeof v.field === "string" && v.field.length <= 90
        && ["contains","equals"].includes(String(v.operator))
        && typeof v.value === "string" && v.value.length <= 120)) return null;
  return { name, reportKey, selectedFields: selectedFields as string[],
    rowFilters: rowFilters as Array<{ field: string; operator: string; value: string }> };
}
async function authorized(organizationId: number, userId: number) {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return Response.json({ error: "Invalid workspace." }, { status: 400 });
  return await assertMembership(userId, organizationId);
}
export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("reportBuilder")) return disabled();
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  const denied = await authorized(organizationId, user.id);
  if (denied) return denied;
  const rows = await db.select().from(savedReportDefinitions).where(and(
    eq(savedReportDefinitions.organizationId, organizationId), eq(savedReportDefinitions.userId, user.id),
  )).orderBy(desc(savedReportDefinitions.updatedAt)).limit(80);
  return Response.json({ reports: rows }, { headers: { "Cache-Control": "private,no-store" } });
}
export async function POST(request: Request) {
  if (!criticalReleaseFlagEnabled("reportBuilder")) return disabled();
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await requestJsonObject(request);
  if (!body) return Response.json({ error: "JSON object required." }, { status: 400 });
  const organizationId = Number(body.organizationId);
  const denied = await authorized(organizationId, user.id); if (denied) return denied;
  const clean = validated(body);
  if (!clean) return Response.json({ error: "Valid report name, fields and filters are required." }, { status: 422 });
  const row = await db.transaction(async tx => {
    const [created] = await tx.insert(savedReportDefinitions).values({
      organizationId, userId: user.id, ...clean,
    }).onConflictDoNothing().returning();
    if (!created) return null;
    // Never persist a saved report without its tenant-scoped audit record.
    await tx.insert(auditEvents).values({ organizationId, actor: user.name,
      action: "Saved report created", resource: created.name,
      metadata: { id: created.id, reportKey: created.reportKey, userId: user.id } });
    return created;
  });
  if (!row) return Response.json({ error: "That saved report name already exists." }, { status: 409 });
  return Response.json({ report: row }, { status: 201 });
}
export async function PATCH(request: Request) {
  if (!criticalReleaseFlagEnabled("reportBuilder")) return disabled();
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await requestJsonObject(request);
  if (!body) return Response.json({ error: "JSON object required." }, { status: 400 });
  const organizationId = Number(body.organizationId);
  const id = Number(body.id);
  const denied = await authorized(organizationId, user.id); if (denied) return denied;
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Invalid saved report." }, { status: 400 });
  const clean = validated(body);
  if (!clean) return Response.json({ error: "Invalid report fields or filters." }, { status: 422 });
  const row = await db.transaction(async tx => {
    const [updated] = await tx.update(savedReportDefinitions).set({ ...clean, updatedAt: new Date() }).where(and(
      eq(savedReportDefinitions.id, id), eq(savedReportDefinitions.organizationId, organizationId),
      eq(savedReportDefinitions.userId, user.id),
    )).returning();
    if (!updated) return null;
    await tx.insert(auditEvents).values({ organizationId, actor: user.name,
      action: "Saved report edited", resource: updated.name,
      metadata: { id: updated.id, reportKey: updated.reportKey, userId: user.id } });
    return updated;
  });
  if (!row) return Response.json({ error: "Saved report not found." }, { status: 404 });
  return Response.json({ report: row });
}
export async function DELETE(request: Request) {
  if (!criticalReleaseFlagEnabled("reportBuilder")) return disabled();
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await requestJsonObject(request);
  if (!body) return Response.json({ error: "JSON object required." }, { status: 400 });
  const organizationId = Number(body.organizationId);
  const id = Number(body.id);
  const denied = await authorized(organizationId, user.id); if (denied) return denied;
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Invalid report." }, { status: 400 });
  const row = await db.transaction(async tx => {
    const [deleted] = await tx.delete(savedReportDefinitions).where(and(
      eq(savedReportDefinitions.id, id), eq(savedReportDefinitions.organizationId, organizationId),
      eq(savedReportDefinitions.userId, user.id),
    )).returning();
    if (!deleted) return null;
    await tx.insert(auditEvents).values({ organizationId, actor: user.name,
      action: "Saved report deleted", resource: deleted.name,
      metadata: { id: deleted.id, userId: user.id } });
    return deleted;
  });
  if (!row) return Response.json({ error: "Saved report not found." }, { status: 404 });
  return Response.json({ deleted: true });
}
