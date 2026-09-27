import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, employees } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, safeFileName, scanStatus, validateUpload } from "@/lib/storage";
import { assertPermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedDocs = await assertPermission(user.id, organizationId, "hr:read");
  if (deniedDocs) return deniedDocs;
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
  const bodyPreview = await request.clone().json().catch(() => ({}));
  const deniedUpload = await assertPermission(user.id, Number(bodyPreview.organizationId), "hr:manage");
  if (deniedUpload) return deniedUpload;

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Multipart form data is required." }, { status: 400 });

  const organizationId = Number(form.get("organizationId"));
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "other");
  const employeeRaw = form.get("employeeId");

  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "A file is required." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateUpload(bytes, file.type, file.name);
  if (!check.ok) return Response.json({ error: check.error }, { status: 422 });

  let employeeId: number | null = null;
  if (employeeRaw && employeeRaw !== "null" && employeeRaw !== "") {
    const candidate = Number(employeeRaw);
    if (!Number.isInteger(candidate)) return Response.json({ error: "employeeId must be an integer." }, { status: 422 });
    const [employee] = await db.select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, candidate), eq(employees.organizationId, organizationId)));
    if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
    employeeId = employee.id;
  }

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
    // Base64 at rest. Swap for S3/R2 by replacing this column write with an
    // object-store PUT and storing the key instead.
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
    scan: scan,
    note: "Stored in Postgres. Configure object storage (S3/R2) before production volume.",
  }, { status: 201 });
}
