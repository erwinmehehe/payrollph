import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { ESS_IDENTIFIER_KINDS, ESS_CORE_IDENTIFIER_KINDS, isEssIdentifierKind, normalizeEssIdentifier, type EssIdentifierKind } from "@/lib/ess-identifiers";
import { essIdentifierRequests, essOtherIdentifiers } from "@/lib/ess-profile-schema";
import { encryptGovernmentId, maskGovernmentId } from "@/lib/government-id-crypto";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

async function context() {
  const session = await getSessionUser();
  if (!session) return { ok: false as const, denied: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (session.role !== "employee" || !session.employeeId) {
    return { ok: false as const, denied: Response.json({ error: "Linked employee account required." }, { status: 403 }) };
  }
  const [employee] = await db.select({
    id: employees.id,
    employeeNo: employees.employeeNo,
    organizationId: employees.organizationId,
    tin: employees.tin,
    tinBranchCode: employees.tinBranchCode,
    sssNo: employees.sssNo,
    philHealthNo: employees.philHealthNo,
    pagIbigNo: employees.pagIbigNo,
  }).from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!employee) return { ok: false as const, denied: Response.json({ error: "Employee record not found." }, { status: 404 }) };
  const denied = await assertMembership(session.id, employee.organizationId);
  if (denied) return { ok: false as const, denied };
  return { ok: true as const, session, employee };
}

export async function GET() {
  const ctx = await context();
  if (!ctx.ok) return ctx.denied;
  const [other, requests] = await Promise.all([
    db.select({
      kind: essOtherIdentifiers.kind,
      encryptedValue: essOtherIdentifiers.encryptedValue,
    }).from(essOtherIdentifiers)
      .where(and(eq(essOtherIdentifiers.employeeId, ctx.employee.id), eq(essOtherIdentifiers.organizationId, ctx.employee.organizationId))),
    db.select({
      id: essIdentifierRequests.id,
      kind: essIdentifierRequests.kind,
      proposedEncrypted: essIdentifierRequests.proposedEncrypted,
      status: essIdentifierRequests.status,
      requestedAt: essIdentifierRequests.requestedAt,
      reviewedAt: essIdentifierRequests.reviewedAt,
      reviewNote: essIdentifierRequests.reviewNote,
    }).from(essIdentifierRequests)
      .where(and(eq(essIdentifierRequests.employeeId, ctx.employee.id), eq(essIdentifierRequests.organizationId, ctx.employee.organizationId)))
      .orderBy(desc(essIdentifierRequests.requestedAt))
      .limit(40),
  ]);
  const otherMap = new Map(other.map((row) => [row.kind, row.encryptedValue]));
  const current = Object.fromEntries(ESS_IDENTIFIER_KINDS.map((kind) => {
    const existing = ESS_CORE_IDENTIFIER_KINDS.includes(kind)
      ? ctx.employee[kind as keyof Pick<typeof ctx.employee, "sssNo" | "tin" | "tinBranchCode" | "philHealthNo" | "pagIbigNo">]
      : otherMap.get(kind) ?? null;
    return [kind, { hasValue: Boolean(existing), masked: maskGovernmentId(existing) }];
  })) as Record<EssIdentifierKind, { hasValue: boolean; masked: string | null }>;
  return Response.json({
    current,
    requests: requests.filter((row) => isEssIdentifierKind(row.kind)).map((row) => ({
      id: row.id,
      kind: row.kind,
      proposedMasked: maskGovernmentId(row.proposedEncrypted),
      status: row.status,
      requestedAt: row.requestedAt,
      reviewedAt: row.reviewedAt,
      reviewNote: row.reviewNote,
    })),
  }, { headers: PRIVATE_HEADERS });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const ctx = await context();
  if (!ctx.ok) return ctx.denied;
  const demoDenied = publicDemoMutationDenied(ctx.session.email, "Employee government ID changes");
  if (demoDenied) return demoDenied;
  const limited = await enforceSensitiveActionRateLimit(request, {
    userId: ctx.session.id, action: "ess-id-update", limit: 10, windowMs: 10 * 60_000,
  });
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  if (!body || !isEssIdentifierKind(body.kind)) {
    return Response.json({ error: "Choose one supported ID type." }, { status: 422 });
  }
  const kind: EssIdentifierKind = body.kind;
  const parsed = normalizeEssIdentifier(kind, body.value);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 422 });
  const [pending] = await db.select({ id: essIdentifierRequests.id }).from(essIdentifierRequests)
    .where(and(
      eq(essIdentifierRequests.employeeId, ctx.employee.id),
      eq(essIdentifierRequests.kind, kind),
      eq(essIdentifierRequests.status, "pending"),
    )).limit(1);
  if (pending) return Response.json({ error: "A request for this ID is already awaiting HR review." }, { status: 409 });

  let proposedEncrypted: string;
  try {
    proposedEncrypted = encryptGovernmentId(parsed.value, { required: true })!;
  } catch {
    return Response.json({ error: "Secure ID storage is not configured. Contact your HR administrator." }, { status: 503 });
  }
  let saved: { id: number } | undefined;
  try {
    [saved] = await db.insert(essIdentifierRequests).values({
      organizationId: ctx.employee.organizationId,
      employeeId: ctx.employee.id,
      kind,
      proposedEncrypted,
      requestedByUserId: ctx.session.id,
      status: "pending",
    }).returning({ id: essIdentifierRequests.id });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return Response.json({ error: "A request for this ID is already awaiting HR review." }, { status: 409 });
    }
    throw error;
  }
  await recordAuditEvent({
    organizationId: ctx.employee.organizationId,
    actor: ctx.session.name,
    action: "Employee government ID change requested",
    resource: ctx.employee.employeeNo,
    metadata: { employeeId: ctx.employee.id, requestId: saved?.id, kind, status: "pending" },
  });
  return Response.json({ ok: true, id: saved?.id, status: "pending", message: "Submitted for HR verification. Payroll records have not changed." }, { status: 201, headers: PRIVATE_HEADERS });
}
