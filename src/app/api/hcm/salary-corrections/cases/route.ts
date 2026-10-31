import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { salaryCorrectionCases } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES,
  PAYROLL_TAX_APPROVER_ROLES, PAYROLL_VIEW_ROLES,
} from "@/lib/access";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { assertEntityResource, resolveMultiEntityContext } from "@/lib/multi-entity-server";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  cancelCorrectionCase, createCorrectionCase, decideCaseRun, listCorrectionCases, parseCaseInput,
  refreshCaseRuns, reviewCorrectionCase, SalaryCorrectionCaseError, submitCorrectionCase,
} from "@/lib/hcm-salary-correction-cases";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * #641 governed backdated salary correction cases. Records and reconciles a
 * correction; never computes, posts or releases money. Each affected Released
 * run is settled only through a linked, independently reviewed underpayment
 * request (/api/payroll-underpayments) or an explicit "no shortfall" decision.
 */
function disabled() {
  return !criticalReleaseFlagEnabled("hcmSalaryCorrectionCases");
}

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_INPUT: 400,
  CASE_NOT_FOUND: 404, CASE_RUN_NOT_FOUND: 404, EMPLOYEE_NOT_FOUND: 404, REQUEST_NOT_FOUND: 404,
  EFFECTIVE_DATE_NOT_PAST: 400, PRIOR_TAX_YEAR: 409, BEFORE_EMPLOYMENT_START: 400,
  NOT_CASE_MAKER: 403, SELF_REVIEW: 403,
};

function caseError(error: unknown) {
  if (!(error instanceof SalaryCorrectionCaseError)) throw error;
  return Response.json({ code: error.code, error: error.message }, { status: STATUS_BY_CODE[error.code] ?? 409, headers: NO_STORE });
}

