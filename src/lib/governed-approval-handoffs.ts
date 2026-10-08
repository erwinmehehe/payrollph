import { createHash } from "node:crypto";
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalChainInstances,
  employees,
  openShiftClaims,
  openShifts,
  separationRecords,
} from "@/db/schema";

/**
 * A governed approval handoff is review evidence, never a source mutation.
 * The existing manager decision and separation/final-pay rules stay
 * authoritative after a reviewer approves this handoff.
 */
export const GOVERNED_HANDOFF_TYPES = [
  "wfm_roster_claim_review",
  "hcm_separation_readiness",
] as const;
export type GovernedHandoffType = typeof GOVERNED_HANDOFF_TYPES[number];

export function isGovernedHandoffType(value: unknown): value is GovernedHandoffType {
  return typeof value === "string" && (GOVERNED_HANDOFF_TYPES as readonly string[]).includes(value);
}

export type GovernedHandoffEvidence = {
  version: "governed-source-handoff-v1";
  sourceType: GovernedHandoffType;
  sourceId: number;
  sourceHash: string;
  initiatedByUserId: number;
  employeeId: number;
  orgUnitId: number | null;
};

export function fingerprintGovernedHandoffSource(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function governedHandoffSourceKey(sourceId: number, sourceHash: string) {
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0 || !/^[a-f0-9]{64}$/.test(sourceHash)) {
    throw new Error("Governed handoff requires a positive source ID and SHA-256 source hash.");
  }
  return `${sourceId}:${sourceHash}`;
}

export function parseGovernedSourceEvidence(value: unknown): GovernedHandoffEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== "governed-source-handoff-v1"
    || !isGovernedHandoffType(row.sourceType)
    || !Number.isSafeInteger(row.sourceId) || Number(row.sourceId) <= 0
    || typeof row.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(row.sourceHash)
    || !Number.isSafeInteger(row.initiatedByUserId) || Number(row.initiatedByUserId) <= 0
    || !Number.isSafeInteger(row.employeeId) || Number(row.employeeId) <= 0
    || (row.orgUnitId != null && (!Number.isSafeInteger(row.orgUnitId) || Number(row.orgUnitId) <= 0))) {
    return null;
  }
  return row as GovernedHandoffEvidence;
}

export function frozenGovernedHandoffEvidence(snapshot: unknown): GovernedHandoffEvidence | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return parseGovernedSourceEvidence((snapshot as Record<string, unknown>).sourceEvidence);
}

export type GovernedHandoffSource = {
  sourceType: GovernedHandoffType;
  sourceId: number;
  employeeId: number;
  orgUnitId: number | null;
  sourceHash: string;
  status: string;
  eligible: boolean;
  label: string;
};

