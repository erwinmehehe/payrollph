import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  treasuryControlPolicies,
  treasuryOperatorAssignments,
} from "@/db/schema";
import {
  assertMembership,
  assertOrganizationRole,
  getAccess,
  PAYROLL_DISBURSEMENT_ROLES,
  roleAllowed,
} from "@/lib/access";
import { roleGateAllowed } from "@/lib/permissions";

export const TREASURY_OPERATOR_ELIGIBLE_ROLES = ["owner", "admin", "bookkeeper"] as const;

export type TreasuryEvidence = {
  policyEnabled: boolean;
  policyEnabledAt: string | null;
  treasuryOperatorUserId: number;
  releasedByUserId: number | null;
  releaseActor: string | null;
  legacyReleaseEvidence: boolean;
};

export async function treasuryControlPolicy(organizationId: number) {
  const [policy] = await db.select().from(treasuryControlPolicies).where(
    eq(treasuryControlPolicies.organizationId, organizationId),
  ).limit(1);
  return policy ?? null;
}

export async function treasuryOperatorAssigned(organizationId: number, userId: number) {
  const [assignment] = await db.select().from(treasuryOperatorAssignments).where(and(
    eq(treasuryOperatorAssignments.organizationId, organizationId),
    eq(treasuryOperatorAssignments.userId, userId),
    eq(treasuryOperatorAssignments.active, true),
  )).limit(1);
  return Boolean(assignment);
}

export async function authorizeAssignedTreasuryOperator(input: {
  organizationId: number;
  userId: number;
}) {
  const policy = await treasuryControlPolicy(input.organizationId);
  if (!policy?.enabled) {
    return denied("Enterprise treasury separation must be enabled before treasury dual-control approvals can be used.", 409);
  }

  const access = await getAccess(input.userId, input.organizationId);
  if (!access || !access.companyWide) {
    return denied("Treasury operators must have company-wide workspace access.");
  }
  if (!roleAllowed(access.role, TREASURY_OPERATOR_ELIGIBLE_ROLES)) {
    return denied("This membership role is not eligible for enterprise treasury assignment.");
  }
  if (!await treasuryOperatorAssigned(input.organizationId, input.userId)) {
    return denied("This user is not an assigned treasury operator.");
  }

  const permission = await roleGateAllowed(input.userId, input.organizationId, "payroll.disburse");
  if (!permission.allowed) {
    return denied("Payroll disbursement permission is denied by the assigned permission set.");
  }

  return null;
}

async function releaseEvidence(organizationId: number, runId: number) {
  const events = await db.select().from(auditEvents)
    .where(and(
      eq(auditEvents.organizationId, organizationId),
      eq(auditEvents.action, "Payroll released"),
    ))
    .orderBy(desc(auditEvents.id));

  return events.find((event) => {
    if (!event.metadata || typeof event.metadata !== "object") return false;
    return Number((event.metadata as Record<string, unknown>).runId) === runId;
  }) ?? null;
}

function denied(error: string, status = 403) {
  return Response.json({ error }, { status });
}

export function treasuryReleaseSeparationError(input: {
  policyEnabledAt: Date | null;
  releaseCreatedAt: Date;
  releaseActor: string;
  releasedByUserId: number | null;
  userId: number;
  userName: string;
}) {
  if (input.releasedByUserId === input.userId) {
    return "Treasury separation: the user who released this payroll cannot also submit or confirm its payout.";
  }
  if (input.releasedByUserId == null) {
    const enabledAt = input.policyEnabledAt?.getTime() ?? 0;
    if (enabledAt > 0 && input.releaseCreatedAt.getTime() >= enabledAt) {
      return "Stable release-user evidence is missing for a payroll released after treasury separation was enabled.";
    }
    if (input.releaseActor.trim().toLowerCase() === input.userName.trim().toLowerCase()) {
      return "Treasury separation: legacy release evidence shows the same actor released this payroll.";
    }
  }
  return null;
}

type CheckerDecisionEvent = {
  id: number;
  action: string;
  actor: string;
  metadata: unknown;
};

/**
 * Always-on separation between the payroll checker and the releaser, independent
 * of the opt-in treasury policy. Legacy decisions without a stable decider id
 * fall back to the recorded actor name.
 */
