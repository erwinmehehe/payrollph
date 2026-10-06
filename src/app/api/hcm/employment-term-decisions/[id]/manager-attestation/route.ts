import { getAccess, assertOrganizationRole, PEOPLE_ADMIN_ROLES, roleAllowed, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  createDecisionManagerAttestation,
  listDecisionManagerAttestations,
  loadDecisionManagerContext,
  MANAGER_ATTESTATION_RECOMMENDATIONS,
} from "@/lib/hcm-manager-attestation";
import { recordEmploymentDecisionEvidenceEvent } from "@/lib/hcm-employment-decision-evidence";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function attestationAccess(
  user: Awaited<ReturnType<typeof getSessionUser>>,
  organizationId: number,
  decisionId: number,
) {
  if (!user) return { error: Response.json({ error: "Authentication required." }, { status: 401 }) };

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to access employment decision manager attestations.",
  );
  if (denied) return { error: denied };

  const access = await getAccess(user.id, organizationId);
  if (!access) return { error: Response.json({ error: "Workspace access required." }, { status: 403 }) };

  const managerContext = await loadDecisionManagerContext({ organizationId, decisionId });
  if (!managerContext) return { error: Response.json({ error: "Employment-term decision not found." }, { status: 404 }) };

  const companyPeopleAdmin = access.companyWide && roleAllowed(access.role, PEOPLE_ADMIN_ROLES);
  const currentManager = Boolean(
    user.employeeId
    && managerContext.assignment?.managerEmployeeId === user.employeeId,
  );

  if (!companyPeopleAdmin && !currentManager) {
    return {
      error: Response.json({
        error: "Manager attestations are limited to company-wide People administrators for review and the worker's current manager for submission.",
      }, { status: 403 }),
    };
  }

  return { access, managerContext, companyPeopleAdmin, currentManager };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { id } = await context.params;
  const decisionId = Number(id);
  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(decisionId) || !Number.isInteger(organizationId)) {
    return Response.json({ error: "Valid decision id and organizationId are required." }, { status: 400 });
  }

  const gate = await attestationAccess(user, organizationId, decisionId);
  if ("error" in gate) return gate.error;

  const attestations = await listDecisionManagerAttestations({ organizationId, decisionId });
  return Response.json({
    attestations,
    canAttest: gate.currentManager && gate.managerContext.decision.status === "pending_approval",
    currentManager: gate.managerContext.manager
      ? {
          employeeId: gate.managerContext.manager.id,
          employeeNo: gate.managerContext.manager.employeeNo,
          name: `${gate.managerContext.manager.firstName} ${gate.managerContext.manager.lastName}`,
          title: gate.managerContext.manager.title,
        }
      : null,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { id } = await context.params;
  const decisionId = Number(id);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const recommendation = String(body.recommendation ?? "").trim().toLowerCase();
  const statement = String(body.statement ?? "").trim().slice(0, 4000);

  if (
    !Number.isInteger(decisionId)
    || !Number.isInteger(organizationId)
    || !MANAGER_ATTESTATION_RECOMMENDATIONS.includes(recommendation as any)
    || statement.length < 20
  ) {
    return Response.json({
      error: "Valid organizationId, recommendation, and a manager statement of at least 20 characters are required.",
    }, { status: 400 });
  }

  const gate = await attestationAccess(user, organizationId, decisionId);
  if ("error" in gate) return gate.error;
  if (!gate.currentManager || !user.employeeId) {
    return Response.json({
      error: "Only the worker's current manager can submit a manager attestation.",
    }, { status: 403 });
  }
  if (gate.managerContext.decision.status !== "pending_approval") {
    return Response.json({
      error: "Manager attestations are sealed once the employment decision leaves pending approval.",
    }, { status: 409 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "hcm-employment-decision-manager-attestation",
    resourceId: decisionId,
    limit: 12,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  try {
    const attestation = await createDecisionManagerAttestation({
      organizationId,
      decisionId,
      managerUserId: user.id,
      managerEmployeeId: user.employeeId,
      managerName: user.name,
      recommendation: recommendation as any,
      statement,
    });

    await recordEmploymentDecisionEvidenceEvent({
      organizationId,
      decisionId,
      employeeId: gate.managerContext.decision.employeeId,
      eventType: "manager_attested",
      actor: user.name,
      actorUserId: user.id,
      metadata: {
        managerAttestationId: attestation.id,
        managerEmployeeId: attestation.managerEmployeeId,
        workerPositionAssignmentId: attestation.workerPositionAssignmentId,
        workerPositionId: attestation.workerPositionId,
        recommendation: attestation.recommendation,
      },
      createdAt: attestation.createdAt,
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employment decision manager attestation submitted",
      resource: `Decision #${decisionId}`,
      metadata: {
        employeeId: gate.managerContext.decision.employeeId,
        managerAttestationId: attestation.id,
        recommendation: attestation.recommendation,
        workerPositionAssignmentId: attestation.workerPositionAssignmentId,
      },
    });

    return Response.json({ attestation }, { status: 201 });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Manager attestation could not be submitted.",
    }, { status: 409 });
  }
}
