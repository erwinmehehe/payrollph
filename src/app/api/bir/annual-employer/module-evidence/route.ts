import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { assertBirAnnualEntityAccess } from "@/lib/bir-annual-entity-access";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { loadBirAnnualEmployerSource } from "@/lib/bir-annual-employer-source";
import {
  birCandidateDownloadExists, birModuleEvidenceStatus,
  validateBirModuleObservation, type BirModuleAudit,
} from "@/lib/bir-1604c-module-evidence";
import { BirReviewBodyError, readBirReviewBody } from "@/lib/bir-1604c-review-request";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const ACTIONS = [
  "bir1604c.candidate.downloaded",
  "bir1604c.validator.observed",
  "bir1604c.validator.reviewed",
] as const;
type Scope = { organizationId: number; legalEntityId: number; taxYear: number };
function parseScope(value: Record<string, unknown>): Scope | null {
  const organizationId = Number(value.organizationId);
  const legalEntityId = Number(value.legalEntityId);
  const taxYear = Number(value.taxYear);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(legalEntityId) || legalEntityId <= 0 ||
      !Number.isSafeInteger(taxYear) || taxYear < 2018 || taxYear > 2100) return null;
  return { organizationId, legalEntityId, taxYear };
}
function resource(scope: Scope) {
  return "legal-entity:" + scope.legalEntityId + ":year:" + scope.taxYear;
}
async function authorize(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId, organizationId, PAYROLL_OPERATOR_ROLES,
    "Only company-wide payroll operators can access BIR module evidence.",
  );
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  return access?.companyWide ? null : Response.json({
    error: "BIR validation evidence is company-wide payroll information.",
  }, { status: 403, headers: PRIVATE });
}
async function loadAudits(scope: Scope): Promise<BirModuleAudit[]> {
  return db.select({
    id: auditEvents.id,
    actor: auditEvents.actor,
    action: auditEvents.action,
    metadata: auditEvents.metadata,
  }).from(auditEvents).where(and(
    eq(auditEvents.organizationId, scope.organizationId),
    eq(auditEvents.resource, resource(scope)),
    inArray(auditEvents.action, [...ACTIONS]),
  )).orderBy(desc(auditEvents.id)).limit(300);
}

export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("bir1604cReviewedCandidate")) return Response.json({ error: "BIR module evidence is unavailable." }, { status: 404, headers: PRIVATE });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: PRIVATE });
  const search = new URL(request.url).searchParams;
  const scope = parseScope(Object.fromEntries(search.entries()));
  if (!scope) return Response.json({ error: "Select organization, legal employer and tax year." }, {
    status: 400, headers: PRIVATE,
  });
  const denied = await authorize(user.id, scope.organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const entityDenied = await assertBirAnnualEntityAccess(user.id, scope.organizationId, scope.legalEntityId, request);
  if (entityDenied) return entityDenied;
  const source = await loadBirAnnualEmployerSource(scope.organizationId, scope.legalEntityId, scope.taxYear);
  if (!source) return Response.json({ error: "Legal employer not found." }, { status: 404, headers: PRIVATE });
  const audits = await loadAudits(scope);
  return Response.json({
    organizationId: scope.organizationId,
    legalEntityId: scope.legalEntityId,
    taxYear: scope.taxYear,
    moduleV70: birModuleEvidenceStatus(audits, source.reconciliation.sourceDigest, "7.0"),
    moduleV74: birModuleEvidenceStatus(audits, source.reconciliation.sourceDigest, "7.4"),
    sourceDigest: source.reconciliation.sourceDigest,
    agencyAccepted: false,
  }, { headers: PRIVATE });
}

