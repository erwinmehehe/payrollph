import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, employees } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, safeFileName, scanStatus, validateUpload } from "@/lib/storage";
import { assertMembership, assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";

import { denyPublicDemoSideEffect } from "@/lib/public-demo-guard";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;

    const rows = await db.select({
      id: documents.id,
      employeeId: documents.employeeId,
      kind: documents.kind,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      byteSize: documents.byteSize,
      scannedClean: documents.scannedClean,
      scanNote: documents.scanNote,
      uploadedBy: documents.uploadedBy,
      createdAt: documents.createdAt,
    }).from(documents)
      .where(and(eq(documents.organizationId, organizationId), eq(documents.employeeId, user.employeeId)))
      .orderBy(desc(documents.id));

    return Response.json({
      documents: rows,
      limits: { maxBytes: MAX_UPLOAD_BYTES, accepted: ["application/pdf", "image/png", "image/jpeg"] },
    });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view company documents.",
  );
  if (denied) return denied;

  const rows = await db.select({
    id: documents.id,
    employeeId: documents.employeeId,
    kind: documents.kind,
    fileName: documents.fileName,
    mimeType: documents.mimeType,
    byteSize: documents.byteSize,
    scannedClean: documents.scannedClean,
    scanNote: documents.scanNote,
    uploadedBy: documents.uploadedBy,
    createdAt: documents.createdAt,
  }).from(documents)
    .where(eq(documents.organizationId, organizationId))
    .orderBy(desc(documents.id));

  const staff = await db.select({ id: employees.id, first: employees.firstName, last: employees.lastName })
    .from(employees).where(eq(employees.organizationId, organizationId));
  const names = new Map(staff.map((row) => [row.id, `${row.first} ${row.last}`]));

  return Response.json({
    documents: rows.map((row) => ({ ...row, employeeName: row.employeeId ? names.get(row.employeeId) ?? null : null })),
    limits: { maxBytes: MAX_UPLOAD_BYTES, accepted: ["application/pdf", "image/png", "image/jpeg"] },
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return Response.json({ error: "Upload request is too large." }, { status: 413 });
  }

  // This endpoint is multipart. Parse the form first, never clone it as JSON.
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Multipart form data is required." }, { status: 400 });

  const organizationId = Number(form.get("organizationId"));
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "other").slice(0, 40);
  const employeeRaw = form.get("employeeId");

  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "A file is required." }, { status: 400 });

  const demoDenied = await denyPublicDemoSideEffect(organizationId, "Document uploads");
  if (demoDenied) return demoDenied;

  let employeeId: number | null = null;
  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
    employeeId = user.employeeId;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can upload company documents.",
    );
    if (denied) return denied;

    if (employeeRaw && employeeRaw !== "null" && employeeRaw !== "") {
      const candidate = Number(employeeRaw);
      if (!Number.isInteger(candidate)) return Response.json({ error: "employeeId must be an integer." }, { status: 422 });
      const [employee] = await db.select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, candidate), eq(employees.organizationId, organizationId)));
      if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
      employeeId = employee.id;
    }
  }

  if (employeeId != null) {
    const [employee] = await db.select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
      .limit(1);
    if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateUpload(bytes, file.type, file.name);
  if (!check.ok) return Response.json({ error: check.error }, { status: 422 });

  const scan = scanStatus();
  const [row] = await db.insert(documents).values({
    organizationId,
    employeeId,
    kind,
    fileName: safeFileName(file.name),
    mimeType: check.mime,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    scannedClean: scan.scannedClean,
    scanNote: scan.note,
    uploadedBy: user.name,
    content: Buffer.from(bytes).toString("base64"),
  }).returning({ id: documents.id, fileName: documents.fileName, byteSize: documents.byteSize });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Document uploaded",
    resource: row.fileName,
    metadata: { kind, employeeId, sha256Verified: true, avScanned: scan.scannedClean },
  });

  return Response.json({
    id: row.id,
    fileName: row.fileName,
    byteSize: row.byteSize,
    detectedMime: check.mime,
    scan,
    note: "Stored in Postgres. Configure object storage (S3/R2) before production volume.",
  }, { status: 201 });
}
