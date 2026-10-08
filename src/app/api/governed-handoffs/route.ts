import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalChainPolicies } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_PAYROLL_ROLES,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { createApprovalFromConfiguredChain } from "@/lib/approval-chains";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  frozenGovernedHandoffEvidence,
  governedHandoffSourceKey,
  isGovernedHandoffType,
  latestGovernedHandoffForSource,
  loadGovernedHandoffSource,
  type GovernedHandoffEvidence,
  type GovernedHandoffType,
} from "@/lib/governed-approval-handoffs";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const positive = (value: unknown) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

async function authorizeHandoff(
  userId: number,
  organizationId: number,
  sourceType: GovernedHandoffType,
) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    sourceType === "wfm_roster_claim_review" ? WORKFORCE_MANAGER_ROLES : PEOPLE_PAYROLL_ROLES,
    "Only workforce managers or People/payroll administrators may route their corresponding review handoffs.",
  );
  if (denied) return { denied, access: null };
  const access = await getAccess(userId, organizationId);
  if (!access) {
    return {
      denied: Response.json({ error: "Workspace access not found." }, { status: 403 }),
      access: null,
    };
  }
  return { denied: null, access };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const organizationId = positive(params.get("organizationId"));
  const sourceType = params.get("sourceType");
  if (!organizationId || !isGovernedHandoffType(sourceType)) {
    return Response.json({ error: "Valid organizationId and governed sourceType are required." }, { status: 400 });
  }
  const auth = await authorizeHandoff(user.id, organizationId, sourceType);
  if (auth.denied) return auth.denied;

  const policies = await db.select({
    code: approvalChainPolicies.code,
    name: approvalChainPolicies.name,
    version: approvalChainPolicies.version,
  }).from(approvalChainPolicies).where(and(
    eq(approvalChainPolicies.organizationId, organizationId),
    eq(approvalChainPolicies.purpose, "automation"),
    eq(approvalChainPolicies.active, true),
  )).orderBy(approvalChainPolicies.name);

  const rawIds = String(params.get("sourceIds") ?? "").trim();
  if (!rawIds) {
    return Response.json({
      approvalChains: policies,
      handoffs: [],
      boundary: "These reviews do not execute roster assignments, separation clearance, final-pay approval or release.",
    });
  }
  const ids = [...new Set(rawIds.split(",").map(positive))];
  if (ids.length < 1 || ids.length > 40 || ids.some((id) => id == null)) {
    return Response.json({ error: "Provide 1 to 40 positive source IDs." }, { status: 400 });
  }

  const handoffs = await Promise.all((ids as number[]).map(async (sourceId) => {
    const source = await loadGovernedHandoffSource({ organizationId, sourceType, sourceId });
    if (!source) return null;
    const scope = assertScope(auth.access!, source.orgUnitId);
    if (!scope.ok) return null;

    const latest = await latestGovernedHandoffForSource({ organizationId, sourceType, sourceId });
    const evidence = latest ? frozenGovernedHandoffEvidence(latest.routingSnapshot) : null;
    const sourceCurrent = Boolean(latest && evidence
      && evidence.sourceType === sourceType
      && evidence.sourceId === sourceId
      && evidence.employeeId === source.employeeId
      && evidence.sourceHash === source.sourceHash
      && latest.sourceKey === governedHandoffSourceKey(sourceId, source.sourceHash));
    return {
      sourceId,
      eligible: source.eligible,
      sourceStatus: source.status,
      currentSourceHash: source.sourceHash,
      approval: latest ? {
        id: latest.id,
        status: latest.status,
        policyCode: latest.policyCode,
        policyVersion: latest.policyVersion,
        sourceCurrent,
        sourceChanged: !sourceCurrent,
      } : null,
    };
  }));

  return Response.json({
    approvalChains: policies,
    handoffs: handoffs.filter((item) => item != null),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Governed WFM/HCM approval handoff");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = positive(body.organizationId);
  const sourceId = positive(body.sourceId);
  const sourceType = body.sourceType;
  const chainCode = String(body.chainCode ?? "").trim();

  if (!organizationId || !sourceId || !isGovernedHandoffType(sourceType) || !/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/.test(chainCode)) {
    return Response.json({
      error: "organizationId, sourceId, sourceType and an active configured approval chain code are required.",
    }, { status: 400 });
  }

  const auth = await authorizeHandoff(user.id, organizationId, sourceType);
  if (auth.denied) return auth.denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "governed-wfm-hcm-approval-handoff",
    resourceId: organizationId,
    limit: 12,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [policy] = await db.select().from(approvalChainPolicies).where(and(
    eq(approvalChainPolicies.organizationId, organizationId),
    eq(approvalChainPolicies.code, chainCode),
    eq(approvalChainPolicies.purpose, "automation"),
    eq(approvalChainPolicies.active, true),
  )).limit(1);
  if (!policy) {
    return Response.json({
      error: "Choose an active Automation Studio approval policy. Workforce-plan or other-purpose policies cannot be repurposed.",
    }, { status: 409 });
  }

  const source = await loadGovernedHandoffSource({ organizationId, sourceId, sourceType });
  if (!source) return Response.json({ error: "Authoritative source not found in this organization." }, { status: 404 });
  const scope = assertScope(auth.access!, source.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  if (!source.eligible) {
    return Response.json({
      error: "Only a pending active roster claim or a draft separation package may start this approval handoff.",
    }, { status: 409 });
  }

  const sourceEvidence: GovernedHandoffEvidence = {
    version: "governed-source-handoff-v1",
    sourceType,
    sourceId,
    sourceHash: source.sourceHash,
    initiatedByUserId: user.id,
    employeeId: source.employeeId,
    orgUnitId: source.orgUnitId,
  };
  const sourceKey = governedHandoffSourceKey(sourceId, source.sourceHash);

  try {
    const routed = await createApprovalFromConfiguredChain({
      organizationId,
      chainCode,
      sourceType,
      sourceKey,
      sourceEvidence,
      title: sourceType === "wfm_roster_claim_review"
        ? `Human roster review: claim #${sourceId}`
        : `Human separation readiness review: package #${sourceId}`,
      detail: sourceType === "wfm_roster_claim_review"
        ? "Approve the source-bound review only; WFM manager must still recheck eligibility and decide the claim separately."
        : "Review source-bound separation readiness; departmental clearance and final-pay approval/release remain separate human actions.",
      fallbackApprover: sourceType === "wfm_roster_claim_review" ? "Workforce Manager" : "People Operations",
      dueLabel: "Human source-bound review required",
      priority: "High",
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Governed WFM/HCM human approval handoff requested",
      resource: source.label,
      metadata: {
        sourceType,
        sourceId,
        sourceHash: source.sourceHash,
        approvalChainId: routed.chainInstance?.id ?? null,
        approvalPolicyCode: chainCode,
        initiatedByUserId: sourceEvidence.initiatedByUserId,
        sourceMutation: false,
        payrollOrRosterMutation: false,
      },
    });
    return Response.json({
      approval: {
        id: routed.chainInstance?.id,
        status: routed.chainInstance?.status,
        policyCode: chainCode,
        sourceHash: source.sourceHash,
        taskId: routed.task.id,
      },
      boundary: "This is a human review request only. No claim, schedule, clearance, payroll approval or money movement was changed.",
    }, { status: 201 });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to route the governed approval handoff.",
    }, { status: 409 });
  }
}