/** Loads tenant-owned authoritative records, not automation event context. */
export async function loadGovernedHandoffSource(input: {
  organizationId: number;
  sourceType: GovernedHandoffType;
  sourceId: number;
}): Promise<GovernedHandoffSource | null> {
  const { organizationId, sourceId, sourceType } = input;
  if (sourceType === "wfm_roster_claim_review") {
    const [claim] = await db.select().from(openShiftClaims).where(and(
      eq(openShiftClaims.id, sourceId),
      eq(openShiftClaims.organizationId, organizationId),
    )).limit(1);
    if (!claim) return null;
    const [[shift], [worker]] = await Promise.all([
      db.select().from(openShifts).where(and(
        eq(openShifts.id, claim.openShiftId),
        eq(openShifts.organizationId, organizationId),
      )).limit(1),
      db.select().from(employees).where(and(
        eq(employees.id, claim.employeeId),
        eq(employees.organizationId, organizationId),
      )).limit(1),
    ]);
    if (!shift || !worker) return null;
    const eligible = claim.status === "pending" && shift.status === "open" && worker.status === "Active";
    const sourceHash = fingerprintGovernedHandoffSource({
      version: "wfm-claim-v1",
      organizationId,
      claimId: claim.id,
      claimStatus: claim.status,
      claimUpdatedAt: claim.updatedAt?.toISOString() ?? null,
      claimReason: claim.reason,
      employeeId: claim.employeeId,
      employeeStatus: worker.status,
      employeeOrgUnitId: worker.orgUnitId,
      openShiftId: shift.id,
      openShiftStatus: shift.status,
      openShiftUpdatedAt: shift.updatedAt?.toISOString() ?? null,
      worksiteId: shift.worksiteId,
      workDate: String(shift.workDate),
      shiftDefinitionId: shift.shiftDefinitionId,
      jobProfileId: shift.jobProfileId,
      slots: shift.slots,
    });
    return {
      sourceType, sourceId,
      employeeId: worker.id, orgUnitId: worker.orgUnitId,
      sourceHash, eligible, status: claim.status,
      label: `Open shift claim #${claim.id}`,
    };
  }

  const [separation] = await db.select().from(separationRecords).where(and(
    eq(separationRecords.id, sourceId),
    eq(separationRecords.organizationId, organizationId),
  )).limit(1);
  if (!separation) return null;
  const [worker] = await db.select().from(employees).where(and(
    eq(employees.id, separation.employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!worker) return null;

  const sourceHash = fingerprintGovernedHandoffSource({
    version: "hcm-separation-clearance-v1",
    organizationId,
    separationId: separation.id,
    employeeId: separation.employeeId,
    employeeOrgUnitId: worker.orgUnitId,
    employeeStatus: worker.status,
    separationType: separation.separationType,
    noticeDate: String(separation.noticeDate),
    lastDay: String(separation.lastDay),
    status: separation.status,
    clearanceStatus: separation.clearanceStatus,
    itCleared: separation.itCleared,
    adminCleared: separation.adminCleared,
    financeCleared: separation.financeCleared,
    hrCleared: separation.hrCleared,
    coeIssued: separation.coeIssued,
    netFinalPay: String(separation.netFinalPay),
    computationHash: fingerprintGovernedHandoffSource({
      computation: separation.computationSnapshot as Record<string, unknown>,
    }),
  });
  return {
    sourceType, sourceId,
    employeeId: worker.id, orgUnitId: worker.orgUnitId,
    sourceHash, eligible: separation.status === "draft", status: separation.status,
    label: `Separation clearance #${separation.id}`,
  };
}

export async function latestGovernedHandoffForSource(input: {
  organizationId: number;
  sourceType: GovernedHandoffType;
  sourceId: number;
}) {
  const [latest] = await db.select().from(approvalChainInstances).where(and(
    eq(approvalChainInstances.organizationId, input.organizationId),
    eq(approvalChainInstances.sourceType, input.sourceType),
    like(approvalChainInstances.sourceKey, `${input.sourceId}:%`),
  )).orderBy(desc(approvalChainInstances.id)).limit(1);
  return latest ?? null;
}

export async function currentRosterApprovalHandoffGate(
  organizationId: number,
  claimId: number,
): Promise<{ permitted: boolean; reason: string | null; approvalChainId: number | null }> {
  const latest = await latestGovernedHandoffForSource({
    organizationId, sourceType: "wfm_roster_claim_review", sourceId: claimId,
  });
  if (!latest) return { permitted: true, reason: null, approvalChainId: null };

  const source = await loadGovernedHandoffSource({
    organizationId, sourceType: "wfm_roster_claim_review", sourceId: claimId,
  });
  const evidence = frozenGovernedHandoffEvidence(latest.routingSnapshot);
  if (!source?.eligible || !evidence
      || evidence.sourceId !== claimId
      || evidence.sourceType !== "wfm_roster_claim_review"
      || evidence.sourceHash !== source.sourceHash
      || latest.sourceKey !== governedHandoffSourceKey(claimId, evidence.sourceHash)) {
    return {
      permitted: false,
      reason: "Roster claim changed after approval handoff. Request a new governed review before approving the claim.",
      approvalChainId: latest.id,
    };
  }
  if (latest.status !== "approved") {
    return {
      permitted: false,
      reason: "The latest governed roster review is not approved. A manager cannot bypass the pending or declined approval chain.",
      approvalChainId: latest.id,
    };
  }
  return { permitted: true, reason: null, approvalChainId: latest.id };
}
