import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  documents,
  hcmEmploymentDecisionDocuments,
  hcmEmploymentDecisionEvents,
  hcmEmploymentDecisionNotes,
  hcmEmploymentTermDecisions,
  positionAssignments,
  positions,
} from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_ADMIN_ROLES,
  roleAllowed,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  EMPLOYMENT_DECISION_EVIDENCE_KINDS,
  EMPLOYMENT_DECISION_NOTE_KINDS,
  loadEmploymentDecisionEvidencePacket,
} from "@/lib/hcm-employment-decision-evidence";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  documentUploadsEnabled,
  MAX_UPLOAD_BYTES,
  safeFileName,
  scanUpload,
  validateUpload,
} from "@/lib/storage";

export const dynamic = "force-dynamic";

async function evidenceAccess(user: Awaited<ReturnType<typeof getSessionUser>>, organizationId: number, decisionId: number) {
  if (!user) return { error: Response.json({ error: "Authentication required." }, { status: 401 }) };

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to access employment decision evidence.",
  );
  if (denied) return { error: denied };

  const access = await getAccess(user.id, organizationId);
  if (!access) return { error: Response.json({ error: "Workspace access required." }, { status: 403 }) };

  const [decision] = await db.select().from(hcmEmploymentTermDecisions).where(and(
    eq(hcmEmploymentTermDecisions.id, decisionId),
    eq(hcmEmploymentTermDecisions.organizationId, organizationId),
  )).limit(1);
  if (!decision) return { error: Response.json({ error: "Employment-term decision not found." }, { status: 404 }) };

  if (access.companyWide && roleAllowed(access.role, PEOPLE_ADMIN_ROLES)) {
    return { access, decision, managerReviewOnly: false as const };
  }

  if (access.role !== "manager" || !user.employeeId) {
    return { error: Response.json({
      error: "Decision evidence is limited to company-wide People administrators and the worker's current manager.",
    }, { status: 403 }) };
  }

  const [managed] = await db.select({ positionId: positionAssignments.positionId })
    .from(positionAssignments)
    .innerJoin(positions, eq(positionAssignments.positionId, positions.id))
    .where(and(
      eq(positionAssignments.organizationId, organizationId),
      eq(positionAssignments.employeeId, decision.employeeId),
      eq(positionAssignments.assignmentType, "primary"),
      isNull(positionAssignments.effectiveUntil),
      eq(positions.managerEmployeeId, user.employeeId),
    ))
    .limit(1);

  if (!managed) {
    return { error: Response.json({ error: "This worker is not currently assigned to you as manager." }, { status: 403 }) };
  }

  return { access, decision, managerReviewOnly: true as const };
}

