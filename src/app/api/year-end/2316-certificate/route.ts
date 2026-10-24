import { getSessionUser } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { separationRecords } from "@/db/schema";
import { frozenFinalPayLegalEntityId } from "@/lib/bir-2316-employer";
import { assertEntityResource, resolveMultiEntityContext } from "@/lib/multi-entity-server";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";
import { certificateDraftEnabled, CertificateSourceError, load2316CertificateSource } from "@/lib/bir-2316-certificate-server";
import { object, prepare2316Certificate, type CertificateScope } from "@/lib/bir-2316-certificate";
import { render2316CertificatePdf } from "@/lib/bir-2316-pdf";
import { createHash } from "node:crypto";
import { certificateSourceDigest } from "@/lib/bir-2316-source-digest";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
async function respond(request: Request, mode: "source" | "pdf") {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers });
  if (!certificateDraftEnabled()) return Response.json({ error: "Certificate preview is not enabled." }, { status: 404, headers });
  if (mode === "pdf") { const denied = enforceSameOriginMutation(request); if (denied) return denied; }
  const query = new URL(request.url).searchParams;
  const scope: CertificateScope = { organizationId: Number(query.get("organizationId")), employeeId: Number(query.get("employeeId")), taxYear: Number(query.get("taxYear")) };
  if (query.has("separationId")) scope.separationId = Number(query.get("separationId"));
  if (![scope.organizationId, scope.employeeId, ...(scope.separationId === undefined ? [] : [scope.separationId])].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isInteger(scope.taxYear) || scope.taxYear < 2021 || scope.taxYear > 2100) return Response.json({ error: "Select an employer, employee and valid tax year." }, { status: 400, headers });
  const denied = await assertOrganizationRole(user.id, scope.organizationId, PAYROLL_OPERATOR_ROLES, "Only payroll operators can prepare certificate previews.");
  if (denied) return denied;
  if (!(await getAccess(user.id, scope.organizationId))?.companyWide) return Response.json({ error: "Company-wide payroll access required." }, { status: 403, headers });
  const mfa = requireSensitiveActionMfa(user); if (mfa) return mfa;
  const entityScope = await resolveMultiEntityContext({
    userId: user.id, organizationId: scope.organizationId, request,
  });
  if (!entityScope.ok) return entityScope.response;
  if (entityScope.context.enabled) {
    // Tenant-wide annual 2316 is deferred. Only a frozen final-pay employer
    // may authorize a draft before any private certificate source is assembled.
    if (scope.separationId === undefined) {
      return Response.json({ error: "Select a released separation for employer-scoped 2316.",
        code: "ENTITY_YEAR_END_DEFERRED" }, { status: 409, headers });
    }
    const [frozen] = await db.select({ snapshot: separationRecords.computationSnapshot })
      .from(separationRecords).where(and(
        eq(separationRecords.id, scope.separationId),
        eq(separationRecords.organizationId, scope.organizationId),
        eq(separationRecords.employeeId, scope.employeeId),
      )).limit(1);
    if (!frozen) return Response.json({ error: "Certificate source not found." }, { status: 404, headers });
    const earlyDenied = assertEntityResource(entityScope.context, frozenFinalPayLegalEntityId(frozen.snapshot));
    if (earlyDenied) return earlyDenied;
  }
  try {
    const source = await load2316CertificateSource(scope);
    // Second check binds the transactional certificate source, preventing
    // changed attribution between the preliminary guard and the response.
    const sourceDenied = assertEntityResource(entityScope.context, source.legalEntityId);
    if (sourceDenied) return sourceDenied;
    const sourceDigest = certificateSourceDigest(source);
    if (mode === "source") {
      await recordAuditEvent({ organizationId: scope.organizationId, actor: user.name, action: "BIR 2316 preparer source viewed", resource: `Employee #${scope.employeeId} / ${scope.taxYear}`, metadata: { ...scope, plaintextPersisted: false } });
      return Response.json({ source, sourceDigest, notice: "Preparer preview only. Nothing is saved, approved, signed or filed." }, { headers });
    }
    if (Number(request.headers.get("content-length") ?? 0) > 32768) return Response.json({ error: "Review is too large." }, { status: 413, headers });
    const text = await request.text();
    if (text.length > 32768) return Response.json({ error: "Review is too large." }, { status: 413, headers });
    let review: unknown;
    try {
      const input = object(JSON.parse(text));
      if (input.sourceDigest !== sourceDigest) return Response.json({ error: "Source records changed or the review is unbound. Load source records again and review the current figures.", code: "CERTIFICATE_SOURCE_CHANGED" }, { status: 409, headers });
      review = input.review;
    } catch { return Response.json({ error: "Invalid review JSON." }, { status: 400, headers }); }
    const prepared = prepare2316Certificate(source, review);
    if (!prepared.ok) return Response.json({ error: "Complete the review and resolve all source discrepancies before generating the unsigned PDF.", issues: prepared.issues }, { status: 422, headers });
    const pdf = await render2316CertificatePdf(source, review);
    await recordAuditEvent({ organizationId: scope.organizationId, actor: user.name,
      action: "Unsigned BIR 2316 preparer preview generated", resource: `Employee #${scope.employeeId} / ${scope.taxYear}`,
      metadata: { ...scope, sourceDigest, unsigned: true, plaintextPersisted: false, sha256: createHash("sha256").update(pdf).digest("hex") } });
    return new Response(Buffer.from(pdf), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="bir-2316-unsigned-${scope.taxYear}.pdf"` } });
  } catch (error) {
    const code = error instanceof CertificateSourceError ? error.message : "CERTIFICATE_PREVIEW_UNAVAILABLE";
    return Response.json({ error: "Certificate preview is unavailable. Verify the source records and field lengths before retrying.", code }, { status: 409, headers });
  }
}
export const GET = (request: Request) => respond(request, "source");
export const POST = (request: Request) => respond(request, "pdf");
