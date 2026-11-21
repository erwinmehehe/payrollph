import { pool } from "@/db";
import { assertOrganizationRole, assertOrganizationUnitAccess, getAccess, PAYROLL_OPERATOR_ROLES, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";
import { findPayrollRunForMember } from "@/lib/payroll-run-membership";
import { requireRunEmployer } from "@/lib/multi-entity-run-guard";
import {
  buildHrOperationsBrief, buildPayrollOperationsBrief,
  operationsCopilotAiAllowed, operationsCopilotEnabled,
  type CopilotBrief, type HrCaseSource,
} from "@/lib/operations-copilot";
import { narrateOperationsBrief } from "@/lib/operations-copilot-ai";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" };
type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
type Authorized = { user: SessionUser; brief: CopilotBrief };
const validId = (raw: string | null) => {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
};

async function authorizedBrief(request: Request): Promise<Authorized | Response> {
  const params = new URL(request.url).searchParams;
  if (["area", "organizationId", "runId", "legalEntityId"].some(key => params.getAll(key).length > 1)) {
    return Response.json({ error: "Duplicate selectors are not allowed." }, { status: 400, headers: privateHeaders });
  }
  const area = params.get("area");
  const organizationId = validId(params.get("organizationId"));
  if (!organizationId || !["hr", "payroll"].includes(area ?? "")) {
    return Response.json({ error: "Valid area and organizationId required." }, { status: 400, headers: privateHeaders });
  }
  if (!operationsCopilotEnabled(organizationId)) {
    return Response.json({ error: "Not found." }, { status: 404, headers: privateHeaders });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: privateHeaders });

  if (area === "hr") {
    if (params.has("runId") || params.has("legalEntityId")) {
      return Response.json({ error: "HR review does not accept payroll selectors." }, { status: 400, headers: privateHeaders });
    }
    const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
    if (denied) return denied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) {
      return Response.json({ error: "Company-wide People access is required." }, { status: 403, headers: privateHeaders });
    }

    // One bounded source read. Window counts cover ALL open/acknowledged cases,
    // not just the 31 candidates returned for the 30-row preview.
    const query = [
      'SELECT id, organization_id AS "organizationId", case_type AS "caseType", status,',
      'assigned_owner_user_id AS "ownerUserId", sla_due_at AS "dueAt",',
      '(sla_due_at IS NOT NULL AND sla_due_at < now()) AS overdue,',
      'count(*) OVER ()::integer AS "totalOpen",',
      'sum(CASE WHEN sla_due_at < now() THEN 1 ELSE 0 END) OVER ()::integer AS "overdueCount",',
      'sum(CASE WHEN assigned_owner_user_id IS NULL THEN 1 ELSE 0 END) OVER ()::integer AS "unassignedCount"',
      'FROM automation_operational_cases',
      "WHERE organization_id = $1 AND status IN ('open', 'acknowledged')",
      "ORDER BY (sla_due_at < now()) DESC NULLS LAST,",
      "  (assigned_owner_user_id IS NULL) DESC, sla_due_at ASC NULLS LAST, created_at ASC, id ASC",
      "LIMIT 31",
    ].join(" ");
    const result = await pool.query(query, [organizationId]);
    const rows = result.rows;
    const mapped: HrCaseSource[] = rows.map(row => ({
      id: Number(row.id),
      organizationId: Number(row.organizationId),
      caseType: String(row.caseType ?? ""),
      status: String(row.status ?? ""),
      ownerUserId: row.ownerUserId === null ? null : Number(row.ownerUserId),
      dueAt: row.dueAt === null ? null : new Date(row.dueAt).toISOString(),
      overdue: row.overdue === true,
    }));
    const first = rows[0];
    const brief = buildHrOperationsBrief({
      organizationId,
      cases: mapped,
      totals: first
        ? {
          totalOpen: Number(first.totalOpen),
          overdue: Number(first.overdueCount),
          unassigned: Number(first.unassignedCount),
        }
        : { totalOpen: 0, overdue: 0, unassigned: 0 },
    });
    return { user, brief };
  }

  const runId = validId(params.get("runId"));
  if (!runId) return Response.json({ error: "Valid runId is required." }, { status: 400, headers: privateHeaders });
  const run = await findPayrollRunForMember(user.id, runId);
  if (!run || run.organizationId !== organizationId) {
    return Response.json({ error: "Payroll run not found." }, { status: 404, headers: privateHeaders });
  }
  const denied = await assertOrganizationRole(user.id, run.organizationId, PAYROLL_OPERATOR_ROLES);
  if (denied) return denied;
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id, run.organizationId, run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;
  const employerDenied = await requireRunEmployer({
    request, userId: user.id, organizationId: run.organizationId, legalEntityId: run.legalEntityId,
  });
  if (employerDenied) return employerDenied;
  const source = await buildPayrollAssurance(runId);
  if (!source || source.run.organizationId !== run.organizationId || source.run.legalEntityId !== run.legalEntityId) {
    return Response.json({ error: "Payroll run not found." }, { status: 404, headers: privateHeaders });
  }
  const brief = buildPayrollOperationsBrief({
    organizationId: run.organizationId, runId, findings: source.assurance.findings,
  });
  return { user, brief };
}

export async function GET(request: Request) {
  try {
    const authorized = await authorizedBrief(request);
    if (authorized instanceof Response) return authorized;
    return Response.json({
      brief: authorized.brief,
      aiAvailable: operationsCopilotAiAllowed(authorized.brief.organizationId),
    }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: "Operations source is unavailable. No results can be verified." }, {
      status: 503, headers: privateHeaders,
    });
  }
}

/** POST is strictly for optional narration: it cannot create or change records. */
export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  try {
    const authorized = await authorizedBrief(request);
    if (authorized instanceof Response) return authorized;
    if (!operationsCopilotAiAllowed(authorized.brief.organizationId)) {
      return Response.json({ error: "External narration requires approved tenant privacy consent and an enabled model." }, {
        status: 403, headers: privateHeaders,
      });
    }
    const mfaDenied = requireSensitiveActionMfa(authorized.user);
    if (mfaDenied) return mfaDenied;
    const limited = await enforceSensitiveActionRateLimit(request, {
      userId: authorized.user.id,
      action: "operations-copilot-narration",
      resourceId: authorized.brief.organizationId,
      limit: 5,
      windowMs: 5 * 60_000,
    });
    if (limited) return limited;
    const narration = await narrateOperationsBrief(authorized.brief);
    return Response.json({ narration }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: "Narration unavailable. Source evidence has not been changed." }, {
      status: 503, headers: privateHeaders,
    });
  }
}