function validId(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function GET(request: Request) {
  if (disabled()) return Response.json({ error: "Not found." }, { status: 404 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = validId(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId) return Response.json({ error: "Valid organizationId is required." }, { status: 400 });
  const denied = await assertOrganizationRole(user.id, organizationId, PAYROLL_VIEW_ROLES,
    "Only payroll personnel can view salary correction cases.");
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide payroll evidence access required." }, { status: 403 });
  const entityScope = await resolveMultiEntityContext({
    userId: user.id, organizationId, request,
    requested: new URL(request.url).searchParams.get("legalEntityId"),
  });
  if (!entityScope.ok) return entityScope.response;
  if (entityScope.context.enabled && (entityScope.context.group || entityScope.context.legalEntityId === null)) {
    return Response.json({ error: "Select an authorized legal employer to view salary correction cases." }, { status: 403, headers: NO_STORE });
  }
  return Response.json({
    currentUserId: user.id,
    cases: await listCorrectionCases(organizationId, entityScope.context.enabled ? entityScope.context.legalEntityId : null),
  }, { headers: NO_STORE });
}

async function guardMutation(request: Request, organizationId: number, roles: Parameters<typeof assertOrganizationRole>[2], action: string) {
  const user = await getSessionUser();
  if (!user) return { response: Response.json({ error: "Authentication required." }, { status: 401 }) };
  const demoDenied = publicDemoMutationDenied(user.email, "Salary correction case");
  if (demoDenied) return { response: demoDenied };
  const denied = await assertOrganizationRole(user.id, organizationId, roles);
  if (denied) return { response: denied };
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return { response: Response.json({ error: "Company-wide payroll access is required." }, { status: 403 }) };
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return { response: mfaDenied };
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action, resourceId: organizationId, limit: 20, windowMs: 15 * 60_000,
  });
  if (rateDenied) return { response: rateDenied };
  return { actor: { id: user.id, name: user.name } };
}

export async function POST(request: Request) {
  if (disabled()) return Response.json({ error: "Not found." }, { status: 404 });
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const body: unknown = await request.json().catch(() => null);
  let input;
  try { input = parseCaseInput(body); } catch (error) { return caseError(error); }
  const guard = await guardMutation(request, input.organizationId, PAYROLL_OPERATOR_ROLES, "hcm-salary-correction-case");
  if (guard.response) return guard.response;
  // Organization access alone is insufficient in a multi-legal-employer
  // company. The worker itself is rechecked in the case transaction.
  const entityScope = await resolveMultiEntityContext({
    userId: guard.actor.id, organizationId: input.organizationId, request, requested: input.legalEntityId,
  });
  if (!entityScope.ok) return entityScope.response;
  if (entityScope.context.enabled && entityScope.context.group) {
    return Response.json({ error: "Select a legal employer to open a salary correction case." }, { status: 403, headers: NO_STORE });
  }
  const entityDenied = assertEntityResource(entityScope.context, input.legalEntityId);
  if (entityDenied) return entityDenied;
  try {
    const result = await createCorrectionCase(input, guard.actor);
    return Response.json(result, { status: result.replayed ? 200 : 201, headers: NO_STORE });
  } catch (error) { return caseError(error); }
}

const MAKER_ACTIONS = ["link_underpayment", "mark_no_shortfall", "clear_run", "refresh", "submit", "cancel"] as const;
const CHECKER_ACTIONS = ["approve", "reject"] as const;

export async function PATCH(request: Request) {
  if (disabled()) return Response.json({ error: "Not found." }, { status: 404 });
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const raw: unknown = await request.json().catch(() => null);
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const organizationId = validId(body.organizationId);
  const caseId = validId(body.caseId);
  const action = String(body.action ?? "");
  const isChecker = (CHECKER_ACTIONS as readonly string[]).includes(action);
  if (!organizationId || !caseId || (!isChecker && !(MAKER_ACTIONS as readonly string[]).includes(action))) {
    return Response.json({ error: "Valid organizationId, caseId and action are required." }, { status: 400 });
  }
  const guard = await guardMutation(request, organizationId,
    isChecker ? PAYROLL_TAX_APPROVER_ROLES : PAYROLL_OPERATOR_ROLES,
    isChecker ? "hcm-salary-correction-case-review" : "hcm-salary-correction-case");
  if (guard.response) return guard.response;
  const actor = guard.actor;
  if (body.legalEntityId !== undefined && body.legalEntityId !== null
    && typeof body.legalEntityId !== "string" && typeof body.legalEntityId !== "number") {
    return Response.json({ error: "Invalid legal employer selector." }, { status: 400, headers: NO_STORE });
  }
  // Reconcile client/header/query selectors before resolving the actual case
  // employer. Never trust a supplied legalEntityId as resource ownership.
  const entityScope = await resolveMultiEntityContext({
    userId: actor.id, organizationId, request, requested: body.legalEntityId as string | number | null | undefined,
  });
  if (!entityScope.ok) return entityScope.response;
  if (entityScope.context.enabled && (entityScope.context.group || entityScope.context.legalEntityId === null)) {
    return Response.json({ error: "Select an authorized legal employer to change salary correction cases." }, { status: 403, headers: NO_STORE });
  }
  const [caseEmployer] = await db.select({ legalEntityId: salaryCorrectionCases.legalEntityId })
    .from(salaryCorrectionCases)
    .where(and(eq(salaryCorrectionCases.organizationId, organizationId), eq(salaryCorrectionCases.id, caseId)))
    .limit(1);
  if (!caseEmployer) return Response.json({ error: "Correction case not found." }, { status: 404, headers: NO_STORE });
  const entityDenied = assertEntityResource(entityScope.context, caseEmployer.legalEntityId);
  if (entityDenied) return entityDenied;
  const text = (key: string) => (typeof body[key] === "string" ? body[key] as string : "");
  try {
    switch (action) {
      case "link_underpayment": {
        const runId = validId(body.caseRunId);
        const underpaymentRequestId = validId(body.underpaymentRequestId);
        if (!runId || !underpaymentRequestId) return Response.json({ error: "caseRunId and underpaymentRequestId are required." }, { status: 400 });
        return Response.json({ run: await decideCaseRun(organizationId, caseId, { kind: "link", runId, underpaymentRequestId }, actor) }, { headers: NO_STORE });
      }
      case "mark_no_shortfall": {
        const runId = validId(body.caseRunId);
        if (!runId) return Response.json({ error: "caseRunId is required." }, { status: 400 });
        return Response.json({ run: await decideCaseRun(organizationId, caseId, { kind: "no_shortfall", runId, reason: text("reason") }, actor) }, { headers: NO_STORE });
      }
      case "clear_run": {
        const runId = validId(body.caseRunId);
        if (!runId) return Response.json({ error: "caseRunId is required." }, { status: 400 });
        return Response.json({ run: await decideCaseRun(organizationId, caseId, { kind: "clear", runId }, actor) }, { headers: NO_STORE });
      }
      case "refresh":
        return Response.json(await refreshCaseRuns(organizationId, caseId, actor), { headers: NO_STORE });
      case "submit":
        return Response.json({ case: await submitCorrectionCase(organizationId, caseId, body.declaredTotal, actor) }, { headers: NO_STORE });
      case "cancel":
        return Response.json({ case: await cancelCorrectionCase(organizationId, caseId, text("reason"), actor) }, { headers: NO_STORE });
      default:
        return Response.json({
          case: await reviewCorrectionCase(organizationId, caseId, action as "approve" | "reject", text("reviewReason"), actor),
          notice: action === "approve"
            ? "Case approved as complete and reconciled. No money moved: each linked underpayment request still posts only through its own independent review."
            : "Returned to the maker for changes.",
        }, { headers: NO_STORE });
    }
  } catch (error) { return caseError(error); }
}
