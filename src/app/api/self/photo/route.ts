import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { essEmployeePhotos } from "@/lib/ess-profile-schema";
import { assertMembership } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { documentUploadsEnabled, scanUpload, validateUpload } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PHOTO_BYTES = 512 * 1024;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

async function employeeContext() {
  const session = await getSessionUser();
  if (!session) return { ok: false as const, denied: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (session.role !== "employee" || !session.employeeId) {
    return { ok: false as const, denied: Response.json({ error: "Linked employee account required." }, { status: 403 }) };
  }
  const [employee] = await db.select({
    id: employees.id,
    organizationId: employees.organizationId,
    employeeNo: employees.employeeNo,
  }).from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!employee) return { ok: false as const, denied: Response.json({ error: "Employee record not found." }, { status: 404 }) };
  const denied = await assertMembership(session.id, employee.organizationId);
  if (denied) return { ok: false as const, denied };
  return { ok: true as const, session, employee };
}

async function readPhoto(head = false) {
  const context = await employeeContext();
  if (!context.ok) return context.denied;
  const [photo] = await db.select({
    mimeType: essEmployeePhotos.mimeType,
    photoBase64: essEmployeePhotos.photoBase64,
  }).from(essEmployeePhotos)
    .where(and(eq(essEmployeePhotos.employeeId, context.employee.id), eq(essEmployeePhotos.organizationId, context.employee.organizationId)))
    .limit(1);
  if (!photo) return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  const headers = { ...PRIVATE_HEADERS, "Content-Type": photo.mimeType };
  return new Response(head ? null : Buffer.from(photo.photoBase64, "base64"), { headers, status: 200 });
}

export async function GET() {
  return readPhoto();
}
export async function HEAD() {
  return readPhoto(true);
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const context = await employeeContext();
  if (!context.ok) return context.denied;
  const demoDenied = publicDemoMutationDenied(context.session.email, "Changing employee profile photo");
  if (demoDenied) return demoDenied;
  const limited = await enforceSensitiveActionRateLimit(request, { userId: context.session.id, action: "ess-photo", limit: 6, windowMs: 60 * 60_000 });
  if (limited) return limited;
  if (!documentUploadsEnabled()) {
    return Response.json({ error: "Photo uploads are disabled until secure upload scanning is configured." }, { status: 503 });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES + 100_000) {
    return Response.json({ error: "Image exceeds the 512 KB limit." }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return Response.json({ error: "Select a PNG or JPEG photo." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) {
    return Response.json({ error: "Photo must be smaller than 512 KB." }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const verified = validateUpload(bytes, file.type, file.name);
  if (!verified.ok) return Response.json({ error: verified.error }, { status: 422 });
  if (verified.mime !== "image/jpeg" && verified.mime !== "image/png") {
    return Response.json({ error: "Photos must be JPEG or PNG." }, { status: 422 });
  }

  const scan = await scanUpload(bytes, { mime: verified.mime, fileName: file.name });
  if (!scan.scannedClean || scan.unavailable) {
    return Response.json({ error: "Photo could not be verified by the security scanner. No image was saved." }, { status: 503 });
  }

  await db.insert(essEmployeePhotos).values({
    employeeId: context.employee.id,
    organizationId: context.employee.organizationId,
    mimeType: verified.mime,
    byteSize: bytes.length,
    photoBase64: Buffer.from(bytes).toString("base64"),
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: essEmployeePhotos.employeeId,
    set: {
      mimeType: verified.mime,
      byteSize: bytes.length,
      photoBase64: Buffer.from(bytes).toString("base64"),
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      updatedAt: new Date(),
    },
  });

  await recordAuditEvent({
    organizationId: context.employee.organizationId,
    actor: context.session.name,
    action: "Employee profile photo updated",
    resource: context.employee.employeeNo,
    metadata: { employeeId: context.employee.id, contentType: verified.mime, byteSize: bytes.length },
  });
  return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
}

export async function DELETE(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const context = await employeeContext();
  if (!context.ok) return context.denied;
  const demoDenied = publicDemoMutationDenied(context.session.email, "Deleting employee profile photo");
  if (demoDenied) return demoDenied;
  const limited = await enforceSensitiveActionRateLimit(request, { userId: context.session.id, action: "ess-photo", limit: 6, windowMs: 60 * 60_000 });
  if (limited) return limited;

  await db.delete(essEmployeePhotos).where(and(
    eq(essEmployeePhotos.employeeId, context.employee.id),
    eq(essEmployeePhotos.organizationId, context.employee.organizationId),
  ));
  await recordAuditEvent({
    organizationId: context.employee.organizationId,
    actor: context.session.name,
    action: "Employee profile photo removed",
    resource: context.employee.employeeNo,
    metadata: { employeeId: context.employee.id },
  });
  return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
}