/** Record an operator observation, then a DIFFERENT payroll operator confirms it. */
export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  if (!criticalReleaseFlagEnabled("bir1604cReviewedCandidate")) return Response.json({ error: "BIR module evidence is unavailable." }, { status: 404, headers: PRIVATE });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: PRIVATE });
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  let raw: unknown;
  try {
    raw = await readBirReviewBody(request);
  } catch (error) {
    if (error instanceof BirReviewBodyError)
      return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE });
    return Response.json({ error: "Evidence request is invalid." }, { status: 400, headers: PRIVATE });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return Response.json({ error: "Evidence must be a JSON object." }, { status: 400, headers: PRIVATE });
  const body = raw as Record<string, unknown>;
  const scope = parseScope(body);
  if (!scope || (body.mode !== "observe" && body.mode !== "review")) {
    return Response.json({ error: "Choose legal employer/year and observe or review." }, {
      status: 400, headers: PRIVATE,
    });
  }
  const denied = await authorize(user.id, scope.organizationId);
  if (denied) return denied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "bir-1604c-evidence-" + body.mode,
    resourceId: resource(scope), limit: 8, windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;
  const entityDenied = await assertBirAnnualEntityAccess(user.id, scope.organizationId, scope.legalEntityId, request);
  if (entityDenied) return entityDenied;
  const source = await loadBirAnnualEmployerSource(scope.organizationId, scope.legalEntityId, scope.taxYear);
  if (!source) return Response.json({ error: "Legal employer not found." }, { status: 404, headers: PRIVATE });
  const audits = await loadAudits(scope);
  const currentDigest = source.reconciliation.sourceDigest;
  if (body.mode === "observe") {
    const observation = validateBirModuleObservation(body);
    if (!observation) return Response.json({
      code: "INVALID_MODULE_OBSERVATION",
      error: "Provide validator 7.x version, pass/fail, calendar date, exact input DAT SHA-256, source digest and private evidence reference.",
    }, { status: 400, headers: PRIVATE });
    if (observation.sourceDigest !== currentDigest ||
        !birCandidateDownloadExists(audits, currentDigest, observation.fileSha256)) {
      return Response.json({ code: "UNKNOWN_OR_STALE_DAT", error: "DAT is not a current audited candidate download for this legal employer/year." }, {
        status: 409, headers: PRIVATE,
      });
    }
    const saved = await recordAuditEvent({
      organizationId: scope.organizationId,
      actor: "user:" + user.id,
      action: "bir1604c.validator.observed",
      resource: resource(scope),
      metadata: observation,
    });
    return Response.json({
      observationId: saved?.id,
      status: "not run",
      message: "Observation recorded. A separate authorized reviewer must check the private BIR module screenshots/log and confirm or reject the result.",
    }, { headers: PRIVATE });
  }

  const observationId = Number(body.observationId);
  const decision = body.decision;
  const evidenceReference = body.evidenceReference;
  if (!Number.isSafeInteger(observationId) || observationId <= 0 ||
      (decision !== "confirmed" && decision !== "rejected") ||
      typeof evidenceReference !== "string" || evidenceReference.length < 8 ||
      evidenceReference.length > 160 || !/^[\x20-\x7e]+$/.test(evidenceReference)) {
    return Response.json({
      error: "Select an observation, confirm/reject and provide an independent private review evidence reference.",
    }, { status: 400, headers: PRIVATE });
  }
  const observed = audits.find(item => item.id === observationId && item.action === "bir1604c.validator.observed");
  const prior = observed && validateBirModuleObservation(observed.metadata);
  if (!observed || !prior || prior.sourceDigest !== currentDigest ||
      !birCandidateDownloadExists(audits, currentDigest, prior.fileSha256)) {
    return Response.json({ error: "Observation is not bound to the current reviewed DAT source." }, {
      status: 409, headers: PRIVATE,
    });
  }
  if (observed.actor === "user:" + user.id) {
    return Response.json({ error: "An independent payroll operator must review this observation." }, {
      status: 403, headers: PRIVATE,
    });
  }
  if (audits.some(item => item.action === "bir1604c.validator.reviewed" &&
      (item.metadata as Record<string, unknown>)?.observationId === observationId)) {
    return Response.json({ error: "This observation has already been reviewed and cannot be changed." }, {
      status: 409, headers: PRIVATE,
    });
  }
  const metadata = {
    observationId, fileSha256: prior.fileSha256, sourceDigest: currentDigest,
    decision, evidenceReference,
  };
  const saved = await recordAuditEvent({
    organizationId: scope.organizationId,
    actor: "user:" + user.id,
    action: "bir1604c.validator.reviewed",
    resource: resource(scope),
    metadata,
  });
  return Response.json({
    reviewId: saved?.id,
    ...birModuleEvidenceStatus([{ id: saved!.id, actor: "user:" + user.id,
      action: "bir1604c.validator.reviewed", metadata }, ...audits],
    currentDigest, prior.moduleVersion),
    agencyAccepted: false,
  }, { headers: PRIVATE });
}
