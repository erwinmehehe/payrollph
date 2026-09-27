import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { authenticateApiKey, requireScope } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";
import { seedProvisioning } from "@/lib/provisioning";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

async function authorize(request: Request, scope: string) {
  const limited = await rateLimitDistributed(`api:${clientIp(request)}`, { limit: 120, windowMs: 60_000 });
  if (!limited.allowed) return { error: Response.json({ error: "Rate limit exceeded.", mode: limited.mode }, { status: 429 }) };
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return { error: Response.json({ error: auth.error }, { status: auth.status }) };
  if (!requireScope(auth.scopes, scope)) {
    return { error: Response.json({ error: `API key is missing the ${scope} scope.` }, { status: 403 }) };
  }
  return { auth };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await authorize(request, "employees:read");
  if ("error" in gate && gate.error) return gate.error;
  const id = Number((await params).id);
  const [row] = await db.select().from(employees).where(eq(employees.id, id));
  if (!row || row.organizationId !== gate.auth!.organizationId) {
    return Response.json({ error: "Employee not found." }, { status: 404 });
  }
  return Response.json(row);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await authorize(request, "employees:write");
  if ("error" in gate && gate.error) return gate.error;
  const id = Number((await params).id);
  const [existing] = await db.select().from(employees).where(eq(employees.id, id));
  if (!existing || existing.organizationId !== gate.auth!.organizationId) {
    return Response.json({ error: "Employee not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.status === "string") patch.status = body.status.trim();
  if (typeof body.employmentType === "string") patch.employmentType = body.employmentType.trim();
  if (body.monthlyBasic != null) patch.basicRate = Number(body.monthlyBasic).toFixed(2);
  if (typeof body.mwe === "boolean") patch.mwe = body.mwe;
  if (typeof body.region === "string") patch.region = body.region;
  if (typeof body.email === "string") patch.email = body.email.trim().toLowerCase() || null;

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "No updatable fields provided." }, { status: 422 });
  }

  const [updated] = await db.update(employees).set(patch).where(eq(employees.id, id)).returning();

  if (updated.status === "Separating" && existing.status !== "Separating") {
    await seedProvisioning(updated.organizationId, updated.id, "offboarding");
  }

  await recordAuditEvent({
    organizationId: updated.organizationId,
    actor: `api_key:${gate.auth!.keyId}`,
    action: "Employee updated via API",
    resource: `${updated.firstName} ${updated.lastName}`,
    metadata: { patch },
  });

  return Response.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await authorize(request, "employees:write");
  if ("error" in gate && gate.error) return gate.error;
  const id = Number((await params).id);
  const [existing] = await db.select().from(employees).where(eq(employees.id, id));
  if (!existing || existing.organizationId !== gate.auth!.organizationId) {
    return Response.json({ error: "Employee not found." }, { status: 404 });
  }

  // Soft-delete: mark Separating and open the offboarding checklist rather than destroying payroll history.
  const [updated] = await db.update(employees).set({ status: "Separating" }).where(eq(employees.id, id)).returning();
  await seedProvisioning(updated.organizationId, updated.id, "offboarding");

  await recordAuditEvent({
    organizationId: updated.organizationId,
    actor: `api_key:${gate.auth!.keyId}`,
    action: "Employee offboarded via API",
    resource: `${updated.firstName} ${updated.lastName}`,
    metadata: { previousStatus: existing.status },
  });

  await dispatchWebhook({
    organizationId: updated.organizationId,
    event: "employee.offboarded",
    data: { id: updated.id, status: updated.status, action: "offboarded" },
  });

  return Response.json({ id: updated.id, status: updated.status, offboardingStarted: true });
}
