import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";
import { certificateDraftEnabled, CertificateSourceError, load2316CertificateSource } from "@/lib/bir-2316-certificate-server";
import { object, prepare2316Certificate, type CertificateScope } from "@/lib/bir-2316-certificate";
import { render2316CertificatePdf } from "@/lib/bir-2316-pdf";
import { createHash } from "node:crypto";
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
  try {
    const source = await load2316CertificateSource(scope);
    if (mode === "source") {
      await recordAuditEvent({ organizationId: scope.organizationId, actor: user.name, action: "BIR 2316 preparer source viewed", resource: `Employee #${scope.employeeId} / ${scope.taxYear}`, metadata: { ...scope, plaintextPersisted: false } });
      return Response.json({ source, notice: "Preparer preview only. Nothing is saved, approved, signed or filed." }, { headers });
    }
    if (Number(request.headers.get("content-length") ?? 0) > 32768) return Response.json({ error: "Review is too large." }, { status: 413, headers });
    const text = await request.text();
    if (text.length > 32768) return Response.json({ error: "Review is too large." }, { status: 413, headers });
    let review: unknown;
    try { review = object(JSON.parse(text)).review; } catch { return Response.json({ error: "Invalid review JSON." }, { status: 400, headers }); }
    const prepared = prepare2316Certificate(source, review);
    if (!prepared.ok) return Response.json({ error: "Complete the review and resolve all source discrepancies before generating the unsigned PDF.", issues: prepared.issues }, { status: 422, headers });
    const pdf = await render2316CertificatePdf(source, review);
    await recordAuditEvent({ organizationId: scope.organizationId, actor: user.name,
      action: "Unsigned BIR 2316 preparer preview generated", resource: `Employee #${scope.employeeId} / ${scope.taxYear}`,
      metadata: { ...scope, unsigned: true, plaintextPersisted: false, sha256: createHash("sha256").update(pdf).digest("hex") } });
    return new Response(Buffer.from(pdf), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="bir-2316-unsigned-${scope.taxYear}.pdf"` } });
  } catch (error) {
    const code = error instanceof CertificateSourceError ? error.message : "CERTIFICATE_PREVIEW_UNAVAILABLE";
    return Response.json({ error: "Certificate preview is unavailable. Verify the source records and field lengths before retrying.", code }, { status: 409, headers });
  }
}
export const GET = (request: Request) => respond(request, "source");
export const POST = (request: Request) => respond(request, "pdf");
