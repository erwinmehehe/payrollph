import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dataRequests } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { assertPermission } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * Data Privacy Act of 2012 data-subject requests.
 * NPC rules require responding to access/correction/deletion requests within
 * 30 days, so every request gets a computed due date and a tracked status
 * instead of living in someone's inbox.
 */
const STATUTORY_DAYS = 30;

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedList = await assertPermission(session.id, organizationId, "compliance:read");
  if (deniedList) return deniedList;

  const rows = await db.select().from(dataRequests).where(eq(dataRequests.organizationId, organizationId)).orderBy(desc(dataRequests.id));

  const now = Date.now();
  return Response.json({
    statutoryDays: STATUTORY_DAYS,
    open: rows.filter((row) => row.status === "received" || row.status === "in_progress").length,
    overdue: rows.filter((row) => row.status !== "completed" && new Date(row.dueAt).getTime() < now).length,
    requests: rows.map((row) => ({
      ...row,
      daysRemaining: Math.ceil((new Date(row.dueAt).getTime() - now) / 86_400_000),
      overdue: row.status !== "completed" && new Date(row.dueAt).getTime() < now,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const subjectEmail = String(body.subjectEmail ?? "").trim().toLowerCase();
  const requestType = String(body.requestType ?? "").trim();
  const types = ["access", "correction", "deletion", "portability", "objection"];

  if (!Number.isInteger(organizationId) || !subjectEmail || !types.includes(requestType)) {
    return Response.json({ error: `organizationId, subjectEmail and a requestType of ${types.join("/")} are required.` }, { status: 400 });
  }

  const denied = await assertPermission(session.id, organizationId, "compliance:manage");
  if (denied) return denied;

  const [row] = await db.insert(dataRequests).values({
    organizationId,
    subjectEmail,
    requestType,
    status: "received",
    dueAt: new Date(Date.now() + STATUTORY_DAYS * 86_400_000),
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: "Data subject request logged",
    resource: `${requestType} · ${subjectEmail}`,
    metadata: { requestId: row.id, dueAt: row.dueAt, statutoryDays: STATUTORY_DAYS },
  });

  return Response.json({ ...row, daysRemaining: STATUTORY_DAYS }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const status = String(body.status ?? "");
  if (!Number.isInteger(id) || !["received", "in_progress", "completed", "rejected"].includes(status)) {
    return Response.json({ error: "id and a valid status are required." }, { status: 400 });
  }

  const [existing] = await db.select({ organizationId: dataRequests.organizationId }).from(dataRequests).where(eq(dataRequests.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Request not found." }, { status: 404 });
  const deniedPatch = await assertPermission(session.id, existing.organizationId ?? 0, "compliance:manage");
  if (deniedPatch) return deniedPatch;

  const [row] = await db.update(dataRequests).set({
    status,
    completedAt: status === "completed" ? new Date() : null,
    handledBy: session.name,
    notes: String(body.notes ?? "").slice(0, 400) || undefined,
  }).where(eq(dataRequests.id, id)).returning();

  if (!row) return Response.json({ error: "Request not found." }, { status: 404 });

  await recordAuditEvent({
    organizationId: row.organizationId,
    actor: session.name,
    action: `Data request ${status.replace("_", " ")}`,
    resource: `${row.requestType} · ${row.subjectEmail}`,
    metadata: { requestId: row.id },
  });

  return Response.json(row);
}