export function checkerReleaseSeparationError(input: {
  events: CheckerDecisionEvent[];
  approvalTaskId: number;
  payrollRunId: number;
  userId: number;
  userName: string;
}) {
  const decision = input.events
    .filter((event) => {
      if (event.action !== "Approval approved" && event.action !== "Approval approved by delegate") return false;
      if (!event.metadata || typeof event.metadata !== "object") return false;
      const metadata = event.metadata as Record<string, unknown>;
      return Number(metadata.taskId) === input.approvalTaskId && Number(metadata.payrollRunId) === input.payrollRunId;
    })
    .sort((left, right) => right.id - left.id)[0];
  if (!decision) return null;

  const deciderUserId = Number((decision.metadata as Record<string, unknown>).deciderUserId);
  const sameUser = Number.isInteger(deciderUserId) && deciderUserId > 0
    ? deciderUserId === input.userId
    : decision.actor.trim().toLowerCase() === input.userName.trim().toLowerCase();
  return sameUser
    ? "Separation of duties: the checker who approved this payroll cannot also release it."
    : null;
}

/**
 * Enterprise treasury gate.
 *
 * When the opt-in policy is disabled, legacy owner-only payout behavior remains
 * unchanged. When enabled, an active stable-user treasury assignment replaces
 * the implicit owner grant. Custom permission sets remain deny-only overlays.
 */
export async function authorizeTreasuryOperation(input: {
  organizationId: number;
  runId: number;
  userId: number;
  userName: string;
  requireReleaseSeparation?: boolean;
  legacyAllowedRoles?: readonly string[];
}): Promise<{ response: Response | null; evidence: TreasuryEvidence | null }> {
  const policy = await treasuryControlPolicy(input.organizationId);

  if (!policy?.enabled) {
    const response = await assertOrganizationRole(
      input.userId,
      input.organizationId,
      input.legacyAllowedRoles ?? PAYROLL_DISBURSEMENT_ROLES,
      input.legacyAllowedRoles
        ? "Your current role cannot perform this treasury operation."
        : "Only the workspace owner can perform payroll treasury operations until enterprise treasury separation is enabled.",
    );
    return {
      response,
      evidence: response ? null : {
        policyEnabled: false,
        policyEnabledAt: null,
        treasuryOperatorUserId: input.userId,
        releasedByUserId: null,
        releaseActor: null,
        legacyReleaseEvidence: false,
      },
    };
  }

  const membershipDenied = await assertMembership(input.userId, input.organizationId);
  if (membershipDenied) return { response: membershipDenied, evidence: null };

  const access = await getAccess(input.userId, input.organizationId);
  if (!access || !access.companyWide) {
    return { response: denied("Treasury operators must have company-wide workspace access."), evidence: null };
  }
  if (!roleAllowed(access.role, TREASURY_OPERATOR_ELIGIBLE_ROLES)) {
    return {
      response: denied("This membership role is not eligible for enterprise treasury assignment."),
      evidence: null,
    };
  }
  if (!await treasuryOperatorAssigned(input.organizationId, input.userId)) {
    return {
      response: denied("Enterprise treasury separation is enabled and this user is not an assigned treasury operator."),
      evidence: null,
    };
  }

  const permission = await roleGateAllowed(input.userId, input.organizationId, "payroll.disburse");
  if (!permission.allowed) {
    return {
      response: denied("Your custom permission set does not allow payroll disbursement."),
      evidence: null,
    };
  }

  let releasedByUserId: number | null = null;
  let releaseActor: string | null = null;
  let legacyReleaseEvidence = false;

  if (input.requireReleaseSeparation !== false && policy.requireReleaseSubmitterSeparation) {
    const release = await releaseEvidence(input.organizationId, input.runId);
    if (!release) {
      return {
        response: denied("Payroll release evidence is missing; treasury submission is blocked.", 409),
        evidence: null,
      };
    }

    releaseActor = release.actor;
    const metadata = release.metadata && typeof release.metadata === "object"
      ? release.metadata as Record<string, unknown>
      : {};
    const stableId = Number(metadata.releasedByUserId);
    releasedByUserId = Number.isInteger(stableId) && stableId > 0 ? stableId : null;

    const separationError = treasuryReleaseSeparationError({
      policyEnabledAt: policy.enabledAt,
      releaseCreatedAt: release.createdAt,
      releaseActor: release.actor,
      releasedByUserId,
      userId: input.userId,
      userName: input.userName,
    });
    if (separationError) {
      const status = separationError.startsWith("Stable release-user evidence") ? 409 : 403;
      return { response: denied(separationError, status), evidence: null };
    }
    legacyReleaseEvidence = releasedByUserId == null;
  }

  return {
    response: null,
    evidence: {
      policyEnabled: true,
      policyEnabledAt: policy.enabledAt?.toISOString() ?? null,
      treasuryOperatorUserId: input.userId,
      releasedByUserId,
      releaseActor,
      legacyReleaseEvidence,
    },
  };
}