function downloadHeaders(decisionId: number) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="employment-decision-${decisionId}-evidence.json"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { id } = await context.params;
  const decisionId = Number(id);
  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(decisionId) || !Number.isInteger(organizationId)) {
    return Response.json({ error: "Valid decision id and organizationId are required." }, { status: 400 });
  }

  const gate = await evidenceAccess(user, organizationId, decisionId);
  if ("error" in gate) return gate.error;

  const packet = await loadEmploymentDecisionEvidencePacket({ organizationId, decisionId });
  if (!packet) return Response.json({ error: "Decision evidence packet could not be assembled." }, { status: 404 });

  if (url.searchParams.get("download") === "1") {
    return new Response(JSON.stringify(packet, null, 2), { headers: downloadHeaders(decisionId) });
  }

  return Response.json({
    packet,
    canContribute: gate.decision.status === "pending_approval",
    managerReviewOnly: gate.managerReviewOnly,
    uploadLimits: {
      maxBytes: MAX_UPLOAD_BYTES,
      accepted: ["application/pdf", "image/png", "image/jpeg"],
    },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { id } = await context.params;
  const decisionId = Number(id);
  if (!Number.isInteger(decisionId)) {
    return Response.json({ error: "A valid decision id is required." }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    if (!documentUploadsEnabled()) {
      return Response.json({
        error: "Decision evidence uploads are disabled for this production rollout.",
        code: "DOCUMENT_UPLOADS_DISABLED",
      }, { status: 503 });
    }

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
      return Response.json({ error: "Upload body is too large." }, { status: 413 });
    }

    const form = await request.formData().catch(() => null);
    if (!form) return Response.json({ error: "Multipart form data is required." }, { status: 400 });

    const organizationId = Number(form.get("organizationId"));
    const file = form.get("file");
    const evidenceKind = String(form.get("evidenceKind") ?? "").trim().toLowerCase();
    const label = String(form.get("label") ?? "").trim().slice(0, 180);
    if (!Number.isInteger(organizationId)
        || !(file instanceof File)
        || !EMPLOYMENT_DECISION_EVIDENCE_KINDS.includes(evidenceKind as any)
        || label.length < 2) {
      return Response.json({
        error: "Valid organizationId, evidence kind, label, and file are required.",
      }, { status: 400 });
    }

    const gate = await evidenceAccess(user, organizationId, decisionId);
    if ("error" in gate) return gate.error;
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
    const rateDenied = await enforceSensitiveActionRateLimit(request, {
      userId: user.id,
      action: "hcm-employment-decision-evidence-upload",
      resourceId: decisionId,
      limit: 20,
      windowMs: 5 * 60_000,
    });
    if (rateDenied) return rateDenied;

    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.` }, { status: 413 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validateUpload(bytes, file.type, file.name);
    if (!check.ok) return Response.json({ error: check.error }, { status: 422 });

    const scan = await scanUpload(bytes, { fileName: file.name, mime: check.mime });
    if (!scan.scannedClean) {
      if (!scan.unavailable) {
        await recordAuditEvent({
          organizationId,
          actor: user.name,
          action: "Employment decision evidence upload blocked by malware scan",
          resource: `Decision #${decisionId}`,
          metadata: {
            employeeId: gate.decision.employeeId,
            fileName: safeFileName(file.name),
            threat: scan.threat ?? null,
            engine: scan.engine ?? null,
          },
        });
        return Response.json({ error: "The file was rejected by malware scanning.", code: "MALWARE_DETECTED" }, { status: 422 });
      }
      if (process.env.NODE_ENV === "production") {
        return Response.json({
          error: "Evidence uploads are temporarily unavailable because malware scanning could not verify the file.",
          code: "MALWARE_SCAN_UNAVAILABLE",
        }, { status: 503 });
      }
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`
        select id
        from hcm_employment_term_decisions
        where id = ${decisionId}
          and organization_id = ${organizationId}
        for update
      `);
      const [locked] = await tx.select().from(hcmEmploymentTermDecisions).where(and(
        eq(hcmEmploymentTermDecisions.id, decisionId),
        eq(hcmEmploymentTermDecisions.organizationId, organizationId),
      )).limit(1);
      if (!locked) throw new Error("Employment-term decision not found.");
      if (locked.status !== "pending_approval") {
        throw new Error("Review evidence is sealed once an employment decision leaves pending approval.");
      }

      const [document] = await tx.insert(documents).values({
        organizationId,
        employeeId: locked.employeeId,
        kind: "employment_decision_evidence",
        fileName: safeFileName(file.name),
        mimeType: check.mime,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        scannedClean: scan.scannedClean,
        scanNote: scan.note,
        uploadedBy: user.name,
        content: Buffer.from(bytes).toString("base64"),
      }).returning();

      const [evidence] = await tx.insert(hcmEmploymentDecisionDocuments).values({
        organizationId,
        decisionId,
        employeeId: locked.employeeId,
        documentId: document.id,
        evidenceKind,
        label,
        attachedByUserId: user.id,
        attachedByName: user.name,
      }).returning();

      await tx.insert(hcmEmploymentDecisionEvents).values({
        organizationId,
        decisionId,
        employeeId: locked.employeeId,
        eventType: "document_attached",
        actorUserId: user.id,
        actorName: user.name,
        metadata: {
          evidenceDocumentId: evidence.id,
          documentId: document.id,
          evidenceKind,
          label,
          fileName: document.fileName,
          sha256: document.sha256,
        },
      });

      return { document, evidence };
    }).catch((error) => ({ error: error instanceof Error ? error.message : "Evidence upload failed." } as const));

    if ("error" in result) return Response.json({ error: result.error }, { status: 409 });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employment decision evidence attached",
      resource: `Decision #${decisionId}`,
      metadata: {
        employeeId: gate.decision.employeeId,
        evidenceDocumentId: result.evidence.id,
        documentId: result.document.id,
        evidenceKind,
        sha256: result.document.sha256,
      },
    });

    return Response.json({
      evidence: result.evidence,
      document: {
        id: result.document.id,
        fileName: result.document.fileName,
        mimeType: result.document.mimeType,
        byteSize: result.document.byteSize,
        sha256: result.document.sha256,
      },
      scan,
    }, { status: 201 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const noteKind = String(body.noteKind ?? "").trim().toLowerCase();
  const note = String(body.note ?? "").trim().slice(0, 4000);
  if (!Number.isInteger(organizationId)
      || !EMPLOYMENT_DECISION_NOTE_KINDS.includes(noteKind as any)
      || note.length < 3) {
    return Response.json({ error: "Valid organizationId, note kind, and review note are required." }, { status: 400 });
  }

  const gate = await evidenceAccess(user, organizationId, decisionId);
  if ("error" in gate) return gate.error;
  if (gate.managerReviewOnly && noteKind !== "manager_review") {
    return Response.json({ error: "Managers can contribute manager-review notes only." }, { status: 403 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "hcm-employment-decision-evidence-note",
    resourceId: decisionId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`
      select id
      from hcm_employment_term_decisions
      where id = ${decisionId}
        and organization_id = ${organizationId}
      for update
    `);
    const [locked] = await tx.select().from(hcmEmploymentTermDecisions).where(and(
      eq(hcmEmploymentTermDecisions.id, decisionId),
      eq(hcmEmploymentTermDecisions.organizationId, organizationId),
    )).limit(1);
    if (!locked) throw new Error("Employment-term decision not found.");
    if (locked.status !== "pending_approval") {
      throw new Error("Review evidence is sealed once an employment decision leaves pending approval.");
    }

    const [created] = await tx.insert(hcmEmploymentDecisionNotes).values({
      organizationId,
      decisionId,
      employeeId: locked.employeeId,
      noteKind,
      content: note,
      createdByUserId: user.id,
      createdByName: user.name,
    }).returning();

    await tx.insert(hcmEmploymentDecisionEvents).values({
      organizationId,
      decisionId,
      employeeId: locked.employeeId,
      eventType: "note_added",
      actorUserId: user.id,
      actorName: user.name,
      metadata: {
        evidenceNoteId: created.id,
        noteKind,
      },
    });

    return created;
  }).catch((error) => ({ error: error instanceof Error ? error.message : "Review note could not be added." } as const));

  if ("error" in result) return Response.json({ error: result.error }, { status: 409 });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Employment decision evidence note added",
    resource: `Decision #${decisionId}`,
    metadata: {
      employeeId: gate.decision.employeeId,
      evidenceNoteId: result.id,
      noteKind,
    },
  });

  return Response.json({ note: result }, { status: 201 });
}
