import { createHash } from "node:crypto";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { loadBirAnnualEmployerSource } from "@/lib/bir-annual-employer-source";
import { buildReviewedBir1604cCandidate } from "@/lib/bir-1604c-pre-export";
import {
  bindBir1604cReviewToEmployer, buildBir1604cReviewTemplate,
  type Bir1604cReviewedPayload,
} from "@/lib/bir-1604c-source-review";
import { BirReviewBodyError, readBirReviewBody } from "@/lib/bir-1604c-review-request";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const disabled = () => Response.json({
  code: "BIR_DAT_CANDIDATE_DISABLED",
  error: "BIR 1604-C reviewed DAT candidate is disabled by default.",
}, { status: 404, headers: PRIVATE });

type CandidateRequest = Bir1604cReviewedPayload & {
  organizationId: number;
  legalEntityId: number;
  mode: "template" | "check" | "download";
};
function parseRequest(raw: unknown): CandidateRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(value.organizationId) || Number(value.organizationId) <= 0 ||
      !Number.isSafeInteger(value.legalEntityId) || Number(value.legalEntityId) <= 0 ||
      !Number.isSafeInteger(value.taxYear) || Number(value.taxYear) < 2018 || Number(value.taxYear) > 2100 ||
      !Array.isArray(value.records) || value.records.length > 500 ||
      typeof value.sourceDigest !== "string" ||
      (value.mode !== "check" && value.mode !== "download" && value.mode !== "template")) return null;
  return value as CandidateRequest;
}

/**
 * Controlled draft candidate ONLY. No BIR submissions, accepted-filing rows,
 * payments or annualization updates occur in this endpoint.
 */
export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: PRIVATE });
  if (process.env.BIR_1604C_DAT_CANDIDATE_ENABLED !== "true") return disabled();
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  let raw: unknown;
  try {
    raw = await readBirReviewBody(request);
  } catch (error) {
    if (error instanceof BirReviewBodyError) {
      return Response.json({ error: error.message, code: error.code }, {
        status: error.status, headers: PRIVATE,
      });
    }
    return Response.json({ error: "Could not read reviewed source." }, { status: 400, headers: PRIVATE });
  }
  const body = parseRequest(raw);
  if (!body) return Response.json({
    code: "INVALID_REVIEW",
    error: "Choose a legal employer/year and supply up to 500 independently reviewed employee records plus the current source digest.",
  }, { status: 400, headers: PRIVATE });

  const denied = await assertOrganizationRole(
    user.id, body.organizationId, PAYROLL_OPERATOR_ROLES,
    "Only company-wide payroll operators can prepare the reviewed BIR candidate.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, body.organizationId);
  if (!access?.companyWide) return Response.json({
    error: "Annual BIR candidate requires company-wide payroll access.",
  }, { status: 403, headers: PRIVATE });
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "bir-1604c-candidate-" + body.mode,
    resourceId: String(body.organizationId) + ":" + String(body.legalEntityId),
    limit: 8, windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const source = await loadBirAnnualEmployerSource(
    body.organizationId, body.legalEntityId, body.taxYear,
  );
  if (!source) return Response.json({
    error: "Selected legal employer is missing or is outside this workspace.",
  }, { status: 404, headers: PRIVATE });
  if (body.mode === "template") {
    if (body.sourceDigest !== source.reconciliation.sourceDigest)
      return Response.json({
        code: "STALE_SOURCE", error: "Payroll or employee identity changed; reconcile before downloading a new review template.",
      }, { status: 409, headers: PRIVATE });
    const template = buildBir1604cReviewTemplate(source, body.taxYear);
    if (!template) return Response.json({
      code: "INCOMPLETE_POPULATION",
      error: "The selected employer has no uniquely attributable released-payroll population.",
    }, { status: 409, headers: PRIVATE });
    const file = JSON.stringify(template, null, 2) + "\n";
    const templateSha256 = createHash("sha256").update(file, "utf8").digest("hex");
    await recordAuditEvent({
      organizationId: body.organizationId, actor: "user:" + user.id,
      action: "bir1604c.review-template.downloaded",
      resource: "legal-entity:" + body.legalEntityId + ":year:" + body.taxYear,
      metadata: {
        sourceDigest: source.reconciliation.sourceDigest,
        templateSha256, employeeCount: template.records.length,
        status: "DRAFT-REVIEW-REQUIRED",
      },
    });
    return new Response(file, { headers: {
      ...PRIVATE, "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="BIR-1604C-REVIEW-' +
        body.taxYear + '-EMPLOYER-' + body.legalEntityId + '.json"',
    } });
  }

  const review = bindBir1604cReviewToEmployer(body, source, body.legalEntityId);
  if (!review.ok) return Response.json({
    code: "BIR_REVIEW_BLOCKED", issues: review.issues,
    validatedAgainstModuleV70: "not run",
    error: "BIR reviewed-source checks failed. Correct each named employee/field and reconcile again.",
  }, { status: 422, headers: PRIVATE });
  let candidate;
  try {
    const result = buildReviewedBir1604cCandidate(review.input, true);
    if (!result.ok) return Response.json({
      code: "BIR_CANDIDATE_BLOCKED", issues: result.issues,
      error: "Reviewed BIR source is not ready for candidate generation.",
    }, { status: 422, headers: PRIVATE });
    candidate = result.candidate;
  } catch {
    // Never serialize raw employee rows or TINs in an error.
    return Response.json({
      code: "BIR_CANDIDATE_SERIALIZATION",
      error: "DAT serialization failed. Review the BIR widths, totals and source data.",
    }, { status: 422, headers: PRIVATE });
  }
  const sha256 = createHash("sha256").update(candidate.content, "ascii").digest("hex");
  if (body.mode === "check") return Response.json({
    status: "DRAFT-UNVALIDATED", validatedAgainstModuleV70: "not run",
    sourceDigest: source.reconciliation.sourceDigest,
    fileSha256: sha256, fileName: candidate.officialNameConvention,
    recordCount: candidate.recordCount,
    message: "Local checks only. Official BIR ADES desktop-module validation has not been run.",
  }, { headers: PRIVATE });

  // Audit only minimal non-PII provenance BEFORE releasing exact DAT bytes.
  await recordAuditEvent({
    organizationId: body.organizationId,
    actor: "user:" + user.id,
    action: "bir1604c.candidate.downloaded",
    resource: "legal-entity:" + body.legalEntityId + ":year:" + body.taxYear,
    metadata: {
      fileSha256: sha256, sourceDigest: source.reconciliation.sourceDigest,
      taxYear: body.taxYear, legalEntityId: body.legalEntityId,
      employeeCount: candidate.recordCount, validator: "not run",
      releaseFlag: "BIR_1604C_DAT_CANDIDATE_ENABLED",
    },
  });
  return new Response(candidate.content, {
    headers: {
      ...PRIVATE,
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="' + candidate.officialNameConvention + '"',
      "X-BIR-File-SHA256": sha256,
      "X-BIR-Source-Digest": source.reconciliation.sourceDigest,
      "X-BIR-Module-v7-0": "not-run",
      "X-BIR-Candidate-Status": "DRAFT-UNVALIDATED",
    },
  });
}
