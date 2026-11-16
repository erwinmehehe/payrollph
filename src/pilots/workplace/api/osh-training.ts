/**
 * SOURCE-ONLY PILOT: deliberately NOT registered under src/app.
 * Tenant-isolation inventory requires real own/foreign PG16 HTTP receipts,
 * independently reviewed before route promotion. Do not import into a
 * live route or expose under production flags without those proofs.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { oshTrainingRecords } from "@/db/workplace-compliance-schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { workplaceAdmin, workplaceFeatureEnabled, workplacePrivateHeaders, workplaceNotFound } from "@/lib/ph-workplace-context";
import {
  TRAINING_TOPICS, isOneOf, positiveId, limitedText, phCivilDate, sha256Digest, httpsReference,
} from "@/lib/ph-workplace-compliance-policy";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const noAccess = () => Response.json({ error: "Not found." }, { status: 404 });

export async function GET(request: Request) {
  if (!workplaceFeatureEnabled("phOshRecords")) return noAccess();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = positiveId(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const guard = await workplaceAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;
  const records = await db.select().from(oshTrainingRecords).where(and(
    eq(oshTrainingRecords.organizationId, organizationId),
    eq(oshTrainingRecords.legalEntityId, guard.legalEntityId!),
  )).orderBy(desc(oshTrainingRecords.completedOn), desc(oshTrainingRecords.id)).limit(100);
  return Response.json({
    records, topics: TRAINING_TOPICS,
    note: "Operator-entered completion and digest only. Human attestation does not verify an original artifact or training provider. Applicability and dates need qualified review.",
  }, { headers: workplacePrivateHeaders });
}

export async function POST(request: Request) {
  if (!workplaceFeatureEnabled("phOshRecords")) return noAccess();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(user.email, "Recording training evidence");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  const employeeId = positiveId(body.employeeId);
  const courseTitle = limitedText(body.courseTitle, 160, true);
  const providerName = limitedText(body.providerName, 120);
  const completedOn = phCivilDate(body.completedOn);
  const expiresOn = body.expiresOn == null || body.expiresOn === "" ? null : phCivilDate(body.expiresOn);
  const source = body.requirementSource == null || body.requirementSource === "" ? null : httpsReference(body.requirementSource);
  const sha = body.evidenceSha256 == null || body.evidenceSha256 === "" ? null : sha256Digest(body.evidenceSha256);
  if (!organizationId || !employeeId || !courseTitle || providerName === null || !completedOn ||
    !isOneOf(body.topic, TRAINING_TOPICS) ||
    (body.expiresOn != null && body.expiresOn !== "" && !expiresOn) ||
    (expiresOn !== null && expiresOn < completedOn) ||
    (body.requirementSource != null && body.requirementSource !== "" && !source) ||
    (body.evidenceSha256 != null && body.evidenceSha256 !== "" && !sha)) {
    return Response.json({ error: "Valid worker, topic, training, civil dates and evidence fields required." }, { status: 400 });
  }
  const guard = await workplaceAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;
  const [employee] = await db.select({ id: employees.id, legalEntityId: employees.legalEntityId })
    .from(employees).where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId))).limit(1);
  if (!employee || employee.legalEntityId !== guard.legalEntityId) return workplaceNotFound();
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "ph-training-create", resourceId: organizationId, limit: 30, windowMs: 300_000,
  });
  if (rate) return rate;
  const row = await db.transaction(async tx => {
    const [created] = await tx.insert(oshTrainingRecords).values({
      organizationId, legalEntityId: guard.legalEntityId!, employeeId,
      topic: body.topic as string, courseTitle, providerName: providerName || null,
      completedOn, expiresOn, evidenceSha256: sha, requirementSource: source,
      recordedByUserId: user.id,
    }).returning();
    await recordAuditEvent({
      organizationId, actor: user.name, action: "Training completion evidence recorded",
      resource: String(created.id), metadata: { trainingId: created.id, employeeId, topic: created.topic,
        independentlyVerified: false },
    }, tx);
    return created;
  });
  return Response.json({ record: row }, { status: 201, headers: workplacePrivateHeaders });
}

export async function PATCH(request: Request) {
  if (!workplaceFeatureEnabled("phOshRecords")) return noAccess();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(user.email, "Recording human training attestation");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  const id = positiveId(body.id);
  if (!organizationId || !id || body.action !== "attest") return Response.json({
    error: "Valid organization, training record and attest action required.",
  }, { status: 400 });
  const guard = await workplaceAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "ph-training-review", resourceId: id, limit: 20, windowMs: 300_000,
  });
  if (rate) return rate;
  try {
    const row = await db.transaction(async tx => {
      const [old] = await tx.select().from(oshTrainingRecords).where(and(
        eq(oshTrainingRecords.id, id), eq(oshTrainingRecords.organizationId, organizationId),
        eq(oshTrainingRecords.legalEntityId, guard.legalEntityId!),
      )).for("update").limit(1);
      if (!old) throw new Error("NOT_FOUND");
      if (old.attestedAt || old.recordedByUserId === user.id || !old.evidenceSha256) {
        throw new Error("INDEPENDENT_PROOF_REQUIRED");
      }
      const [attested] = await tx.update(oshTrainingRecords).set({
        attestedAt: new Date(), attestedByUserId: user.id,
      }).where(and(eq(oshTrainingRecords.id, id), eq(oshTrainingRecords.organizationId, organizationId))).returning();
      await recordAuditEvent({
        organizationId, actor: user.name, action: "Training evidence second-person human attestation",
        resource: String(id), metadata: { trainingId: id, employeeId: old.employeeId, humanAttestation: true,
          artifactDigestVerified: false, externalTrainingProviderAccredited: false },
      }, tx);
      return attested;
    });
    return Response.json({ record: row, independentHumanAttestation: true,
      artifactDigestVerified: false, providerAccreditationVerified: false },
      { headers: workplacePrivateHeaders });
  } catch (e) {
    return e instanceof Error && e.message === "NOT_FOUND" ? workplaceNotFound() :
      Response.json({ error: "A distinct human reviewer and a recorded digest are required; no original artifact was verified." }, { status: 409 });
  }
}
