import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalDelegations } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { resolveEffectiveApprovers } from "@/lib/delegation";
import { assertMembership } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const deniedOrg = await assertMembership(user.id, organizationId);
  if (deniedOrg) return deniedOrg;
  const probe = searchParams.get("approver");

  const rows = await db.select().from(approvalDelegations)
    .where(eq(approvalDelegations.organizationId, organizationId))
    .orderBy(desc(approvalDelegations.id));

  const resolved = probe ? await resolveEffectiveApprovers(organizationId, probe) : null;
  return Response.json({ delegations: rows, resolved });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const fromApprover = String(body.fromApprover ?? "").trim();
  const toApprover = String(body.toApprover ?? "").trim();
  const startsOn = String(body.startsOn ?? "").trim();
  const endsOn = String(body.endsOn ?? "").trim();

  if (!Number.isInteger(organizationId) || !fromApprover || !toApprover || !startsOn || !endsOn) {
    return Response.json({ error: "organizationId, fromApprover, toApprover, startsOn and endsOn are required." }, { status: 400 });
  }
  if (fromApprover.toLowerCase() === toApprover.toLowerCase()) {
    return Response.json({ error: "An approver cannot delegate to themselves." }, { status: 400 });
  }

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const [row] = await db.insert(approvalDelegations).values({
    organizationId,
    fromApprover,
    toApprover,
    reason: String(body.reason ?? "Out of office").slice(0, 200),
    startsOn,
    endsOn,
    active: true,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Approval delegation created",
    resource: `${fromApprover} → ${toApprover}`,
    metadata: { startsOn, endsOn, reason: row.reason },
  });

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [target] = await db.select({ organizationId: approvalDelegations.organizationId }).from(approvalDelegations).where(eq(approvalDelegations.id, id)).limit(1);
  if (!target) return Response.json({ error: "Delegation not found." }, { status: 404 });
  const deniedToggle = await assertMembership(user.id, target.organizationId);
  if (deniedToggle) return deniedToggle;

  const [row] = await db.update(approvalDelegations)
    .set({ active: Boolean(body.active) })
    .where(eq(approvalDelegations.id, id))
    .returning();
  if (!row) return Response.json({ error: "Delegation not found." }, { status: 404 });

  await recordAuditEvent({
    organizationId: row.organizationId,
    actor: user.name,
    action: row.active ? "Approval delegation enabled" : "Approval delegation revoked",
    resource: `${row.fromApprover} → ${row.toApprover}`,
    metadata: { delegationId: row.id },
  });

  return Response.json(row);
}
