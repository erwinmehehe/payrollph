import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, workerEffectiveChanges } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { effectiveCorrectionAccess } from "@/lib/hcm-effective-correction-access";
import { readHcmCorrectionReason } from "@/lib/hcm-correction-action-read";
import { correctionFingerprint } from "@/lib/hcm-effective-correction-policy";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const rawOrganization = params.getAll("organizationId"), rawChange = params.getAll("changeId");
  if (rawOrganization.length !== 1 || rawChange.length !== 1 || !/^[1-9][0-9]*$/.test(rawOrganization[0]) || !/^[1-9][0-9]*$/.test(rawChange[0])) return Response.json({ error: "Canonical organizationId and changeId required." }, { status: 400 });
  const organizationId = Number(rawOrganization[0]), changeId = Number(rawChange[0]);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || !Number.isSafeInteger(changeId) || changeId <= 0) return Response.json({ error: "Positive organizationId and changeId required." }, { status: 400 });
  const denied = await effectiveCorrectionAccess(user.id, organizationId); if (denied) return denied;
  const rows = await db.select({ organizationId: workerEffectiveChanges.organizationId, changeId: workerEffectiveChanges.id,
    employeeId: workerEffectiveChanges.employeeId, note: sql<unknown>`${auditEvents.metadata}->'note'`, reviewer: auditEvents.actor, returnedAt: auditEvents.createdAt,
    fromSnapshot: workerEffectiveChanges.fromSnapshot, toSnapshot: workerEffectiveChanges.toSnapshot,
    requestedByUserId: workerEffectiveChanges.requestedByUserId,
    receiptRequester: sql<unknown>`${auditEvents.metadata}->'requesterUserId'`,
    originalSnapshotSha256: sql<string>`${auditEvents.metadata}->>'originalSnapshotSha256'`,
  }).from(workerEffectiveChanges).innerJoin(auditEvents, and(
    eq(auditEvents.organizationId, organizationId), eq(auditEvents.action, "HCM change returned for correction"),
    sql`${auditEvents.metadata}->>'effectiveChangeId' = ${workerEffectiveChanges.id}::text`,
  )).where(and(eq(workerEffectiveChanges.organizationId, organizationId), eq(workerEffectiveChanges.id, changeId),
    eq(workerEffectiveChanges.status, "returned_for_correction"))).limit(2);
  if (!rows.length) return Response.json({ error: "Returned source not found." }, { status: 404 });
  if (rows.length !== 1) return Response.json({ error: "Return evidence unavailable." }, { status: 503 });
  const receipt = rows[0];
  if (receipt.receiptRequester !== receipt.requestedByUserId
    || receipt.originalSnapshotSha256 !== correctionFingerprint({ from: receipt.fromSnapshot, to: receipt.toSnapshot })) {
    return Response.json({ error: "Return evidence unavailable." }, { status: 503 });
  }
  const body = { organizationId, changeId, employeeId: receipt.employeeId, note: receipt.note,
    reviewer: receipt.reviewer, returnedAt: receipt.returnedAt.toISOString() };
  try { readHcmCorrectionReason(true, body, { organizationId, employeeId: body.employeeId, changeId }); }
  catch { return Response.json({ error: "Return evidence unavailable." }, { status: 503 }); }
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
