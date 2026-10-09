import { timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { getAccess, assertOrganizationRole, assertScope, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { isEssIdentifierKind, normalizeEssIdentifier, type EssIdentifierKind } from "@/lib/ess-identifiers";
import { essIdentifierRequests, essOtherIdentifiers } from "@/lib/ess-profile-schema";
import { decryptGovernmentId, maskGovernmentId } from "@/lib/government-id-crypto";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };
const CORE_ID_KEYS = new Set<EssIdentifierKind>(["sssNo", "tin", "tinBranchCode", "philHealthNo", "pagIbigNo"]);

async function authorized(organizationId: number) {
  const user = await getSessionUser();
  if (!user) return { ok: false as const, denied: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return { ok: false as const, denied: Response.json({ error: "organizationId is required." }, { status: 400 }) };
  }
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES, "HR role required to review employee identifiers.");
  if (denied) return { ok: false as const, denied };
  const access = await getAccess(user.id, organizationId);
  if (!access) return { ok: false as const, denied: Response.json({ error: "No organization access." }, { status: 403 }) };
  return { ok: true as const, user, access };
}

export async function GET(request: Request) {
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  const ctx = await authorized(organizationId);
  if (!ctx.ok) return ctx.denied;

  const all = await db.select({
    id: essIdentifierRequests.id,
    kind: essIdentifierRequests.kind,
    proposedEncrypted: essIdentifierRequests.proposedEncrypted,
    status: essIdentifierRequests.status,
    requestedAt: essIdentifierRequests.requestedAt,
    employeeId: employees.id,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    orgUnitId: employees.orgUnitId,
    tin: employees.tin,
    tinBranchCode: employees.tinBranchCode,
    sssNo: employees.sssNo,
    philHealthNo: employees.philHealthNo,
    pagIbigNo: employees.pagIbigNo,
  }).from(essIdentifierRequests)
    .innerJoin(employees, and(eq(essIdentifierRequests.employeeId, employees.id), eq(essIdentifierRequests.organizationId, employees.organizationId)))
    .where(and(eq(essIdentifierRequests.organizationId, organizationId), eq(essIdentifierRequests.status, "pending")))
    .orderBy(desc(essIdentifierRequests.requestedAt))
    .limit(100);

  const visible = all.filter((row) => ctx.access.companyWide || row.orgUnitId === ctx.access.orgUnitId);
  const optionalExisting = await db.select({
    employeeId: essOtherIdentifiers.employeeId,
    kind: essOtherIdentifiers.kind,
    encryptedValue: essOtherIdentifiers.encryptedValue,
  }).from(essOtherIdentifiers).where(eq(essOtherIdentifiers.organizationId, organizationId));
  const lookup = new Map(optionalExisting.map((r) => [r.employeeId + ":" + r.kind, r.encryptedValue]));

  return Response.json({
    requests: visible.filter((row) => isEssIdentifierKind(row.kind)).map((row) => {
      const existing = CORE_ID_KEYS.has(row.kind as EssIdentifierKind)
        ? row[row.kind as keyof Pick<typeof row, "sssNo" | "tin" | "tinBranchCode" | "philHealthNo" | "pagIbigNo">]
        : lookup.get(row.employeeId + ":" + row.kind) ?? null;
      return {
        id: row.id,
        employeeId: row.employeeId,
        employeeNo: row.employeeNo,
        employeeName: row.firstName + " " + row.lastName,
        kind: row.kind,
        currentMasked: maskGovernmentId(existing),
        proposedMasked: maskGovernmentId(row.proposedEncrypted),
        requestedAt: row.requestedAt,
        status: row.status,
      };
    }),
  }, { headers: PRIVATE_HEADERS });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const body = await request.json().catch(() => null);
  const organizationId = Number(body?.organizationId);
  const requestId = Number(body?.requestId);
  const action = body?.action;
  const ctx = await authorized(organizationId);
  if (!ctx.ok) return ctx.denied;
  const demoDenied = publicDemoMutationDenied(ctx.user.email, "Reviewing employee identifiers");
  if (demoDenied) return demoDenied;
  const mfaDenied = requireSensitiveActionMfa(ctx.user);
  if (mfaDenied) return mfaDenied;
  const limited = await enforceSensitiveActionRateLimit(request, {
    userId: ctx.user.id, action: "ess-id-review", resourceId: organizationId,
    limit: 15, windowMs: 10 * 60_000,
  });
  if (limited) return limited;
  if (!Number.isSafeInteger(requestId) || requestId <= 0 || !["approve", "reject"].includes(action)) {
    return Response.json({ error: "Valid request and decision are required." }, { status: 400 });
  }

  const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote.trim().slice(0, 500) : "";
  if (action === "reject" && reviewNote.length < 8) {
    return Response.json({ error: "Explain why this ID request cannot be approved (8 or more characters)." }, { status: 422 });
  }
  if (action === "approve" && body.verifiedAgainstRecord !== true) {
    return Response.json({ error: "Confirm that the number was checked against a trusted HR or official agency record." }, { status: 422 });
  }

  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select({
      id: essIdentifierRequests.id,
      employeeId: essIdentifierRequests.employeeId,
      organizationId: essIdentifierRequests.organizationId,
      kind: essIdentifierRequests.kind,
      proposedEncrypted: essIdentifierRequests.proposedEncrypted,
      status: essIdentifierRequests.status,
      employeeNo: employees.employeeNo,
      orgUnitId: employees.orgUnitId,
    }).from(essIdentifierRequests)
      .innerJoin(employees, and(eq(essIdentifierRequests.employeeId, employees.id), eq(essIdentifierRequests.organizationId, employees.organizationId)))
      .where(and(eq(essIdentifierRequests.id, requestId), eq(essIdentifierRequests.organizationId, organizationId)))
      .for("update")
      .limit(1);

    if (!row) return { error: "ID request not found.", status: 404 };
    const scope = assertScope(ctx.access, row.orgUnitId);
    if (!scope.ok) return { error: scope.error, status: scope.status };
    if (row.status !== "pending") return { error: "This request has already been reviewed.", status: 409 };
    if (!isEssIdentifierKind(row.kind)) return { error: "Unsupported ID type.", status: 422 };

    if (action === "approve") {
      const verified = normalizeEssIdentifier(row.kind, body.verifiedValue);
      if (!verified.ok) return { error: verified.error, status: 422 };
      const original = decryptGovernmentId(row.proposedEncrypted);
      if (!original) return { error: "Encrypted ID is unavailable.", status: 422 };
      const first = Buffer.from(verified.value, "utf8");
      const second = Buffer.from(original, "utf8");
      if (first.length !== second.length || !timingSafeEqual(first, second)) {
        return { error: "The entered ID does not match the submitted request. Check the trusted record.", status: 422 };
      }

      // Only approved values can affect the authoritative employee record.
      if (row.kind === "sssNo") await tx.update(employees).set({ sssNo: row.proposedEncrypted }).where(eq(employees.id, row.employeeId));
      else if (row.kind === "tin") await tx.update(employees).set({ tin: row.proposedEncrypted }).where(eq(employees.id, row.employeeId));
      else if (row.kind === "tinBranchCode") await tx.update(employees).set({ tinBranchCode: row.proposedEncrypted }).where(eq(employees.id, row.employeeId));
      else if (row.kind === "philHealthNo") await tx.update(employees).set({ philHealthNo: row.proposedEncrypted }).where(eq(employees.id, row.employeeId));
      else if (row.kind === "pagIbigNo") await tx.update(employees).set({ pagIbigNo: row.proposedEncrypted }).where(eq(employees.id, row.employeeId));
      else {
        await tx.insert(essOtherIdentifiers).values({
          organizationId, employeeId: row.employeeId, kind: row.kind,
          encryptedValue: row.proposedEncrypted, verifiedByUserId: ctx.user.id, updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: [essOtherIdentifiers.employeeId, essOtherIdentifiers.kind],
          set: { encryptedValue: row.proposedEncrypted, verifiedByUserId: ctx.user.id, updatedAt: new Date() },
        });
      }
    }

    await tx.update(essIdentifierRequests)
      .set({
        status: action === "approve" ? "approved" : "rejected",
        reviewedByUserId: ctx.user.id,
        reviewedAt: new Date(),
        reviewNote: reviewNote || null,
      }).where(eq(essIdentifierRequests.id, row.id));
    return {
      ok: true, employeeNo: row.employeeNo, employeeId: row.employeeId,
      kind: row.kind, status: action === "approve" ? "approved" : "rejected",
    };
  });

  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  await recordAuditEvent({
    organizationId,
    actor: ctx.user.name,
    action: action === "approve" ? "Employee identifier verified and applied" : "Employee identifier request rejected",
    resource: result.employeeNo,
    metadata: { requestId, employeeId: result.employeeId, kind: result.kind, decision: result.status, verifiedAgainstRecord: action === "approve" },
  });
  return Response.json({ ok: true, status: result.status }, { headers: PRIVATE_HEADERS });
}
